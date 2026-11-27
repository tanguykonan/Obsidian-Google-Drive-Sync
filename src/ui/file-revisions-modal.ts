/**
 * Modal displaying the Google Drive revision history for a vault note.
 * Allows users to inspect past revisions, preview visual diffs against local note, and restore previous versions.
 * @module ui/file-revisions-modal
 */

import { App, Modal, Notice, TFile } from 'obsidian';
import type ObsidianGoogleDrive from '../main';
import type { DriveRevision } from '../types';
import { computeTextDiff, type DiffLine } from '../services/sync/diff-service';

/**
 * Formats a byte count into a human-readable string.
 * @param bytes - Size in bytes (string or number).
 * @returns Formatted size string (e.g. "12.4 KB").
 */
export const formatFileSize = (bytes?: string | number): string => {
	if (!bytes) return '0 B';
	const num = typeof bytes === 'string' ? parseInt(bytes, 10) : bytes;
	if (isNaN(num) || num <= 0) return '0 B';
	const units = ['B', 'KB', 'MB', 'GB'];
	const idx = Math.min(
		Math.floor(Math.log(num) / Math.log(1024)),
		units.length - 1,
	);
	const value = num / Math.pow(1024, idx);
	return `${value.toFixed(1)} ${units[idx]}`;
};

/**
 * Modal presenting the version history of a file from Google Drive.
 */
export class FileRevisionsModal extends Modal {
	private plugin: ObsidianGoogleDrive;
	private file: TFile;
	private selectedRevision?: DriveRevision;
	private revisions: DriveRevision[] = [];
	private fileId?: string;

	/**
	 * Creates a new FileRevisionsModal.
	 *
	 * @param app - Obsidian App instance.
	 * @param plugin - Plugin instance.
	 * @param file - Note for which to retrieve revisions.
	 */
	constructor(app: App, plugin: ObsidianGoogleDrive, file: TFile) {
		super(app);
		this.plugin = plugin;
		this.file = file;
	}

	override async onOpen(): Promise<void> {
		const { contentEl, modalEl } = this;
		modalEl.addClass('gdrive-revisions-modal');

		this.setTitle('Google Drive: Version history');

		contentEl.empty();
		contentEl.createEl('p', {
			cls: 'gdrive-revisions-subtitle',
			text: `Browse and restore past revisions of "${this.file.name}" saved in Google Drive.`,
		});

		const loadingEl = contentEl.createDiv({
			cls: 'gdrive-diff-loading',
			text: 'Looking up revisions in Google Drive...',
		});

		if (!this.plugin.settings.refreshToken) {
			loadingEl.setText(
				'Please connect your Google Drive account in settings to access revision history.',
			);
			return;
		}

		try {
			// Find Drive file ID from settings map or query Drive
			let resolvedId: string | undefined;
			for (const [id, path] of Object.entries(this.plugin.settings.driveIdToPath)) {
				if (path === this.file.path) {
					resolvedId = id;
					break;
				}
			}

			if (!resolvedId) {
				resolvedId = await this.plugin.drive.idFromPath(this.file.path);
			}

			if (!resolvedId) {
				loadingEl.setText(
					'This file has not been synced to Google Drive yet. Run push to sync it first.',
				);
				return;
			}

			this.fileId = resolvedId;
			this.revisions = await this.plugin.drive.getFileRevisions(resolvedId);

			loadingEl.remove();

			if (this.revisions.length === 0) {
				contentEl.createEl('p', {
					cls: 'gdrive-revisions-empty',
					text: 'No past revisions found for this file on Google Drive.',
				});
				return;
			}

			this.renderLayout(contentEl);
		} catch (error) {
			loadingEl.setText(
				`Failed to load revisions: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	private renderLayout(containerEl: HTMLElement): void {
		const layoutContainer = containerEl.createDiv({
			cls: 'gdrive-revisions-layout',
		});

		// Left list: revisions
		const listContainer = layoutContainer.createDiv({
			cls: 'gdrive-revisions-list',
		});

		// Right container: preview & diff
		const previewContainer = layoutContainer.createDiv({
			cls: 'gdrive-revisions-preview',
		});

		this.renderRevisionItems(listContainer, previewContainer);

		// Default selection: select the second revision (previous version) if available, or the first
		const defaultRev = this.revisions.length > 1 ? this.revisions[1] : this.revisions[0];
		if (defaultRev) {
			this.selectRevision(defaultRev, previewContainer, listContainer);
		}
	}

	private renderRevisionItems(
		listContainer: HTMLElement,
		previewContainer: HTMLElement,
	): void {
		listContainer.empty();
		listContainer.createDiv({
			cls: 'gdrive-revisions-list-title',
			text: `Revisions (${this.revisions.length})`,
		});

		this.revisions.forEach((rev, index) => {
			const itemEl = listContainer.createDiv({
				cls: 'gdrive-revision-item',
			});
			if (this.selectedRevision?.id === rev.id) {
				itemEl.addClass('is-selected');
			}

			const headerEl = itemEl.createDiv({
				cls: 'gdrive-revision-item-header',
			});

			const dateStr = new Date(rev.modifiedTime).toLocaleString();
			headerEl.createSpan({
				cls: 'gdrive-revision-date',
				text: dateStr,
			});

			if (index === 0) {
				headerEl.createSpan({
					cls: 'gdrive-revision-badge mod-latest',
					text: 'Latest on Drive',
				});
			}

			const metaEl = itemEl.createDiv({ cls: 'gdrive-revision-meta' });
			metaEl.createSpan({
				cls: 'gdrive-revision-size',
				text: `Size: ${formatFileSize(rev.size)}`,
			});

			itemEl.addEventListener('click', () => {
				this.selectRevision(rev, previewContainer, listContainer);
			});
		});
	}

	private selectRevision(
		rev: DriveRevision,
		previewContainer: HTMLElement,
		listContainer: HTMLElement,
	): void {
		this.selectedRevision = rev;

		// Update selection class in list
		listContainer
			.querySelectorAll('.gdrive-revision-item')
			.forEach((el, idx) => {
				if (this.revisions[idx]?.id === rev.id) {
					el.addClass('is-selected');
				} else {
					el.removeClass('is-selected');
				}
			});

		void this.renderDiffPreview(previewContainer, rev);
	}

	private async renderDiffPreview(
		previewContainer: HTMLElement,
		rev: DriveRevision,
	): Promise<void> {
		previewContainer.empty();

		const headerEl = previewContainer.createDiv({
			cls: 'gdrive-preview-header',
		});
		const dateStr = new Date(rev.modifiedTime).toLocaleString();

		const titleBlock = headerEl.createDiv();
		titleBlock.createEl('h4', {
			cls: 'gdrive-preview-title',
			text: `Revision from ${dateStr}`,
		});
		titleBlock.createEl('p', {
			cls: 'gdrive-preview-subtitle',
			text: 'Comparing this revision with your current local note.',
		});

		const actionsEl = headerEl.createDiv({
			cls: 'gdrive-preview-actions',
		});
		const restoreBtn = actionsEl.createEl('button', {
			cls: 'mod-cta',
			text: 'Restore this version',
		});

		const diffLoadingEl = previewContainer.createDiv({
			cls: 'gdrive-diff-loading',
			text: 'Loading revision content and computing diff...',
		});

		if (!this.fileId) return;

		try {
			const [revContent, localContent] = await Promise.all([
				this.plugin.drive.getRevisionContent(
					this.fileId,
					rev.id,
					this.plugin.settings.e2eePassword,
				),
				this.app.vault.read(this.file),
			]);

			diffLoadingEl.remove();

			restoreBtn.addEventListener('click', () => {
				void this.restoreRevision(revContent, dateStr);
			});

			const diffLines = computeTextDiff(localContent, revContent);
			this.renderDiffContent(previewContainer, diffLines);
		} catch (error) {
			diffLoadingEl.setText(
				`Failed to load revision diff: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	private renderDiffContent(
		containerEl: HTMLElement,
		diffLines: DiffLine[],
	): void {
		const addedCount = diffLines.filter((l) => l.type === 'added').length;
		const removedCount = diffLines.filter((l) => l.type === 'removed').length;

		const statsBar = containerEl.createDiv({ cls: 'gdrive-diff-stats' });
		statsBar.createSpan({
			cls: 'gdrive-diff-stat mod-added',
			text: `+${addedCount} revision lines`,
		});
		statsBar.createSpan({
			cls: 'gdrive-diff-stat mod-removed',
			text: `-${removedCount} local lines`,
		});

		if (addedCount === 0 && removedCount === 0) {
			containerEl.createDiv({
				cls: 'gdrive-diff-identical',
				text: 'This revision is identical to your current local note.',
			});
			return;
		}

		const viewerEl = containerEl.createDiv({ cls: 'gdrive-diff-viewer' });

		for (const line of diffLines) {
			const rowEl = viewerEl.createDiv({
				cls: `gdrive-diff-row mod-${line.type}`,
			});

			const lineNumsEl = rowEl.createSpan({ cls: 'gdrive-diff-linenum' });
			const locNum =
				line.localLineNumber !== undefined
					? String(line.localLineNumber)
					: '';
			const remNum =
				line.remoteLineNumber !== undefined
					? String(line.remoteLineNumber)
					: '';
			lineNumsEl.setText(
				`${locNum.padStart(3, ' ')} ${remNum.padStart(3, ' ')}`,
			);

			const signEl = rowEl.createSpan({ cls: 'gdrive-diff-sign' });
			if (line.type === 'added') signEl.setText('+');
			else if (line.type === 'removed') signEl.setText('-');
			else signEl.setText(' ');

			const contentSpan = rowEl.createSpan({ cls: 'gdrive-diff-content' });
			contentSpan.setText(line.text || ' ');
		}
	}

	private async restoreRevision(
		content: string,
		formattedDate: string,
	): Promise<void> {
		try {
			await this.app.vault.modify(this.file, content);
			new Notice(
				`Google Drive: Restored "${this.file.name}" to version from ${formattedDate}.`,
			);
			this.close();
		} catch (error) {
			new Notice(
				`Failed to restore version: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	override onClose(): void {
		this.contentEl.empty();
	}
}
