/**
 * Sidebar view displaying real-time Google Drive synchronization logs and events.
 * @module ui/activity-log-view
 */

import { ItemView, Notice, setIcon, WorkspaceLeaf } from 'obsidian';
import type ObsidianGoogleDrive from '../main';
import {
	activityLogger,
	type ActivityAction,
	type ActivityLogEntry,
} from '../services/sync/activity-log-service';
import { push } from '../services/sync-push';
import { pull } from '../services/sync-pull';

/**
 * View type identifier for the Google Drive Activity Log view.
 */
export const ACTIVITY_LOG_VIEW_TYPE = 'gdrive-activity-log-view';

/**
 * Obsidian ItemView rendering real-time synchronization activity.
 */
export class ActivityLogView extends ItemView {
	private plugin: ObsidianGoogleDrive;
	private unsubscribe?: () => void;
	private currentFilter: ActivityAction | 'all' = 'all';
	private listContainerEl?: HTMLElement;
	private countBadgeEl?: HTMLElement;

	/**
	 * Creates a new ActivityLogView.
	 *
	 * @param leaf - The Obsidian workspace leaf hosting this view.
	 * @param plugin - Plugin instance.
	 */
	constructor(leaf: WorkspaceLeaf, plugin: ObsidianGoogleDrive) {
		super(leaf);
		this.plugin = plugin;
	}

	override getViewType(): string {
		return ACTIVITY_LOG_VIEW_TYPE;
	}

	override getDisplayText(): string {
		return 'Google Drive activity';
	}

	override getIcon(): string {
		return 'activity';
	}

	override async onOpen(): Promise<void> {
		const container = this.contentEl;
		container.empty();
		container.addClass('gdrive-activity-view');

		this.renderHeader(container);
		this.renderFilters(container);

		this.listContainerEl = container.createDiv({
			cls: 'gdrive-activity-list',
		});
		this.renderLogItems();

		// Subscribe to real-time events
		this.unsubscribe = activityLogger.subscribe((entry) => {
			this.handleNewEntry(entry);
		});
	}

	private renderHeader(container: HTMLElement): void {
		const headerEl = container.createDiv({ cls: 'gdrive-activity-header' });

		const titleWrapper = headerEl.createDiv({
			cls: 'gdrive-activity-title-wrapper',
		});
		titleWrapper.createEl('h4', {
			cls: 'gdrive-activity-title',
			text: 'Activity log',
		});

		this.countBadgeEl = titleWrapper.createSpan({
			cls: 'gdrive-activity-count-badge',
			text: String(activityLogger.getEntries().length),
		});

		const actionsEl = headerEl.createDiv({
			cls: 'gdrive-activity-actions',
		});

		// Push button
		const pushBtn = actionsEl.createEl('button', {
			cls: 'clickable-icon gdrive-action-btn',
			attr: { 'aria-label': 'Push to Google Drive' },
		});
		setIcon(pushBtn, 'upload-cloud');
		pushBtn.addEventListener('click', () => {
			void push(this.plugin);
		});

		// Pull button
		const pullBtn = actionsEl.createEl('button', {
			cls: 'clickable-icon gdrive-action-btn',
			attr: { 'aria-label': 'Pull from Google Drive' },
		});
		setIcon(pullBtn, 'download-cloud');
		pullBtn.addEventListener('click', () => {
			void pull(this.plugin);
		});

		// Export button
		const exportBtn = actionsEl.createEl('button', {
			cls: 'clickable-icon gdrive-action-btn',
			attr: { 'aria-label': 'Export log to clipboard' },
		});
		setIcon(exportBtn, 'copy');
		exportBtn.addEventListener('click', () => {
			void this.exportLog();
		});

		// Clear button
		const clearBtn = actionsEl.createEl('button', {
			cls: 'clickable-icon gdrive-action-btn',
			attr: { 'aria-label': 'Clear log' },
		});
		setIcon(clearBtn, 'trash-2');
		clearBtn.addEventListener('click', () => {
			activityLogger.clear();
			this.renderLogItems();
			new Notice('Google Drive: Activity log cleared.');
		});
	}

	private renderFilters(container: HTMLElement): void {
		const filterRow = container.createDiv({
			cls: 'gdrive-activity-filters',
		});

		const filterOptions: Array<{ id: ActivityAction | 'all'; label: string }> = [
			{ id: 'all', label: 'All' },
			{ id: 'push', label: 'Push' },
			{ id: 'pull', label: 'Pull' },
			{ id: 'conflict', label: 'Conflict' },
			{ id: 'delete', label: 'Delete' },
			{ id: 'error', label: 'Error' },
		];

		filterOptions.forEach((opt) => {
			const pill = filterRow.createSpan({
				cls: `gdrive-filter-pill ${this.currentFilter === opt.id ? 'is-active' : ''}`,
				text: opt.label,
			});

			pill.addEventListener('click', () => {
				if (this.currentFilter === opt.id) return;
				this.currentFilter = opt.id;
				filterRow.querySelectorAll('.gdrive-filter-pill').forEach((el) => {
					el.removeClass('is-active');
				});
				pill.addClass('is-active');
				this.renderLogItems();
			});
		});
	}

	private renderLogItems(): void {
		if (!this.listContainerEl) return;
		this.listContainerEl.empty();

		const allEntries = activityLogger.getEntries();
		if (this.countBadgeEl) {
			this.countBadgeEl.setText(String(allEntries.length));
		}

		const filtered =
			this.currentFilter === 'all'
				? allEntries
				: allEntries.filter((e) => e.action === this.currentFilter);

		if (filtered.length === 0) {
			this.listContainerEl.createDiv({
				cls: 'gdrive-activity-empty',
				text: 'No synchronization activity recorded yet.',
			});
			return;
		}

		for (const entry of filtered) {
			this.createLogEntryEl(this.listContainerEl, entry);
		}
	}

	private createLogEntryEl(
		parent: HTMLElement,
		entry: ActivityLogEntry,
		prepend = false,
	): HTMLElement {
		const itemEl = parent.createDiv({
			cls: `gdrive-activity-item mod-${entry.action}`,
		});

		if (prepend && parent.firstChild && parent.firstChild !== itemEl) {
			parent.insertBefore(itemEl, parent.firstChild);
		}

		const metaRow = itemEl.createDiv({ cls: 'gdrive-activity-item-meta' });

		const timeStr = new Date(entry.timestamp).toLocaleTimeString();
		metaRow.createSpan({
			cls: 'gdrive-activity-time',
			text: timeStr,
		});

		metaRow.createSpan({
			cls: `gdrive-activity-badge mod-${entry.action}`,
			text: entry.action.toUpperCase(),
		});

		const messageEl = itemEl.createDiv({
			cls: 'gdrive-activity-message',
			text: entry.message,
		});

		if (entry.filePath) {
			messageEl.createDiv({
				cls: 'gdrive-activity-filepath',
				text: entry.filePath,
			});
		}

		if (entry.details) {
			itemEl.createDiv({
				cls: 'gdrive-activity-details',
				text: entry.details,
			});
		}

		return itemEl;
	}

	private handleNewEntry(entry: ActivityLogEntry): void {
		if (!this.listContainerEl) return;

		if (this.countBadgeEl) {
			this.countBadgeEl.setText(String(activityLogger.getEntries().length));
		}

		// Remove empty state if present
		const emptyEl = this.listContainerEl.querySelector('.gdrive-activity-empty');
		if (emptyEl) emptyEl.remove();

		// Only append if it matches current filter
		if (this.currentFilter === 'all' || this.currentFilter === entry.action) {
			this.createLogEntryEl(this.listContainerEl, entry, true);
		}
	}

	private async exportLog(): Promise<void> {
		const text = activityLogger.exportAsText();
		try {
			await navigator.clipboard.writeText(text);
			new Notice('Google Drive: Activity log copied to clipboard.');
		} catch {
			new Notice('Could not copy log to clipboard.');
		}
	}

	override async onClose(): Promise<void> {
		if (this.unsubscribe) {
			this.unsubscribe();
			this.unsubscribe = undefined;
		}
		this.contentEl.empty();
	}
}
