/**
 * Confirmation dialog shown before pushing local changes to Google Drive.
 * @module ui/confirm-push-modal
 */

import { Modal, setIcon, Setting } from 'obsidian';
import type ObsidianGoogleDrive from '../main';
import { ConfirmUndoModal } from './confirm-undo-modal';

/**
 * Modal that lists all pending local create/modify/delete operations,
 * allowing users to review and optionally revert changes before pushing.
 */
export class ConfirmPushModal extends Modal {
	private proceed: (res: boolean) => void;

	/**
	 * Creates a new ConfirmPushModal.
	 *
	 * @param plugin - Plugin instance.
	 * @param initialOperations - Array of pending [path, operation] pairs.
	 * @param proceed - Resolution callback receiving true to proceed with push, false to cancel.
	 */
	constructor(
		plugin: ObsidianGoogleDrive,
		initialOperations: [string, 'create' | 'delete' | 'modify'][],
		proceed: (res: boolean) => void,
	) {
		super(plugin.app);
		this.proceed = proceed;

		this.setTitle('Push confirmation');
		this.contentEl
			.createEl('p')
			.setText('Do you want to push the following changes to Google Drive:');
		const container = this.contentEl.createDiv();

		const render = (operations: typeof initialOperations) => {
			container.empty();
			operations.forEach(([path, op]) => {
				const div = container.createDiv();
				div.addClass('operation-container');

				const p = div.createEl('p');
				p.createEl('b').setText(
					`${(op[0] as string).toUpperCase()}${op.slice(1)}`,
				);
				p.createSpan().setText(`: ${path}`);

				if (
					op === 'delete' &&
					operations.some(([file]) => path.startsWith(file + '/'))
				) {
					return;
				}

				const btn = div.createDiv().createEl('button');
				setIcon(btn, 'trash-2');
				btn.onclick = async () => {
					const nestedFiles = operations
						.map(([file]) => file)
						.filter(
							(file) => file.startsWith(path + '/') || file === path,
						);
					const shouldUndo = await new Promise<boolean>((resolve) => {
						new ConfirmUndoModal(plugin, op, nestedFiles, resolve).open();
					});

					if (!shouldUndo) return;

					nestedFiles.forEach(
						(file) => delete plugin.settings.operations[file],
					);
					const newOperations = operations.filter(
						([file]) => !nestedFiles.includes(file),
					);
					if (!newOperations.length) return this.close();
					render(newOperations);
				};
			});
		};

		render(initialOperations);

		new Setting(this.contentEl)
			.addButton((btn) =>
				btn.setButtonText('Cancel').onClick(() => this.close()),
			)
			.addButton((btn) =>
				btn
					.setButtonText('Confirm')
					.setCta()
					.onClick(() => {
						this.proceed(true);
						this.close();
					}),
			);
	}

	override onClose(): void {
		this.proceed(false);
	}
}
