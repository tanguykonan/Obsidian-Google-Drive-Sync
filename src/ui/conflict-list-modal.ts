/**
 * Modal displaying all detected conflict files in the vault, allowing the user to select one for visual diff resolution.
 * @module ui/conflict-list-modal
 */

import { App, FuzzySuggestModal, Notice, TFile } from 'obsidian';
import { findConflictPairs } from '../services/sync/diff-service';
import { ConflictDiffModal } from './conflict-diff-modal';

/**
 * Pair of files representing a synchronization conflict.
 */
export interface ConflictItem {
	/** Original local file in the vault */
	originalFile: TFile;
	/** Conflicting copy file generated during sync */
	conflictFile: TFile;
}

/**
 * Fuzzy suggest modal listing all active sync conflicts in the vault.
 */
export class ConflictListModal extends FuzzySuggestModal<ConflictItem> {
	private onResolved?: () => void;

	/**
	 * Creates a new ConflictListModal.
	 *
	 * @param app - Obsidian App instance.
	 * @param onResolved - Optional callback invoked after a conflict is resolved.
	 */
	constructor(app: App, onResolved?: () => void) {
		super(app);
		this.onResolved = onResolved;
		this.setPlaceholder('Select a conflicted note to review differences...');
	}

	getItems(): ConflictItem[] {
		const pairs = findConflictPairs(this.app.vault);
		const items: ConflictItem[] = [];

		for (const pair of pairs) {
			const orig = this.app.vault.getAbstractFileByPath(pair.originalPath);
			const conf = this.app.vault.getAbstractFileByPath(pair.conflictPath);
			if (orig instanceof TFile && conf instanceof TFile) {
				items.push({ originalFile: orig, conflictFile: conf });
			}
		}

		return items;
	}

	getItemText(item: ConflictItem): string {
		return `${item.originalFile.path} (${item.conflictFile.name})`;
	}

	onChooseItem(item: ConflictItem): void {
		new ConflictDiffModal(
			this.app,
			item.originalFile,
			item.conflictFile,
			this.onResolved,
		).open();
	}
}

/**
 * Convenience helper to launch visual conflict resolution:
 * - If 0 conflicts: displays a reassuring notice.
 * - If 1 conflict: immediately opens ConflictDiffModal.
 * - If > 1 conflicts: opens ConflictListModal to pick.
 *
 * @param app - Obsidian App instance.
 * @param onResolved - Optional callback invoked after a conflict is resolved.
 */
export const openConflictResolver = (app: App, onResolved?: () => void): void => {
	const pairs = findConflictPairs(app.vault);
	if (!pairs.length) {
		new Notice('No conflict copies found in vault.');
		return;
	}

	if (pairs.length === 1 && pairs[0]) {
		const orig = app.vault.getAbstractFileByPath(pairs[0].originalPath);
		const conf = app.vault.getAbstractFileByPath(pairs[0].conflictPath);
		if (orig instanceof TFile && conf instanceof TFile) {
			new ConflictDiffModal(app, orig, conf, onResolved).open();
			return;
		}
	}

	new ConflictListModal(app, onResolved).open();
};
