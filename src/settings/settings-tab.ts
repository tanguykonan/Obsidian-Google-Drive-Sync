/**
 * Settings tab definition for the Google Drive Sync plugin.
 * Built using Obsidian's declarative SettingDefinitionItem API (v1.13+).
 * @module settings/settings-tab
 */

import { App, Notice, PluginSettingTab, type SettingDefinitionItem } from 'obsidian';
import type ObsidianGoogleDrive from '../main';
import { refreshAccessToken } from '../services/drive-agent';
import {
	disconnectGoogleDrive,
	startGoogleOAuthFlow,
} from '../services/auth/token-service';
import { TIMINGS } from '../constants';

/**
 * Settings tab providing configuration fields for tokens, auto-push, and custom OAuth client credentials.
 */
export class SettingsTab extends PluginSettingTab {
	plugin: ObsidianGoogleDrive;

	/**
	 * Creates a new SettingsTab.
	 *
	 * @param app - Obsidian App instance.
	 * @param plugin - Plugin instance.
	 */
	constructor(app: App, plugin: ObsidianGoogleDrive) {
		super(app, plugin);
		this.plugin = plugin;
	}

	override getSettingDefinitions(): SettingDefinitionItem[] {
		const isConnected = Boolean(this.plugin.settings.refreshToken);

		return [
			{
				name: 'Google Drive connection',
				desc: isConnected
					? 'Account connected to Google Drive.'
					: 'Connect your Google Drive account in one click (no technical setup needed).',
				render: (setting) => {
					setting.settingEl.empty();
					const infoEl = setting.settingEl.createDiv();
					infoEl.createEl('b', {
						text: isConnected ? 'Status: Connected' : 'Status: Not connected',
					});

					const controlEl = setting.settingEl.createDiv({ cls: 'setting-item-control' });
					if (isConnected) {
						const btn = controlEl.createEl('button', {
							text: 'Disconnect',
						});
						btn.onclick = async () => {
							await disconnectGoogleDrive(this.plugin);
							new Notice('Disconnected from Google Drive.');
						};
					} else {
						const btn = controlEl.createEl('button', {
							text: 'Connect with Google Drive',
							cls: 'mod-cta',
						});
						btn.onclick = () => {
							void startGoogleOAuthFlow(this.plugin);
						};
					}
				},
			},
			{
				name: 'Refresh token',
				desc: 'A refresh token is required to access your Google Drive for syncing. We suggest cloning your Google Drive vault to the current vault before syncing.',
				control: {
					type: 'text',
					key: 'refreshToken',
					placeholder: 'Refresh Token',
					validate: async (value: string) => {
						if (!value) {
							return 'Refresh token cannot be empty';
						}

						if (value === this.plugin.settings.refreshToken) {
							return;
						}

						if (!(await refreshAccessToken(this.plugin, value))) {
							return 'Failed to refresh access token.';
						}

						const changesToken =
							await this.plugin.drive.getChangesStartToken();
						if (!changesToken) {
							return 'An error occurred fetching Google Drive changes token.';
						}
						this.plugin.settings.changesToken = changesToken;

						await this.plugin.saveSettings();
						new Notice('Refresh token saved! Initializing sync.');

						// Safe service restart without re-registering onload commands or listeners!
						window.setTimeout(() => {
							void this.plugin.initSyncAfterAuth();
						}, TIMINGS.INITIAL_SYNC_DELAY_MS);
						return;
					},
				},
			},
			{
				name: 'Automatically push changes',
				desc: 'Push one minute after the most recent local file change.',
				control: {
					type: 'toggle',
					key: 'autoPush',
					defaultValue: false,
				},
			},
			{
				name: 'Excluded patterns',
				desc: 'Paths or patterns to ignore during sync, separated by newlines or commas (e.g. *.tmp, temp/, private/**).',
				control: {
					type: 'textarea',
					key: 'excludedPatterns',
					placeholder: '*.tmp\ntemp/\nprivate/**',
					rows: 3,
				},
			},
			{
				name: 'End-to-End Encryption (E2EE)',
				desc: 'Optionally encrypt your notes with AES-256-GCM before uploading to Google Drive. Keeps your data completely zero-knowledge.',
				control: {
					type: 'toggle',
					key: 'e2eeEnabled',
					defaultValue: false,
				},
			},
			{
				name: 'E2EE encryption password',
				desc: 'Passphrase used to derive your 256-bit encryption key. Keep this password safe: lost passwords cannot be recovered.',
				control: {
					type: 'text',
					key: 'e2eePassword',
					placeholder: 'Enter secret passphrase',
				},
			},
			{
				name: 'Client ID',
				desc: 'Optional custom Google Cloud OAuth client ID. When set, authentication connects directly to your own Google Cloud project.',
				control: {
					type: 'text',
					key: 'clientId',
					placeholder: 'Client ID',
				},
			},
			{
				name: 'Client secret',
				desc: 'Optional client secret if required by your custom Google Cloud client configuration.',
				control: {
					type: 'text',
					key: 'clientSecret',
					placeholder: 'Client secret',
				},
			},
		];
	}

	override async setControlValue(key: string, value: unknown): Promise<void> {
		await super.setControlValue(key, value);
		if (key === 'autoPush') {
			if (value) this.plugin.resumeAutoPushIfNeeded();
			else this.plugin.clearAutoPushTimer();
		}
	}
}
