/**
 * Dynamic Status Bar indicator component for Google Drive Sync.
 * Provides real-time visual feedback on sync progress, pending changes, and connection state.
 * @module ui/status-bar
 */

import { setIcon } from 'obsidian';
import type ObsidianGoogleDrive from '../main';
import { push } from '../services/sync-push';
import { startGoogleOAuthFlow } from '../services/auth/token-service';
import { openConflictResolver } from './conflict-list-modal';

export type SyncStatus =
	| { type: 'idle' }
	| { type: 'syncing'; progress?: number }
	| { type: 'pending'; count: number }
	| { type: 'conflict'; count: number }
	| { type: 'disconnected' }
	| { type: 'offline' };

/**
 * Manages the status bar pill element in the bottom right corner of Obsidian.
 */
export class SyncStatusBar {
	private plugin: ObsidianGoogleDrive;
	private statusBarEl: HTMLElement;
	private iconEl: HTMLElement;
	private textEl: HTMLElement;
	private currentStatus: SyncStatus = { type: 'idle' };

	/**
	 * Creates a new SyncStatusBar item in the Obsidian status bar.
	 *
	 * @param plugin - Plugin instance.
	 */
	constructor(plugin: ObsidianGoogleDrive) {
		this.plugin = plugin;
		this.statusBarEl = plugin.addStatusBarItem();
		this.statusBarEl.addClass('gdrive-sync-status-bar');

		this.iconEl = this.statusBarEl.createSpan({ cls: 'gdrive-status-icon' });
		this.textEl = this.statusBarEl.createSpan({ cls: 'gdrive-status-text' });

		this.statusBarEl.onClickEvent(() => {
			this.handleClick();
		});

		this.updateDisplay();
	}

	/**
	 * Updates the current status and refreshes the status bar display.
	 *
	 * @param status - The new synchronization status state.
	 */
	setStatus(status: SyncStatus): void {
		this.currentStatus = status;
		this.updateDisplay();
	}

	/**
	 * Returns the current status object.
	 */
	getStatus(): SyncStatus {
		return this.currentStatus;
	}

	private updateDisplay(): void {
		this.statusBarEl.removeClass('is-syncing', 'is-conflict', 'is-disconnected', 'is-pending');
		this.iconEl.empty();

		switch (this.currentStatus.type) {
			case 'idle':
				setIcon(this.iconEl, 'cloud-check');
				this.textEl.setText('Drive: Synced');
				this.statusBarEl.setAttribute('aria-label', 'Google Drive: Vault is up to date. Click to sync now.');
				break;

			case 'syncing': {
				this.statusBarEl.addClass('is-syncing');
				setIcon(this.iconEl, 'refresh-cw');
				const percent = this.currentStatus.progress !== undefined ? ` (${this.currentStatus.progress}%)` : '';
				this.textEl.setText(`Drive: Syncing${percent}`);
				this.statusBarEl.setAttribute('aria-label', `Google Drive: Sync in progress${percent}`);
				break;
			}

			case 'pending': {
				this.statusBarEl.addClass('is-pending');
				setIcon(this.iconEl, 'clock');
				const count = this.currentStatus.count;
				this.textEl.setText(`Drive: ${count} pending`);
				this.statusBarEl.setAttribute(
					'aria-label',
					`Google Drive: ${count} local change(s) waiting to be pushed. Click to sync now.`,
				);
				break;
			}

			case 'conflict':
				this.statusBarEl.addClass('is-conflict');
				setIcon(this.iconEl, 'alert-triangle');
				this.textEl.setText(`Drive: ${this.currentStatus.count} conflict(s)`);
				this.statusBarEl.setAttribute(
					'aria-label',
					'Google Drive: Conflict copies were generated. Click to sync.',
				);
				break;

			case 'disconnected':
				this.statusBarEl.addClass('is-disconnected');
				setIcon(this.iconEl, 'cloud-off');
				this.textEl.setText('Drive: Disconnected');
				this.statusBarEl.setAttribute('aria-label', 'Google Drive: Not connected. Click to connect in 1-click.');
				break;

			case 'offline':
				setIcon(this.iconEl, 'wifi-off');
				this.textEl.setText('Drive: Offline');
				this.statusBarEl.setAttribute('aria-label', 'Google Drive: No internet connection.');
				break;
		}
	}

	private handleClick(): void {
		if (!this.plugin.settings.refreshToken) {
			void startGoogleOAuthFlow(this.plugin);
			return;
		}

		if (this.currentStatus.type === 'conflict') {
			openConflictResolver(this.plugin.app, () => {
				this.plugin.updateConflictStatus();
			});
			return;
		}

		if (this.plugin.syncing) {
			return;
		}

		void push(this.plugin);
	}
}
