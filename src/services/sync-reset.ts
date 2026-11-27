/**
 * Reset service: wipes pending local operations and resynchronizes all files from Google Drive.
 * @module services/sync-reset
 */

import { Notice, TAbstractFile, TFile } from 'obsidian';
import type ObsidianGoogleDrive from '../main';
import {
	batchAsync,
	folderMimeType,
	foldersToBatches,
	getSyncMessage,
} from './drive-client';
import { pull } from './sync-pull';
import { splitPath, unSplitPath } from '../utils/path-utils';
import { ConfirmResetModal } from '../ui/confirm-reset-modal';

/**
 * Resets local vault changes by pulling and overwriting from Google Drive state.
 *
 * @param plugin - Plugin instance.
 */
export const reset = async (plugin: ObsidianGoogleDrive): Promise<void> => {
	if (plugin.syncing) return;

	const proceed = await new Promise<boolean>((resolve) => {
		new ConfirmResetModal(plugin, resolve).open();
	});
	if (!proceed) return;

	const syncNotice = await plugin.startSync();
	try {
		if (!(await pull(plugin, true))) return;

		const { vault } = plugin.app;
		const operations = Object.entries(plugin.settings.operations);
		const deletes = operations.filter(([_, op]) => op === 'delete');
		const creates = operations.filter(([_, op]) => op === 'create');
		const modifies = operations.filter(([_, op]) => op === 'modify');

		const filePathToId = Object.fromEntries(
			Object.entries(plugin.settings.driveIdToPath).map(([id, path]) => [
				path,
				id,
			]),
		);

		if (creates.length) {
			await plugin.drive.deleteFilesMinimumOperations(
				creates
					.map(([path]) => vault.getAbstractFileByPath(path))
					.filter((file): file is TAbstractFile => file instanceof TAbstractFile),
			);
		}

		syncNotice.setMessage('Syncing (33%)');

		if (modifies.length) {
			let completed = 0;
			const files = modifies
				.map(([path]) => vault.getFileByPath(path))
				.filter((file): file is TFile => file instanceof TFile);

			await batchAsync(
				files.map((file) => async () => {
					const [onlineFile, metadata] = await Promise.all([
						plugin.drive
							.getFile(filePathToId[file.path] as string)
							.arrayBuffer(),
						plugin.drive.getFileMetadata(
							filePathToId[file.path] as string,
						),
					]);
					if (!onlineFile || !metadata) {
						new Notice('An error occurred fetching Google Drive files.');
						return;
					}

					completed++;
					syncNotice.setMessage(
						getSyncMessage(33, 66, completed, files.length),
					);
					return plugin.modifyFile(
						file,
						onlineFile,
						metadata.modifiedTime,
					);
				}),
			);
		}

		if (deletes.length) {
			const files = await plugin.drive.searchFiles({
				include: ['id', 'mimeType', 'properties', 'modifiedTime'],
				matches: deletes.map(([path]) => ({
					properties: splitPath(path),
				})),
			});
			if (!files) {
				new Notice('An error occurred fetching Google Drive files.');
				return;
			}

			const pathToFile = Object.fromEntries(
				files.map((file) => [unSplitPath(file.properties), file]),
			);

			const deletedFolders = deletes.filter(
				([path]) => pathToFile[path]?.mimeType === folderMimeType,
			);

			if (deletedFolders.length) {
				const batches = foldersToBatches(
					deletedFolders.map(([path]) => path),
				);
				for (const batch of batches) {
					await Promise.all(
						batch.map((folder) => plugin.createFolder(folder)),
					);
				}
			}

			let completed = 0;
			const deletedFiles = deletes.filter(
				([path]) => pathToFile[path]?.mimeType !== folderMimeType,
			);

			if (deletedFiles.length) {
				await batchAsync(
					deletedFiles.map(([path]) => async () => {
						const onlineFile = await plugin.drive
							.getFile(filePathToId[path] as string)
							.arrayBuffer();
						if (!onlineFile) {
							new Notice('An error occurred fetching Google Drive files.');
							return;
						}

						completed++;
						syncNotice.setMessage(
							getSyncMessage(66, 99, completed, deletedFiles.length),
						);
						return plugin.createFile(
							path,
							onlineFile,
							pathToFile[path]?.modifiedTime,
						);
					}),
				);
			}
		}

		plugin.settings.operations = {};

		if (!(await plugin.endSync(syncNotice))) return;
		new Notice('Reset complete.');
	} finally {
		if (plugin.syncing) plugin.abortSync(syncNotice);
	}
};
