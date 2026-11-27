/**
 * High-level Google Drive API client.
 * Manages files, folders, searches, metadata, batch deletions, and configuration discovery.
 * @module services/drive-client
 */

import { requestUrl, TAbstractFile, TFolder } from 'obsidian';
import type ObsidianGoogleDrive from '../main';
import type { Change, FileMetadata, QueryMatch, StringSearch, DateComparison, DriveRevision } from '../types';
import { fileNameFromPath, splitPath, unSplitPath } from '../utils/path-utils';
import { batchAsync, foldersToBatches, getSyncMessage } from '../utils/batch';
import { getDriveAgent } from './drive-agent';
import { DRIVE_FS, ENDPOINTS } from '../constants';
import { decryptData, isEncrypted } from './crypto/crypto-service';

export { batchAsync, foldersToBatches, getSyncMessage, fileNameFromPath, splitPath, unSplitPath };

export const folderMimeType = DRIVE_FS.FOLDER_MIME_TYPE;

const BLACKLISTED_CONFIG_FILES: readonly string[] = DRIVE_FS.BLACKLISTED_CONFIG_FILES;
const WHITELISTED_PLUGIN_FILES: readonly string[] = DRIVE_FS.WHITELISTED_PLUGIN_FILES;

const escapeQueryValue = (value: string): string =>
	value.replaceAll('\\', '\\\\').replaceAll("'", "\\'");

const stringSearchToQuery = (search: StringSearch): string | undefined => {
	if (typeof search === 'string') return `='${escapeQueryValue(search)}'`;
	if ('contains' in search) {
		return ` contains '${escapeQueryValue(search.contains)}'`;
	}
	if ('not' in search) return `!='${escapeQueryValue(search.not)}'`;
	return undefined;
};

const queryHandlers = {
	name: (name: StringSearch) => 'name' + stringSearchToQuery(name),
	mimeType: (mimeType: StringSearch) =>
		'mimeType' + stringSearchToQuery(mimeType),
	parent: (parent: string) => `'${escapeQueryValue(parent)}' in parents`,
	starred: (starred: boolean) => `starred=${starred}`,
	query: (query: string) => `fullText contains '${escapeQueryValue(query)}'`,
	properties: (properties: Record<string, string>) =>
		Object.entries(properties)
			.map(
				([key, value]) =>
					`properties has { key='${escapeQueryValue(key)}' and value='${escapeQueryValue(value)}' }`,
			)
			.join(' and '),
	modifiedTime: (modifiedTime: DateComparison) => {
		if ('eq' in modifiedTime) return `modifiedTime='${modifiedTime.eq}'`;
		if ('gt' in modifiedTime) return `modifiedTime>'${modifiedTime.gt}'`;
		if ('lt' in modifiedTime) return `modifiedTime<'${modifiedTime.lt}'`;
		return undefined;
	},
};

/**
 * High-level Google Drive client providing file, folder, revision, and metadata management.
 *
 * @param t - Plugin instance.
 * @returns Object exposing all Google Drive client operations.
 */
export const getDriveClient = (t: ObsidianGoogleDrive) => {
	const drive = getDriveAgent(t);

	const getQuery = (matches: QueryMatch[]) =>
		encodeURIComponent(
			`(${matches
				.map((match) => {
					const entries = Object.entries(match).flatMap(
						([key, value]) =>
							value === undefined
								? []
								: Array.isArray(value)
									? value.map((v) => [key, v as string])
									: [[key, value]],
					);
					return `(${entries
						.map(([key, value]) =>
							queryHandlers[key as keyof QueryMatch](value as never),
						)
						.join(' and ')})`;
				})
				.join(
					' or ',
				)}) and trashed=false and properties has { key='vault' and value='${escapeQueryValue(t.app.vault.getName())}' }`,
		);

	const paginateFiles = async ({
		matches,
		pageToken,
		order = 'descending',
		pageSize = 30,
		include = [],
	}: {
		matches?: QueryMatch[];
		pageToken?: string;
		order?: 'ascending' | 'descending';
		pageSize?: number;
		include?: (keyof FileMetadata)[];
	}): Promise<{ files: FileMetadata[]; nextPageToken?: string }> => {
		const query = matches?.length ? `&q=${getQuery(matches)}` : '';
		const token = pageToken ? `&pageToken=${pageToken}` : '';
		const fields = include.length
			? `nextPageToken,files(${include.join(',')})`
			: 'nextPageToken,files(id,name,description,mimeType,starred,properties,modifiedTime,trashed)';

		return drive
			.get(
				`drive/v3/files?orderBy=modifiedTime ${order}&pageSize=${pageSize}&fields=${fields}${query}${token}`,
			)
			.json<{ files: FileMetadata[]; nextPageToken?: string }>();
	};

	const searchFiles = async ({
		matches,
		include,
	}: {
		matches?: QueryMatch[];
		include?: (keyof FileMetadata)[];
	}): Promise<FileMetadata[] | undefined> => {
		try {
			const files: FileMetadata[] = [];
			let nextPageToken: string | undefined = undefined;
			do {
				const response = await paginateFiles({
					matches,
					pageToken: nextPageToken,
					include,
					pageSize: 100,
				});
				files.push(...response.files);
				nextPageToken = response.nextPageToken;
			} while (nextPageToken);
			return files;
		} catch (error) {
			console.error('Failed to search Google Drive files', error);
			return undefined;
		}
	};

	/**
	 * Locates or creates the top-level master folder on Google Drive ("Obsidian-Google-Drive").
	 * All vault folders are grouped inside this central master folder to avoid root clutter.
	 */
	const getOrCreateAppParentFolderId = async (): Promise<string | undefined> => {
		const parentName = DRIVE_FS.PARENT_APP_FOLDER_NAME;
		const results = await searchFiles({
			matches: [
				{
					name: parentName,
					mimeType: folderMimeType,
				},
			],
			include: ['id', 'trashed'],
		});

		const existing = results?.find((file) => !file.trashed);
		if (existing?.id) {
			return existing.id;
		}

		const metadata: Record<string, unknown> = {
			name: parentName,
			mimeType: folderMimeType,
			description: 'Master folder for all Obsidian vaults synced by Google Drive Sync',
		};

		const result = await drive
			.post('drive/v3/files?fields=id', { json: metadata })
			.json<{ id: string }>();

		return result?.id;
	};

	const getRootFolderId = async (forceSearch = false): Promise<string | undefined> => {
		if (t.settings.rootFolderId && !forceSearch) {
			return t.settings.rootFolderId;
		}

		const vaultName = t.app.vault.getName();
		const results = await searchFiles({
			matches: [
				{
					name: vaultName,
					mimeType: folderMimeType,
					properties: { vault: vaultName },
				},
			],
			include: ['id', 'trashed'],
		});

		const existing = results?.find((file) => !file.trashed);
		if (existing?.id) {
			t.settings.rootFolderId = existing.id;
			await t.saveSettings();
			return existing.id;
		}

		// Ensure the parent "Obsidian-Google-Drive" directory exists first
		const appParentFolderId = await getOrCreateAppParentFolderId();

		const folderId = await createFolder({
			name: vaultName,
			parent: appParentFolderId,
			description: `Obsidian vault folder for "${vaultName}" created by Google Drive Sync`,
			properties: { vault: vaultName },
		});

		if (folderId) {
			t.settings.rootFolderId = folderId;
			await t.saveSettings();
			return folderId;
		}

		return undefined;
	};

	const createFolder = async ({
		name,
		parent,
		description,
		properties,
		modifiedTime,
	}: {
		name: string;
		parent?: string;
		description?: string;
		properties?: Record<string, string>;
		modifiedTime?: string;
	}): Promise<string | undefined> => {
		if (!parent) {
			parent = await getRootFolderId();
			if (!parent) return undefined;
		}

		const metadata: Record<string, unknown> = {
			name,
			mimeType: folderMimeType,
			parents: [parent],
			description,
			properties: {
				vault: t.app.vault.getName(),
				...properties,
			},
		};
		if (modifiedTime) metadata.modifiedTime = modifiedTime;

		const result = await drive
			.post('drive/v3/files?fields=id', { json: metadata })
			.json<{ id: string }>();

		return result?.id;
	};

	const uploadFile = async (
		file: Blob,
		name: string,
		parent?: string,
		metadata: Partial<Omit<FileMetadata, 'id'>> = {},
	): Promise<string | undefined> => {
		if (!parent) {
			parent = await getRootFolderId();
			if (!parent) return undefined;
		}

		const fileMetadata = {
			name,
			mimeType: file.type || 'application/octet-stream',
			parents: [parent],
			...metadata,
			properties: {
				vault: t.app.vault.getName(),
				...(metadata.properties || {}),
			},
		};

		const form = new FormData();
		form.append(
			'metadata',
			new Blob([JSON.stringify(fileMetadata)], { type: 'application/json' }),
		);
		form.append('file', file);

		const result = await drive
			.post('upload/drive/v3/files?uploadType=multipart&fields=id', {
				body: form,
			})
			.json<{ id: string }>();

		return result?.id;
	};

	const updateFile = async (
		id: string,
		newContent: Blob,
		newMetadata: Partial<Omit<FileMetadata, 'id'>> = {},
	): Promise<string | undefined> => {
		const form = new FormData();
		form.append(
			'metadata',
			new Blob([JSON.stringify(newMetadata)], {
				type: 'application/json',
			}),
		);
		form.append('file', newContent);

		const result = await drive
			.patch(`upload/drive/v3/files/${id}?uploadType=multipart&fields=id`, {
				body: form,
			})
			.json<{ id: string }>();

		return result?.id;
	};

	const updateFileMetadata = async (
		id: string,
		metadata: Partial<Omit<FileMetadata, 'id'>>,
	): Promise<string | undefined> => {
		const result = await drive
			.patch(`drive/v3/files/${id}?fields=id`, { json: metadata })
			.json<{ id: string }>();
		return result?.id;
	};

	const deleteFile = async (id: string): Promise<boolean | undefined> => {
		const result = await drive.delete(`drive/v3/files/${id}`);
		if (!result.ok) return undefined;
		return true;
	};

	const getFile = (id: string) =>
		drive.get(`drive/v3/files/${id}?alt=media&acknowledgeAbuse=true`);

	const getFileMetadata = (id: string) =>
		drive.get(`drive/v3/files/${id}`).json<FileMetadata>();

	/**
	 * Lists all revisions for a given Google Drive file.
	 * @param fileId The Google Drive file ID.
	 * @returns Array of file revisions sorted from newest to oldest.
	 */
	const getFileRevisions = async (fileId: string): Promise<DriveRevision[]> => {
		try {
			const res = await drive
				.get(
					`drive/v3/files/${fileId}/revisions?fields=revisions(id,modifiedTime,size,keepForever,originalFilename,mimeType)&pageSize=100`,
				)
				.json<{ revisions?: DriveRevision[] }>();
			const revisions = res.revisions ?? [];
			return revisions.sort(
				(a, b) =>
					new Date(b.modifiedTime).getTime() - new Date(a.modifiedTime).getTime(),
			);
		} catch (error) {
			console.error(`Failed to fetch revisions for file ${fileId}`, error);
			throw error;
		}
	};

	/**
	 * Retrieves the text content of a specific file revision.
	 * @param fileId The Google Drive file ID.
	 * @param revisionId The revision identifier.
	 * @returns The text content of the revision.
	 */
	const getRevisionContent = async (
		fileId: string,
		revisionId: string,
		e2eePassword?: string,
	): Promise<string> => {
		const res = await drive.get(
			`drive/v3/files/${fileId}/revisions/${revisionId}?alt=media&acknowledgeAbuse=true`,
		);
		const buffer = await res.arrayBuffer();
		if (buffer && isEncrypted(buffer) && e2eePassword) {
			const decrypted = await decryptData(buffer, e2eePassword);
			return new TextDecoder().decode(decrypted);
		}
		if (buffer) {
			return new TextDecoder().decode(buffer);
		}
		return res.text();
	};

	/**
	 * Retrieves the binary ArrayBuffer of a specific file revision.
	 * @param fileId The Google Drive file ID.
	 * @param revisionId The revision identifier.
	 * @returns ArrayBuffer containing raw binary data.
	 */
	const getRevisionBinary = async (
		fileId: string,
		revisionId: string,
	): Promise<ArrayBuffer> => {
		const res = await drive.get(
			`drive/v3/files/${fileId}/revisions/${revisionId}?alt=media&acknowledgeAbuse=true`,
		);
		return res.arrayBuffer();
	};

	const idFromPath = async (path: string): Promise<string | undefined> => {
		const files = await searchFiles({
			matches: [{ properties: splitPath(path) }],
		});
		if (!files?.length) return undefined;
		return files[0]?.id;
	};

	const idsFromPaths = async (paths: string[]) => {
		const files = await searchFiles({
			matches: paths.map((path) => ({ properties: splitPath(path) })),
		});
		if (!files) return undefined;
		return files.map((file) => ({
			id: file.id,
			path: unSplitPath(file.properties),
		}));
	};

	const getChangesStartToken = async (): Promise<string | undefined> => {
		try {
			const res = await drive
				.get('drive/v3/changes/startPageToken')
				.json<{ startPageToken: string }>();
			return res?.startPageToken;
		} catch (error) {
			console.error('Failed to get changes start token', error);
			return undefined;
		}
	};

	interface ChangesApiResponse {
		changes?: Change[];
		nextPageToken?: string;
		newStartPageToken?: string;
	}

	const getChanges = async (pageToken: string): Promise<Change[] | undefined> => {
		try {
			const changes: Change[] = [];
			let nextToken: string | undefined = pageToken;
			do {
				const res: ChangesApiResponse = await drive
					.get(
						`drive/v3/changes?pageToken=${nextToken}&fields=nextPageToken,newStartPageToken,changes(kind,removed,fileId,time,file(id,name,description,mimeType,starred,properties,modifiedTime,trashed))`,
					)
					.json<ChangesApiResponse>();
				if (res.changes) {
					changes.push(...res.changes);
				}
				nextToken = res.nextPageToken;
			} while (nextToken);
			return changes;
		} catch (error) {
			console.error('Failed to get Drive changes', error);
			return undefined;
		}
	};

	const batchDelete = async (ids: string[]): Promise<boolean | undefined> => {
		if (!ids.length) return true;

		for (let offset = 0; offset < ids.length; offset += 100) {
			const batch = ids.slice(offset, offset + 100);
			const boundary = `batch_${crypto.randomUUID()}`;
			const body =
				batch
					.map((fileId, index) =>
						[
							`--${boundary}`,
							'Content-Type: application/http',
							`Content-ID: <request_${offset + index + 1}>`,
							'',
							`DELETE /drive/v3/files/${fileId} HTTP/1.1`,
							'',
						].join('\r\n'),
					)
					.concat(`--${boundary}--`)
					.join('\r\n') + '\r\n';

			const response = await drive.post('batch/drive/v3', {
				headers: {
					'Content-Type': `multipart/mixed; boundary=${boundary}`,
				},
				body,
			});
			if (!response.ok) return undefined;

			const result = await response.text();
			const statuses = Array.from(
				result.matchAll(/HTTP\/1\.1 (\d{3})/g),
				(match) => Number(match[1]),
			);
			if (
				statuses.length !== batch.length ||
				statuses.some((status) => status < 200 || status >= 300)
			) {
				return undefined;
			}
		}

		return true;
	};

	const deleteFilesMinimumOperations = async (
		files: (TAbstractFile | null | undefined)[],
	): Promise<void> => {
		let validFiles = files.filter(
			(file): file is TAbstractFile => file instanceof TAbstractFile,
		);
		const folders = validFiles.filter((file) => file instanceof TFolder);

		if (folders.length) {
			const maxDepth = Math.max(
				...folders.map(({ path }) => path.split('/').length),
			);

			for (let depth = 1; depth <= maxDepth; depth++) {
				const foldersToDelete = validFiles.filter(
					(file) =>
						file instanceof TFolder &&
						file.path.split('/').length === depth,
				);
				await Promise.all(
					foldersToDelete.map((folder) => t.deleteFile(folder)),
				);
				foldersToDelete.forEach((folder) => {
					validFiles = validFiles.filter(
						({ path }) =>
							!path.startsWith(folder.path + '/') &&
							path !== folder.path,
					);
				});
			}
		}

		await Promise.all(validFiles.map((file) => t.deleteFile(file)));
	};

	const getConfigFilesToSync = async (): Promise<string[]> => {
		const configFilesToSync: string[] = [];
		const { vault } = t.app;
		const { adapter } = vault;

		const [configFiles, plugins] = await Promise.all([
			adapter.list(vault.configDir),
			adapter.list(vault.configDir + '/plugins'),
		]);

		await Promise.all(
			configFiles.files
				.filter(
					(path) =>
						!BLACKLISTED_CONFIG_FILES.includes(fileNameFromPath(path)),
				)
				.map(async (path) => {
					const file = await adapter.stat(path);
					if ((file?.mtime || 0) > t.settings.lastSyncedAt) {
						configFilesToSync.push(path);
					}
				})
				.concat(
					plugins.folders
						.filter(
							(pluginFolder) =>
								!DRIVE_FS.SENSITIVE_PLUGIN_IDS.some(
									(id) =>
										pluginFolder.endsWith(`/${id}`) ||
										pluginFolder.endsWith(`\\${id}`),
								),
						)
						.map(async (pluginFolder) => {
							const files = await adapter.list(pluginFolder);
							await Promise.all(
								files.files
									.filter((path) =>
										WHITELISTED_PLUGIN_FILES.includes(
											fileNameFromPath(path),
										),
									)
									.map(async (path) => {
										const file = await adapter.stat(path);
										if (
											(file?.mtime || 0) >
											t.settings.lastSyncedAt
										) {
											configFilesToSync.push(path);
										}
									}),
							);
						}),
				),
		);

		return configFilesToSync;
	};

	return {
		paginateFiles,
		searchFiles,
		getOrCreateAppParentFolderId,
		getRootFolderId,
		createFolder,
		uploadFile,
		updateFile,
		updateFileMetadata,
		deleteFile,
		getFile,
		getFileMetadata,
		getFileRevisions,
		getRevisionContent,
		getRevisionBinary,
		idFromPath,
		idsFromPaths,
		getChangesStartToken,
		getChanges,
		batchDelete,
		checkConnection,
		deleteFilesMinimumOperations,
		getConfigFilesToSync,
	};
};

/**
 * Tests connectivity to Google's servers via a lightweight HTTP 204 ping.
 *
 * @returns Promise resolving to true if internet connectivity is confirmed.
 */
export const checkConnection = async (): Promise<boolean> => {
	try {
		const result = await requestUrl({
			url: ENDPOINTS.GOOGLE_CONNECTIVITY_PING,
			throw: false,
		});
		return result.status >= 200 && result.status < 300;
	} catch {
		return false;
	}
};
