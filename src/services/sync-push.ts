/**
 * Synchronization Push service: uploads local creations, modifications, and deletions to Google Drive.
 * @module services/sync-push
 */

import { Notice, TFile, TFolder } from 'obsidian';
import type ObsidianGoogleDrive from '../main';
import {
	batchAsync,
	fileNameFromPath,
	foldersToBatches,
	getSyncMessage,
} from './drive-client';
import { pull } from './sync-pull';
import { splitPath, unSplitPath } from '../utils/path-utils';
import { ConfirmPushModal } from '../ui/confirm-push-modal';
import { activityLogger } from './sync/activity-log-service';
import { encryptData } from './crypto/crypto-service';

/**
 * Pushes pending local vault changes to Google Drive.
 *
 * @param plugin - Plugin instance.
 * @param skipConfirmation - When true, bypasses the modal prompt (used in auto-push).
 */
export const push = async (
	plugin: ObsidianGoogleDrive,
	skipConfirmation = false,
): Promise<void> => {
	if (plugin.syncing) return;
	const initialOperations = Object.entries(plugin.settings.operations).sort(
		([a], [b]) => (a < b ? -1 : a > b ? 1 : 0),
	);

	const { vault } = plugin.app;
	const adapter = vault.adapter;

	const proceed =
		skipConfirmation ||
		(await new Promise<boolean>((resolve) => {
			new ConfirmPushModal(plugin, initialOperations, resolve).open();
		}));

	if (!proceed) return;

	activityLogger.log('info', `Push initiated with ${initialOperations.length} pending operation(s)`);

	const syncNotice = await plugin.startSync();
	try {
		if (!(await pull(plugin, true))) return;
		if (!(await plugin.drive.getRootFolderId(true))) {
			new Notice('Could not verify the Google Drive vault folder.');
			return;
		}

		const operations = Object.entries(plugin.settings.operations);
		const deletes = operations.filter(([_, op]) => op === 'delete');
		const creates = operations.filter(([_, op]) => op === 'create');
		const modifies = operations.filter(([_, op]) => op === 'modify');

		const pathsToIds = Object.fromEntries(
			Object.entries(plugin.settings.driveIdToPath).map(([id, path]) => [
				path,
				id,
			]),
		);

		const configOnDrive = await plugin.drive.searchFiles({
			include: ['properties'],
			matches: [{ properties: { config: 'true' } }],
		});
		if (!configOnDrive) {
			new Notice('An error occurred fetching Google Drive files.');
			return;
		}

		await Promise.all(
			configOnDrive.map(async ({ properties }) => {
				const path = unSplitPath(properties);
				if (!(await adapter.exists(path))) {
					deletes.push([path, 'delete']);
				}
			}),
		);

		if (deletes.length) {
			const idsToDelete = deletes.map(([path]) => pathsToIds[path]);
			if (idsToDelete.some((id) => !id)) {
				new Notice('Could not identify all Google Drive files to delete.');
				return;
			}

			const uniqueIds = [...new Set(idsToDelete as string[])];
			const deleteRequest = await plugin.drive.batchDelete(uniqueIds);
			if (!deleteRequest) {
				new Notice('An error occurred deleting Google Drive files.');
				activityLogger.log('error', 'Failed to delete files on Google Drive');
				return;
			}
			uniqueIds.forEach((id) => delete plugin.settings.driveIdToPath[id]);
			deletes.forEach(([path]) => {
				activityLogger.log('delete', 'Deleted file from Google Drive', path);
			});
		}

		syncNotice.setMessage('Syncing (33%)');

		if (creates.length) {
			let completed = 0;
			const files = creates.map(([path]) =>
				vault.getAbstractFileByPath(path),
			);

			const folders = files.filter(
				(file): file is TFolder => file instanceof TFolder,
			);

			if (folders.length) {
				const batches = foldersToBatches(folders);

				for (const batch of batches) {
					await batchAsync(
						batch.map((folder) => async () => {
							const id = await plugin.drive.createFolder({
								name: folder.name,
								parent: folder.parent
									? pathsToIds[folder.parent.path]
									: undefined,
								properties: splitPath(folder.path),
								modifiedTime: new Date().toISOString(),
							});
							if (!id) {
								new Notice(
									'An error occurred creating Google Drive folders.',
								);
								return;
							}

							completed++;
							syncNotice.setMessage(
								getSyncMessage(33, 66, completed, files.length),
							);

							plugin.settings.driveIdToPath[id] = folder.path;
							pathsToIds[folder.path] = id;
						}),
					);
				}
			}

			const notes = files.filter(
				(file): file is TFile => file instanceof TFile,
			);

			await batchAsync(
				notes.map((note) => async () => {
					let rawData = await vault.readBinary(note);
					if (plugin.settings.e2eeEnabled && plugin.settings.e2eePassword) {
						rawData = await encryptData(rawData, plugin.settings.e2eePassword);
					}
					const id = await plugin.drive.uploadFile(
						new Blob([rawData]),
						note.name,
						note.parent ? pathsToIds[note.parent.path] : undefined,
						{
							properties: splitPath(note.path),
							modifiedTime: new Date().toISOString(),
						},
					);
					if (!id) {
						new Notice(
							'An error occurred creating Google Drive files.',
						);
						return;
					}

					completed++;
					syncNotice.setMessage(
						getSyncMessage(33, 66, completed, files.length),
					);

					plugin.settings.driveIdToPath[id] = note.path;
					activityLogger.log('push', 'Uploaded new note to Google Drive', note.path);
				}),
			);
		}

		if (modifies.length) {
			let completed = 0;
			const files = modifies
				.map(([path]) => vault.getFileByPath(path))
				.filter((file): file is TFile => file instanceof TFile);

			const pathToId = Object.fromEntries(
				Object.entries(plugin.settings.driveIdToPath).map(([id, path]) => [
					path,
					id,
				]),
			);

			await batchAsync(
				files.map((file) => async () => {
					let rawData = await vault.readBinary(file);
					if (plugin.settings.e2eeEnabled && plugin.settings.e2eePassword) {
						rawData = await encryptData(rawData, plugin.settings.e2eePassword);
					}
					const id = await plugin.drive.updateFile(
						pathToId[file.path] as string,
						new Blob([rawData]),
						{ modifiedTime: new Date().toISOString() },
					);
					if (!id) {
						new Notice(
							'An error occurred modifying Google Drive files.',
						);
						return;
					}

					completed++;
					activityLogger.log('push', 'Updated note on Google Drive', file.path);
					syncNotice.setMessage(
						getSyncMessage(66, 99, completed, files.length),
					);
				}),
			);
		}

		const configFilesToSync = await plugin.drive.getConfigFilesToSync();

		const foldersToCreate = new Set<string>();
		configFilesToSync.forEach((path) => {
			const parts = path.split('/');
			for (let i = 1; i < parts.length; i++) {
				foldersToCreate.add(parts.slice(0, i).join('/'));
			}
		});

		foldersToCreate.forEach((folder) => {
			if (pathsToIds[folder]) foldersToCreate.delete(folder);
		});

		if (foldersToCreate.size) {
			const batches = foldersToBatches(Array.from(foldersToCreate));

			for (const batch of batches) {
				await batchAsync(
					batch.map((folder) => async () => {
						const id = await plugin.drive.createFolder({
							name: folder.split('/').pop() || '',
							parent: pathsToIds[
								folder.split('/').slice(0, -1).join('/')
							],
							properties: {
								...splitPath(folder),
								config: 'true',
							},
							modifiedTime: new Date().toISOString(),
						});
						if (!id) {
							new Notice(
								'An error occurred creating Google Drive folders.',
							);
							return;
						}

						plugin.settings.driveIdToPath[id] = folder;
						pathsToIds[folder] = id;
					}),
				);
			}
		}

		await batchAsync(
			configFilesToSync.map((path) => async () => {
				if (pathsToIds[path]) {
					await plugin.drive.updateFile(
						pathsToIds[path],
						new Blob([await adapter.readBinary(path)]),
						{ modifiedTime: new Date().toISOString() },
					);
					return;
				}

				const id = await plugin.drive.uploadFile(
					new Blob([await adapter.readBinary(path)]),
					fileNameFromPath(path),
					pathsToIds[path.split('/').slice(0, -1).join('/')],
					{
						properties: { ...splitPath(path), config: 'true' },
						modifiedTime: new Date().toISOString(),
					},
				);
				if (!id) {
					new Notice(
						'An error occurred creating Google Drive config files.',
					);
					return;
				}

				plugin.settings.driveIdToPath[id] = path;
				pathsToIds[path] = id;
			}),
		);

		// SECURITY NOTE: We deliberately DO NOT upload google-drive-sync-plus/data.json!
		// Settings contain sensitive OAuth tokens and device-local state.

		plugin.settings.operations = {};

		if (!(await plugin.endSync(syncNotice, false))) return;

		activityLogger.log('info', 'Push synchronization completed successfully');
		new Notice('Sync complete!');
	} finally {
		if (plugin.syncing) plugin.abortSync(syncNotice);
	}
};
