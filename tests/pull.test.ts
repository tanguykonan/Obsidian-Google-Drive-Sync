import { beforeEach, describe, expect, it, vi } from 'vitest';

const notices = vi.hoisted(() => [] as string[]);

vi.mock('obsidian', () => {
	class TFile {
		path: string;
		constructor(path: string) {
			this.path = path;
		}
	}
	class TFolder {
		path: string;
		children: { path: string }[] = [];
		constructor(path: string) {
			this.path = path;
		}
	}
	return {
		Notice: class {
			constructor(message: string) {
				notices.push(message);
			}
		},
		requestUrl: vi.fn(),
		TAbstractFile: class {},
		TFile,
		TFolder,
	};
});

import { pull } from '../src/services/sync-pull';
import { TFile } from 'obsidian';
import { encryptData } from '../src/services/crypto/crypto-service';

const createPlugin = () => {
	const adapter = {
		exists: vi.fn(async () => false),
		stat: vi.fn(
			async (
				_path: string,
			): Promise<{ type: 'file' | 'folder' } | undefined> =>
				undefined,
		),
		trashLocal: vi.fn(async () => true),
		trashSystem: vi.fn(async () => true),
		remove: vi.fn(async () => undefined),
		list: vi.fn(async () => ({ files: [], folders: [] })),
		rmdir: vi.fn(async () => undefined),
	};
	const vault = {
		adapter,
		configDir: 'config',
		getAllLoadedFiles: vi.fn((): { path: string }[] => []),
		getAbstractFileByPath: vi.fn(
			(_path: string): TFile | null => null,
		),
		getFileByPath: vi.fn((_path: string) => null),
		getFolderByPath: vi.fn((_path: string) => null),
		getConfig: vi.fn(() => 'local'),
	};
	return {
		accessToken: { token: 'access', expiresAt: Date.now() + 3_600_000 },
		app: { vault },
		settings: {
			lastSyncedAt: 0,
			changesToken: 'changes',
			driveIdToPath: {} as Record<string, string>,
			operations: {} as Record<string, 'create' | 'delete' | 'modify'>,
			e2eeEnabled: false,
			e2eePassword: '',
		},
		drive: {
			searchFiles: vi.fn(
				async (): Promise<unknown[] | undefined> => [],
			),
			getChanges: vi.fn(
				async (): Promise<{ removed: boolean; fileId: string }[]> => [],
			),
			deleteFilesMinimumOperations: vi.fn(async () => undefined),
			getFile: vi.fn(),
		},
		abortSync: vi.fn(),
		endSync: vi.fn(async () => true),
		createFolder: vi.fn(),
		modifyFile: vi.fn(),
		upsertFile: vi.fn(),
	};
};

describe('pull', () => {
	beforeEach(() => {
		notices.length = 0;
	});

	it('finishes a silent no-change pull without advancing the checkpoint itself', async () => {
		const plugin = createPlugin();

		await expect(pull(plugin as never, true)).resolves.toBe(true);

		expect(plugin.endSync).not.toHaveBeenCalled();
		expect(plugin.abortSync).not.toHaveBeenCalled();
	});

	it('aborts when Drive files cannot be listed', async () => {
		const plugin = createPlugin();
		plugin.drive.searchFiles.mockResolvedValueOnce(undefined);

		await expect(pull(plugin as never, true)).resolves.toBe(false);

		expect(plugin.abortSync).toHaveBeenCalledOnce();
	});

	it('reconciles creates, deletes, and renames made while Obsidian was closed', async () => {
		const plugin = createPlugin();
		plugin.settings.driveIdToPath = {
			'old-id': 'old.md',
			'stable-id': 'stable.md',
		};
		plugin.app.vault.getAllLoadedFiles.mockReturnValue([
			{ path: '/' },
			{ path: 'renamed.md' },
			{ path: 'stable.md' },
		]);

		await expect(pull(plugin as never, true)).resolves.toBe(true);

		expect(plugin.settings.operations).toEqual({
			'old.md': 'delete',
			'renamed.md': 'create',
		});
	});

	it('cleans stale operations while preserving config operations', async () => {
		const plugin = createPlugin();
		plugin.settings.driveIdToPath = {
			'stable-id': 'stable.md',
			'missing-id': 'missing.md',
		};
		plugin.settings.operations = {
			'ghost.md': 'create',
			'stable.md': 'delete',
			'missing.md': 'modify',
			'config/plugins/example/data.json': 'modify',
		};
		plugin.app.vault.getAllLoadedFiles.mockReturnValue([
			{ path: '/' },
			{ path: 'stable.md' },
		]);

		await expect(pull(plugin as never, true)).resolves.toBe(true);

		expect(plugin.settings.operations).toEqual({
			'stable.md': 'modify',
			'missing.md': 'delete',
			'config/plugins/example/data.json': 'modify',
		});
	});

	it('uses the preserved ID mapping to trash a remotely deleted config file', async () => {
		const plugin = createPlugin();
		const path = 'config/plugins/example/data.json';
		plugin.settings.driveIdToPath['drive-id'] = path;
		plugin.drive.getChanges.mockResolvedValueOnce([
			{ removed: true, fileId: 'drive-id' },
		]);
		plugin.app.vault.adapter.stat.mockResolvedValueOnce({ type: 'file' });

		await expect(pull(plugin as never, true)).resolves.toBe(true);

		expect(plugin.app.vault.adapter.trashLocal).toHaveBeenCalledWith(path);
		expect(plugin.settings.driveIdToPath).not.toHaveProperty('drive-id');
	});

	it('pulls folders and files while applying regular and config deletions', async () => {
		const plugin = createPlugin();
		const deletedFile = new TFile();
		Object.assign(deletedFile, { path: 'deleted.md' });
		const configPath = 'config/plugins/example/data.json';
		plugin.settings.driveIdToPath = {
			'deleted-id': deletedFile.path,
			'config-id': configPath,
		};
		plugin.app.vault.getAbstractFileByPath.mockImplementation(
			(path: string) => (path === deletedFile.path ? deletedFile : null),
		);
		plugin.app.vault.getAllLoadedFiles.mockReturnValue([
			{ path: deletedFile.path },
		]);
		plugin.app.vault.adapter.stat.mockImplementation(async (path: string) =>
			path === configPath ? { type: 'file' as const } : undefined,
		);
		plugin.drive.searchFiles.mockResolvedValueOnce([
			{
				id: 'folder-id',
				mimeType: 'application/vnd.google-apps.folder',
				properties: { path: 'remote' },
				modifiedTime: '2025-01-01T00:00:00.000Z',
			},
			{
				id: 'note-id',
				mimeType: 'text/markdown',
				properties: { path: 'remote/note.md' },
				modifiedTime: '2025-01-01T00:00:00.000Z',
			},
		]);
		plugin.drive.getChanges.mockResolvedValueOnce([
			{ removed: true, fileId: 'deleted-id' },
			{ removed: true, fileId: 'config-id' },
		]);
		plugin.drive.getFile.mockReturnValue({
			arrayBuffer: vi.fn(async () => new ArrayBuffer(4)),
		});

		await expect(pull(plugin as never, true)).resolves.toBe(true);

		expect(plugin.drive.deleteFilesMinimumOperations).toHaveBeenCalledWith([
			deletedFile,
		]);
		expect(plugin.createFolder).toHaveBeenCalledWith('remote');
		expect(plugin.upsertFile).toHaveBeenCalledWith(
			'remote/note.md',
			expect.any(ArrayBuffer),
			'2025-01-01T00:00:00.000Z',
		);
		expect(plugin.app.vault.adapter.trashLocal).toHaveBeenCalledWith(
			configPath,
		);
		expect(plugin.settings.driveIdToPath).toEqual({
			'folder-id': 'remote',
			'note-id': 'remote/note.md',
		});
	});

	it('decrypts encrypted remote files on pull when E2EE password is provided', async () => {
		const plugin = createPlugin();
		const rawText = '# Confidential note from Drive';
		const plaintext = new TextEncoder().encode(rawText).buffer;
		const encrypted = await encryptData(plaintext, 'my-vault-pass');

		plugin.settings.e2eeEnabled = true;
		plugin.settings.e2eePassword = 'my-vault-pass';

		plugin.drive.searchFiles.mockResolvedValueOnce([
			{
				id: 'encrypted-id',
				mimeType: 'text/markdown',
				properties: { path: 'secret.md' },
				modifiedTime: '2026-01-01T00:00:00.000Z',
			},
		]);
		plugin.drive.getChanges.mockResolvedValueOnce([]);
		plugin.drive.getFile.mockReturnValue({
			arrayBuffer: vi.fn(async () => encrypted),
		});

		await pull(plugin as never, true);

		expect(plugin.upsertFile).toHaveBeenCalledWith(
			'secret.md',
			expect.any(ArrayBuffer),
			'2026-01-01T00:00:00.000Z',
		);
		const calls = plugin.upsertFile.mock.calls;
		expect(calls.length).toBeGreaterThan(0);
		const writtenBuffer = calls[0]![1] as ArrayBuffer;
		expect(new TextDecoder().decode(writtenBuffer)).toBe(rawText);
	});

	it('safely processes plain unencrypted files even when E2EE is enabled', async () => {
		const plugin = createPlugin();
		const rawText = '# Normal unencrypted note';
		const plaintext = new TextEncoder().encode(rawText).buffer;

		plugin.settings.e2eeEnabled = true;
		plugin.settings.e2eePassword = 'my-vault-pass';

		plugin.drive.searchFiles.mockResolvedValueOnce([
			{
				id: 'plain-id',
				mimeType: 'text/markdown',
				properties: { path: 'normal.md' },
				modifiedTime: '2026-01-01T00:00:00.000Z',
			},
		]);
		plugin.drive.getChanges.mockResolvedValueOnce([]);
		plugin.drive.getFile.mockReturnValue({
			arrayBuffer: vi.fn(async () => plaintext),
		});

		await pull(plugin as never, true);

		expect(plugin.upsertFile).toHaveBeenCalled();
		const calls = plugin.upsertFile.mock.calls;
		expect(calls.length).toBeGreaterThan(0);
		const writtenBuffer = calls[0]![1] as ArrayBuffer;
		expect(new TextDecoder().decode(writtenBuffer)).toBe(rawText);
	});

	it('refuses to overwrite local file if encrypted file arrives without configured password', async () => {
		const plugin = createPlugin();
		const plaintext = new TextEncoder().encode('Protected data').buffer;
		const encrypted = await encryptData(plaintext, 'secret-pass');

		plugin.settings.e2eeEnabled = false;
		plugin.settings.e2eePassword = ''; // User has not entered a password

		plugin.drive.searchFiles.mockResolvedValueOnce([
			{
				id: 'encrypted-id',
				mimeType: 'text/markdown',
				properties: { path: 'locked.md' },
				modifiedTime: '2026-01-01T00:00:00.000Z',
			},
		]);
		plugin.drive.getChanges.mockResolvedValueOnce([]);
		plugin.drive.getFile.mockReturnValue({
			arrayBuffer: vi.fn(async () => encrypted),
		});

		await pull(plugin as never, true);

		// Must not write encrypted garbage to vault!
		expect(plugin.upsertFile).not.toHaveBeenCalled();
	});
});
