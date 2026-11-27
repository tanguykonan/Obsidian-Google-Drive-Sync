/**
 * Main entry point for the Obsidian Google Drive Sync plugin.
 * Handles lifecycle events (onload, onunload) and command registrations.
 * @module main
 */

import { debounce, Notice, Plugin, TAbstractFile, TFile } from 'obsidian';
import {
	AccessTokenState,
	DEFAULT_SETTINGS,
	PluginSettings,
} from './types';
import { SettingsTab } from './settings/settings-tab';
import { checkConnection, getDriveClient } from './services/drive-client';
import { pull } from './services/sync-pull';
import { push } from './services/sync-push';
import { handleOAuthProtocolCallback } from './services/auth/token-service';
import { SyncStatusBar } from './ui/status-bar';
import { OnboardingModal } from './ui/onboarding-modal';
import { isPathExcluded, parseExclusionPatterns } from './services/sync/exclusion';
import { findConflictPairs } from './services/sync/diff-service';
import { FileRevisionsModal } from './ui/file-revisions-modal';
import { ActivityLogView, ACTIVITY_LOG_VIEW_TYPE } from './ui/activity-log-view';
import { registerPluginCommands } from './commands';
import { TIMINGS } from './constants';

export default class ObsidianGoogleDrive extends Plugin {
	declare settings: PluginSettings;
	accessToken: AccessTokenState = { token: '', expiresAt: 0 };
	drive = getDriveClient(this);
	ribbonIcon?: HTMLElement;
	statusBar?: SyncStatusBar;
	syncing = false;
	autoPushTimer?: number;

	async onload(): Promise<void> {
		await this.loadSettings();
		this.addSettingTab(new SettingsTab(this.app, this));

		this.registerCommands();
		this.registerProtocolHandler();

		this.registerView(
			ACTIVITY_LOG_VIEW_TYPE,
			(leaf) => new ActivityLogView(leaf, this),
		);

		this.app.workspace.onLayoutReady(() => {
			this.statusBar = new SyncStatusBar(this);
			if (!this.settings.refreshToken) {
				this.statusBar.setStatus({ type: 'disconnected' });
				new OnboardingModal(this).open();
			} else {
				this.updateConflictStatus();
			}
		});

		if (!this.settings.refreshToken) {
			new Notice(
				'Google Drive sync: Please configure your refresh token in settings before syncing. Back up your vault before first sync.',
				10000,
			);
			return;
		}

		this.setupRibbonAndEvents();
	}

	private registerProtocolHandler(): void {
		const handler = async (params: Record<string, string>) => {
			await handleOAuthProtocolCallback(this, params);
		};
		this.registerObsidianProtocolHandler('google-drive-sync-plus', handler);
	}

	onunload(): void {
		this.clearAutoPushTimer();
		void this.saveSettings();
	}

	private registerCommands(): void {
		registerPluginCommands(this);
	}

	/**
	 * Opens or reveals the Google Drive activity log view in the right sidebar leaf.
	 */
	async activateActivityLogView(): Promise<void> {
		const { workspace } = this.app;
		let leaf = workspace.getLeavesOfType(ACTIVITY_LOG_VIEW_TYPE)[0];
		if (!leaf) {
			const rightLeaf = workspace.getRightLeaf(false);
			if (rightLeaf) {
				leaf = rightLeaf;
				await leaf.setViewState({
					type: ACTIVITY_LOG_VIEW_TYPE,
					active: true,
				});
			}
		}
		if (leaf) {
			await workspace.revealLeaf(leaf);
		}
	}

	private setupRibbonAndEvents(): void {
		if (!this.ribbonIcon) {
			this.ribbonIcon = this.addRibbonIcon(
				'refresh-cw',
				'Push to Google Drive',
				() => {
					if (this.syncing) return;
					void push(this);
				},
			);
		}

		const { vault } = this.app;
		this.app.workspace.onLayoutReady(() => {
			this.registerEvent(vault.on('create', this.handleCreate.bind(this)));
			this.registerEvent(vault.on('delete', this.handleDelete.bind(this)));
			this.registerEvent(vault.on('modify', this.handleModify.bind(this)));
			this.registerEvent(vault.on('rename', this.handleRename.bind(this)));

			this.registerEvent(
				this.app.workspace.on('file-menu', (menu, file) => {
					if (file instanceof TFile && file.extension === 'md') {
						menu.addItem((item) => {
							item.setTitle('Google Drive: Version history')
								.setIcon('history')
								.onClick(() => {
									new FileRevisionsModal(this.app, this, file).open();
								});
						});
					}
				}),
			);

			void checkConnection().then(async (connected) => {
				if (!connected) return;
				this.syncing = true;
				this.ribbonIcon?.addClass('spin');
				try {
					if (await pull(this, true)) await this.endSync();
				} finally {
					if (this.syncing) this.abortSync();
				}
			});
		});
	}

	/**
	 * Safe initialization helper called after initial authentication.
	 * Avoids re-invoking onload() and duplicating command/ribbon registrations.
	 */
	async initSyncAfterAuth(): Promise<void> {
		this.setupRibbonAndEvents();
		new Notice('Sync complete! Changes will now synchronize with Google Drive.', TIMINGS.NOTICE_SHORT_MS);
	}

	/**
	 * Loads persisted settings from disk and merges with default settings.
	 *
	 * @returns Promise that resolves once settings are loaded.
	 */
	async loadSettings(): Promise<void> {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			(await this.loadData()) as PluginSettings,
		);
	}

	/**
	 * Persists settings to disk.
	 *
	 * @returns Promise that resolves once settings are saved.
	 */
	saveSettings(): Promise<void> {
		return this.saveData(this.settings);
	}

	/**
	 * Debounced settings persistence helper.
	 */
	debouncedSaveSettings = debounce(this.saveSettings.bind(this), TIMINGS.SETTINGS_SAVE_DEBOUNCE_MS, true);

	/**
	 * Cancels the currently pending automatic push timer, if any.
	 */
	clearAutoPushTimer(): void {
		if (this.autoPushTimer === undefined) return;
		window.clearTimeout(this.autoPushTimer);
		this.autoPushTimer = undefined;
	}

	/**
	 * Schedules an automatic push operation after a configured inactivity delay.
	 */
	scheduleAutoPush(): void {
		this.clearAutoPushTimer();
		if (!this.settings.autoPush || this.syncing) return;

		this.autoPushTimer = window.setTimeout(() => {
			this.autoPushTimer = undefined;
			if (
				this.syncing ||
				!this.settings.autoPush ||
				!Object.keys(this.settings.operations).length
			) {
				return;
			}
			void push(this, true);
		}, TIMINGS.AUTO_PUSH_DELAY_MS);
	}

	/**
	 * Restarts auto-push timer if unresolved operations exist in the queue.
	 */
	resumeAutoPushIfNeeded(): void {
		if (Object.keys(this.settings.operations).length) {
			this.scheduleAutoPush();
		}
	}

	/**
	 * Handles a local file or folder creation event.
	 *
	 * @param file - The created vault file or folder.
	 */
	handleCreate(file: TAbstractFile): void {
		const patterns = parseExclusionPatterns(this.settings.excludedPatterns || '');
		if (isPathExcluded(file.path, patterns)) return;

		if (this.settings.operations[file.path] === 'delete') {
			if (file instanceof TFile) {
				this.settings.operations[file.path] = 'modify';
			} else {
				delete this.settings.operations[file.path];
			}
		} else {
			if (file.path.includes('"')) {
				new Notice(`File path ${file.path} contains double quotes and will not be synced.`);
				return;
			}
			this.settings.operations[file.path] = 'create';
		}
		this.debouncedSaveSettings();
		this.scheduleAutoPush();
		this.updateStatusBarPending();
	}

	/**
	 * Handles a local file or folder deletion event.
	 *
	 * @param file - The deleted vault file or folder.
	 */
	handleDelete(file: TAbstractFile): void {
		const patterns = parseExclusionPatterns(this.settings.excludedPatterns || '');
		if (isPathExcluded(file.path, patterns)) return;

		if (this.settings.operations[file.path] === 'create') {
			delete this.settings.operations[file.path];
		} else if (!file.path.includes('"')) {
			this.settings.operations[file.path] = 'delete';
		}
		this.debouncedSaveSettings();
		this.scheduleAutoPush();
		this.updateStatusBarPending();
	}

	/**
	 * Handles a local file modification event.
	 *
	 * @param file - The modified vault file.
	 */
	handleModify(file: TAbstractFile): void {
		const patterns = parseExclusionPatterns(this.settings.excludedPatterns || '');
		if (isPathExcluded(file.path, patterns)) return;

		const operation = this.settings.operations[file.path];
		if (operation === 'create' || operation === 'modify') {
			this.scheduleAutoPush();
			return;
		}
		this.settings.operations[file.path] = 'modify';
		this.debouncedSaveSettings();
		this.scheduleAutoPush();
		this.updateStatusBarPending();
	}

	/**
	 * Updates the status bar to reflect pending local modifications.
	 */
	private updateStatusBarPending(): void {
		if (this.syncing) return;
		const count = Object.keys(this.settings.operations).length;
		if (count > 0) {
			this.statusBar?.setStatus({ type: 'pending', count });
		} else {
			this.statusBar?.setStatus(
				this.settings.refreshToken ? { type: 'idle' } : { type: 'disconnected' },
			);
		}
	}

	/**
	 * Scans the vault for sync conflict copies and updates the status bar alert badge.
	 */
	updateConflictStatus(): void {
		if (this.syncing) return;
		const pairs = findConflictPairs(this.app.vault);
		if (pairs.length > 0) {
			this.statusBar?.setStatus({ type: 'conflict', count: pairs.length });
		} else {
			this.updateStatusBarPending();
		}
	}

	/**
	 * Handles a local file or folder rename event.
	 *
	 * @param file - The renamed vault file.
	 * @param oldPath - Previous path before the rename.
	 */
	handleRename(file: TAbstractFile, oldPath: string): void {
		this.handleDelete({ ...file, path: oldPath });
		this.handleCreate(file);
		this.debouncedSaveSettings();
	}

	/**
	 * Creates a folder in the vault while preserving pending operation queue state.
	 *
	 * @param path - Relative folder path to create.
	 * @returns Promise that resolves once folder is created.
	 */
	async createFolder(path: string): Promise<void> {
		const oldOperation = this.settings.operations[path];
		await this.app.vault.createFolder(path);
		if (oldOperation) this.settings.operations[path] = oldOperation;
		else delete this.settings.operations[path];
	}

	/**
	 * Creates a new binary file in the vault with modification time preservation.
	 *
	 * @param path - Relative vault file path.
	 * @param content - Binary file content.
	 * @param modificationDate - Modification timestamp.
	 * @returns Promise that resolves once the file is written.
	 */
	async createFile(
		path: string,
		content: ArrayBuffer,
		modificationDate?: number | string | Date,
	): Promise<void> {
		const oldOperation = this.settings.operations[path];
		let mtime = typeof modificationDate === 'string' ? new Date(modificationDate).getTime() : modificationDate;
		if (mtime instanceof Date) mtime = mtime.getTime();

		await this.app.vault.createBinary(path, content, { mtime });
		if (oldOperation) this.settings.operations[path] = oldOperation;
		else delete this.settings.operations[path];
	}

	/**
	 * Modifies an existing binary file in the vault with modification time preservation.
	 *
	 * @param file - Active TFile instance to modify.
	 * @param content - Binary file content.
	 * @param modificationDate - Modification timestamp.
	 * @returns Promise that resolves once the file is updated.
	 */
	async modifyFile(
		file: TFile,
		content: ArrayBuffer,
		modificationDate?: number | string | Date,
	): Promise<void> {
		const oldOperation = this.settings.operations[file.path];
		let mtime = typeof modificationDate === 'string' ? new Date(modificationDate).getTime() : modificationDate;
		if (mtime instanceof Date) mtime = mtime.getTime();

		await this.app.vault.modifyBinary(file, content, { mtime });
		if (oldOperation) this.settings.operations[file.path] = oldOperation;
		else delete this.settings.operations[file.path];
	}

	/**
	 * Writes a binary file using the low-level vault adapter.
	 *
	 * @param filePath - Relative path to the file.
	 * @param content - Binary file content.
	 * @param modificationDate - Modification timestamp.
	 * @returns Promise that resolves once written.
	 */
	async upsertFile(
		filePath: string,
		content: ArrayBuffer,
		modificationDate?: number | string | Date,
	): Promise<void> {
		const oldOperation = this.settings.operations[filePath];
		let mtime = typeof modificationDate === 'string' ? new Date(modificationDate).getTime() : modificationDate;
		if (mtime instanceof Date) mtime = mtime.getTime();

		await this.app.vault.adapter.writeBinary(filePath, content, { mtime });
		if (oldOperation) this.settings.operations[filePath] = oldOperation;
		else delete this.settings.operations[filePath];
	}

	/**
	 * Safely trashes a vault file and cleans pending operations.
	 *
	 * @param file - Abstract file to trash.
	 * @returns Promise that resolves once the file is trashed.
	 */
	async deleteFile(file: TAbstractFile): Promise<void> {
		delete this.settings.operations[file.path];
		await this.app.fileManager.trashFile(file);
	}

	/**
	 * Prepares the plugin state and UI indicators for a sync operation.
	 *
	 * @returns Notice instance displaying sync progress.
	 * @throws Error if internet connectivity check fails.
	 */
	async startSync(): Promise<Notice> {
		if (!(await checkConnection())) {
			new Notice('You are not connected to the internet. Please try again when reconnected.');
			throw new Error('No internet connection');
		}
		this.clearAutoPushTimer();
		this.ribbonIcon?.addClass('spin');
		this.syncing = true;
		this.statusBar?.setStatus({ type: 'syncing', progress: 0 });
		return new Notice('Syncing (0%)', 0);
	}

	/**
	 * Concludes a successful synchronization cycle, persisting checkpoints and resetting status.
	 *
	 * @param syncNotice - Active progress Notice to dismiss.
	 * @param retainConfigChanges - Whether to retain configuration file timestamps.
	 * @returns True if synchronization concluded cleanly.
	 */
	async endSync(syncNotice?: Notice, retainConfigChanges = true): Promise<boolean> {
		const syncedAt = Date.now();
		if (retainConfigChanges) {
			const configFilesToSync = await this.drive.getConfigFilesToSync();
			await Promise.all(
				configFilesToSync.map(async (file) =>
					this.app.vault.adapter.writeBinary(
						file,
						await this.app.vault.adapter.readBinary(file),
						{ mtime: Date.now() },
					),
				),
			);
		}

		const changesToken = await this.drive.getChangesStartToken();
		if (!changesToken) {
			new Notice('An error occurred fetching Google Drive changes token.');
			this.abortSync(syncNotice);
			return false;
		}
		this.settings.lastSyncedAt = syncedAt;
		this.settings.changesToken = changesToken;
		await this.saveSettings();
		this.ribbonIcon?.removeClass('spin');
		this.syncing = false;
		syncNotice?.hide();
		this.updateConflictStatus();
		this.resumeAutoPushIfNeeded();
		return true;
	}

	/**
	 * Aborts an active sync operation and returns indicators to idle/pending state.
	 *
	 * @param syncNotice - Optional active Notice to dismiss.
	 */
	abortSync(syncNotice?: Notice): void {
		this.ribbonIcon?.removeClass('spin');
		this.syncing = false;
		syncNotice?.hide();
		if (this.settings.refreshToken) {
			const count = Object.keys(this.settings.operations).length;
			if (count > 0) {
				this.statusBar?.setStatus({ type: 'pending', count });
			} else {
				this.statusBar?.setStatus({ type: 'idle' });
			}
		} else {
			this.statusBar?.setStatus({ type: 'disconnected' });
		}
		this.resumeAutoPushIfNeeded();
	}
}
