/**
 * First-run welcome and onboarding modal.
 * Guides new users through one-click authentication and initial vault backup warnings.
 * @module ui/onboarding-modal
 */

import { Modal, Setting } from 'obsidian';
import type ObsidianGoogleDrive from '../main';
import { startGoogleOAuthFlow } from '../services/auth/token-service';

/**
 * Onboarding modal shown when the plugin is first enabled without configured credentials.
 */
export class OnboardingModal extends Modal {
	private plugin: ObsidianGoogleDrive;

	/**
	 * Creates a new OnboardingModal.
	 *
	 * @param plugin - Plugin instance.
	 */
	constructor(plugin: ObsidianGoogleDrive) {
		super(plugin.app);
		this.plugin = plugin;

		this.setTitle('Welcome to Google Drive sync');

		this.contentEl.createEl('p', {
			text: 'Sync your Obsidian vault seamlessly with Google Drive across desktop and mobile devices for free.',
		});

		const calloutEl = this.contentEl.createDiv({ cls: 'callout mod-warning' });
		const titleEl = calloutEl.createDiv({ cls: 'callout-title' });
		titleEl.createEl('b', { text: 'Important: Backup your vault' });
		calloutEl.createDiv({
			cls: 'callout-content',
			text: 'Before running your first synchronization, we strongly recommend creating a local backup copy of your vault.',
		});

		new Setting(this.contentEl)
			.setName('Ready to connect?')
			.setDesc('Authorize Obsidian with your Google account in one click.')
			.addButton((btn) =>
				btn
					.setButtonText('Connect with Google Drive')
					.setCta()
					.onClick(() => {
						this.close();
						void startGoogleOAuthFlow(this.plugin);
					}),
			)
			.addButton((btn) =>
				btn
					.setButtonText('Configure later')
					.onClick(() => this.close()),
			);
	}
}