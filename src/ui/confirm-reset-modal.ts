/**
 * Confirmation dialog for resetting the local vault to match Google Drive.
 * @module ui/confirm-reset-modal
 */

import { Modal, Setting } from 'obsidian';
import type ObsidianGoogleDrive from '../main';

/**
 * Destructive action modal warning the user about overwriting all local vault changes.
 */
export class ConfirmResetModal extends Modal {
	private proceed: (res: boolean) => void;

	/**
	 * Creates a new ConfirmResetModal.
	 *
	 * @param plugin - Plugin instance.
	 * @param proceed - Resolution callback receiving true to proceed with reset, false to cancel.
	 */
	constructor(plugin: ObsidianGoogleDrive, proceed: (res: boolean) => void) {
		super(plugin.app);
		this.proceed = proceed;

		this.setTitle('Are you sure you want to reset the data from Google Drive?');
		this.setContent(
			"You'll lose all the local changes to your data and load only the information on your Google Drive. This step is irreversible.",
		);
		new Setting(this.contentEl)
			.addButton((btn) =>
				btn.setButtonText('Cancel').onClick(() => this.close()),
			)
			.addButton((btn) =>
				btn
					.setButtonText('Reset!')
					.setDestructive()
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
