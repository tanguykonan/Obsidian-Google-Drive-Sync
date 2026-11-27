/**
 * Visual side-by-side / unified diff comparison modal for resolving sync conflicts.
 * Allows users to inspect changes and choose which version to retain.
 * @module ui/conflict-diff-modal
 */

import { App, Modal, Notice, TFile } from 'obsidian';
import { computeTextDiff, type DiffLine } from '../services/sync/diff-service';

/**
 * Interactive visual diff modal presented when resolving a conflict copy against its original note.
 */
export class ConflictDiffModal extends Modal {
	private originalFile: TFile;
	private conflictFile: TFile;
	private onResolved?: () => void;

	/**
	 * Creates a new ConflictDiffModal.
	 *
	 * @param app - Obsidian App instance.
	 * @param originalFile - The baseline original note in the vault.
	 * @param conflictFile - The conflicting copy note.
	 * @param onResolved - Optional callback invoked after resolving the conflict.
	 */
	constructor(
		app: App,
		originalFile: TFile,
		conflictFile: TFile,
		onResolved?: () => void,
	) {
		super(app);
		this.originalFile = originalFile;
		this.conflictFile = conflictFile;
		this.onResolved = onResolved;
	}

	override async onOpen(): Promise<void> {
		const { contentEl, modalEl } = this;
		modalEl.addClass('gdrive-diff-modal');

		this.setTitle('Resolve file conflict');

		contentEl.empty();
		contentEl.createEl('p', {
			cls: 'gdrive-diff-subtitle',
			text: `Comparing "${this.originalFile.path}" with conflict copy "${this.conflictFile.name}".`,
		});

		const loadingEl = contentEl.createDiv({
			cls: 'gdrive-diff-loading',
			text: 'Computing visual differences...',
		});

		try {
			const originalText = await this.app.vault.read(this.originalFile);
			const conflictText = await this.app.vault.read(this.conflictFile);
			const diffLines = computeTextDiff(originalText, conflictText);

			loadingEl.remove();
			this.renderDiffView(contentEl, diffLines, originalText, conflictText);
		} catch (error) {
			loadingEl.setText(
				`Failed to read file contents: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	private renderDiffView(
		containerEl: HTMLElement,
		diffLines: DiffLine[],
		originalText: string,
		conflictText: string,
	): void {
		// Summary statistics bar
		const addedCount = diffLines.filter((l) => l.type === 'added').length;
		const removedCount = diffLines.filter((l) => l.type === 'removed').length;

		const statsBar = containerEl.createDiv({ cls: 'gdrive-diff-stats' });
		statsBar.createSpan({
			cls: 'gdrive-diff-stat mod-added',
			text: `+${addedCount} Drive lines`,
		});
		statsBar.createSpan({
			cls: 'gdrive-diff-stat mod-removed',
			text: `-${removedCount} local lines`,
		});

		// Visual Diff Viewer Container
		const viewerEl = containerEl.createDiv({ cls: 'gdrive-diff-viewer' });

		for (const line of diffLines) {
			const rowEl = viewerEl.createDiv({
				cls: `gdrive-diff-row mod-${line.type}`,
			});

			const lineNumsEl = rowEl.createSpan({ cls: 'gdrive-diff-linenum' });
			const locNum = line.localLineNumber !== undefined ? String(line.localLineNumber) : '';
			const remNum = line.remoteLineNumber !== undefined ? String(line.remoteLineNumber) : '';
			lineNumsEl.setText(`${locNum.padStart(3, ' ')} ${remNum.padStart(3, ' ')}`);

			const signEl = rowEl.createSpan({ cls: 'gdrive-diff-sign' });
			if (line.type === 'added') signEl.setText('+');
			else if (line.type === 'removed') signEl.setText('-');
			else signEl.setText(' ');

			const contentSpan = rowEl.createSpan({ cls: 'gdrive-diff-content' });
			contentSpan.setText(line.text || ' ');
		}

		// Action Buttons Container
		const actionsEl = containerEl.createDiv({ cls: 'gdrive-diff-actions' });

		const keepLocalBtn = actionsEl.createEl('button', {
			cls: 'mod-warning',
			text: 'Keep local version',
		});
		keepLocalBtn.setAttribute(
			'aria-label',
			'Keep the local note and delete the drive conflict copy.',
		);
		keepLocalBtn.onclick = async () => {
			await this.resolveKeepLocal();
		};

		const keepDriveBtn = actionsEl.createEl('button', {
			cls: 'mod-cta',
			text: 'Keep drive version',
		});
		keepDriveBtn.setAttribute(
			'aria-label',
			'Overwrite local note with drive content and delete the conflict copy.',
		);
		keepDriveBtn.onclick = async () => {
			await this.resolveKeepDrive(conflictText);
		};

		const keepBothBtn = actionsEl.createEl('button', {
			text: 'Keep both',
		});
		keepBothBtn.onclick = () => {
			this.close();
		};
	}

	private async resolveKeepLocal(): Promise<void> {
		try {
			await this.app.fileManager.trashFile(this.conflictFile);
			new Notice(`Conflict resolved: Kept local "${this.originalFile.name}".`);
			this.close();
			this.onResolved?.();
		} catch (error) {
			new Notice(`Error removing conflict file: ${String(error)}`);
		}
	}

	private async resolveKeepDrive(driveContent: string): Promise<void> {
		try {
			await this.app.vault.modify(this.originalFile, driveContent);
			await this.app.fileManager.trashFile(this.conflictFile);
			new Notice('Conflict resolved: Replaced with drive version.');
			this.close();
			this.onResolved?.();
		} catch (error) {
			new Notice(`Error updating local file: ${String(error)}`);
		}
	}
}
