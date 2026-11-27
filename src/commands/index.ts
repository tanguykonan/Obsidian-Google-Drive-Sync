/**
 * Command registrations for the Google Drive Sync plugin.
 * Centralizes all user-invokable commands available in Obsidian's command palette.
 * @module commands
 */

import type ObsidianGoogleDrive from '../main';
import { pull } from '../services/sync-pull';
import { push } from '../services/sync-push';
import { reset } from '../services/sync-reset';
import { fixDrivePath } from '../utils/path-utils';
import { startGoogleOAuthFlow } from '../services/auth/token-service';
import { openConflictResolver } from '../ui/conflict-list-modal';
import { FileRevisionsModal } from '../ui/file-revisions-modal';

/**
 * Registers all plugin commands with the Obsidian application.
 *
 * @param plugin - Plugin instance.
 */
export function registerPluginCommands(plugin: ObsidianGoogleDrive): void {
	plugin.addCommand({
		id: 'connect-google-drive',
		name: 'Connect to Google Drive (1-click)',
		callback: () => void startGoogleOAuthFlow(plugin),
	});

	plugin.addCommand({
		id: 'push',
		name: 'Push to Google Drive',
		callback: () => void push(plugin),
	});

	plugin.addCommand({
		id: 'pull',
		name: 'Pull from Google Drive',
		callback: () => void pull(plugin),
	});

	plugin.addCommand({
		id: 'reset',
		name: 'Reset local vault to Google Drive',
		callback: () => void reset(plugin),
	});

	plugin.addCommand({
		id: 'fix-drive-path',
		name: 'Fix Google Drive paths',
		callback: () => void fixDrivePath(plugin),
	});

	plugin.addCommand({
		id: 'resolve-conflicts',
		name: 'Resolve sync conflicts (visual diff)',
		callback: () =>
			openConflictResolver(plugin.app, () => plugin.updateConflictStatus()),
	});

	plugin.addCommand({
		id: 'show-version-history',
		name: 'Show Google Drive version history for active file',
		checkCallback: (checking: boolean) => {
			const activeFile = plugin.app.workspace.getActiveFile();
			if (!activeFile) return false;
			if (checking) return true;
			new FileRevisionsModal(plugin.app, plugin, activeFile).open();
			return true;
		},
	});

	plugin.addCommand({
		id: 'open-activity-log',
		name: 'Open sync activity log',
		callback: () => void plugin.activateActivityLogView(),
	});
}
