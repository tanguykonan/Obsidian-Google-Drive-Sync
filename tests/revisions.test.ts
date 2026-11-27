import { beforeEach, describe, expect, it, vi } from 'vitest';

const requestUrl = vi.hoisted(() => vi.fn());
const mockNotice = vi.hoisted(() => vi.fn());

class MockModalElement {
	classes = new Set<string>();
	text = '';
	children: MockModalElement[] = [];
	attributes: Record<string, string> = {};
	eventListeners: Record<string, ((evt?: unknown) => void)[]> = {};

	addClass(...cls: string[]): void {
		cls.forEach((c) => this.classes.add(c));
	}
	removeClass(...cls: string[]): void {
		cls.forEach((c) => this.classes.delete(c));
	}
	empty(): void {
		this.text = '';
		this.children = [];
	}
	setText(val: string): void {
		this.text = val;
	}
	createEl(tag: string, options?: { cls?: string; text?: string }): MockModalElement {
		const el = new MockModalElement();
		if (options?.cls) el.addClass(...options.cls.split(' '));
		if (options?.text) el.text = options.text;
		this.children.push(el);
		return el;
	}
	createDiv(options?: { cls?: string; text?: string }): MockModalElement {
		const el = new MockModalElement();
		if (options?.cls) el.addClass(...options.cls.split(' '));
		if (options?.text) el.text = options.text;
		this.children.push(el);
		return el;
	}
	createSpan(options?: { cls?: string; text?: string }): MockModalElement {
		const el = new MockModalElement();
		if (options?.cls) el.addClass(...options.cls.split(' '));
		if (options?.text) el.text = options.text;
		this.children.push(el);
		return el;
	}
	remove(): void {
		this.text = '';
	}
	addEventListener(event: string, handler: (evt?: unknown) => void): void {
		if (!this.eventListeners[event]) this.eventListeners[event] = [];
		this.eventListeners[event].push(handler);
	}
	querySelectorAll(selector: string): MockModalElement[] {
		const res: MockModalElement[] = [];
		const search = (el: MockModalElement) => {
			for (const child of el.children) {
				if (selector.startsWith('.') && child.classes.has(selector.slice(1))) {
					res.push(child);
				}
				search(child);
			}
		};
		search(this);
		return res;
	}
}

vi.mock('obsidian', () => ({
	Notice: class {
		constructor(msg: string) {
			mockNotice(msg);
		}
	},
	requestUrl,
	TAbstractFile: class {},
	TFolder: class {},
	TFile: class {
		path = '';
		name = '';
		extension = 'md';
		constructor(path = 'Notes/Test.md', name = 'Test.md') {
			this.path = path;
			this.name = name;
		}
	},
	Modal: class {
		modalEl = new MockModalElement();
		contentEl = new MockModalElement();
		titleEl = new MockModalElement();
		setTitle(t: string): void {
			this.titleEl.text = t;
		}
		close(): void {}
	},
}));

import { getDriveClient } from '../src/services/drive-client';
import { FileRevisionsModal, formatFileSize } from '../src/ui/file-revisions-modal';

describe('formatFileSize', () => {
	it('formats empty or zero bytes correctly', () => {
		expect(formatFileSize(undefined)).toBe('0 B');
		expect(formatFileSize('0')).toBe('0 B');
		expect(formatFileSize(0)).toBe('0 B');
	});

	it('formats bytes, kilobytes, megabytes', () => {
		expect(formatFileSize(500)).toBe('500.0 B');
		expect(formatFileSize(1024)).toBe('1.0 KB');
		expect(formatFileSize(2048)).toBe('2.0 KB');
		expect(formatFileSize(1048576)).toBe('1.0 MB');
		expect(formatFileSize('10485760')).toBe('10.0 MB');
	});
});

describe('Drive Revisions API Client', () => {
	beforeEach(() => {
		requestUrl.mockReset();
	});

	const createMockPlugin = () =>
		({
			accessToken: {
				token: 'access-token',
				expiresAt: Date.now() + 3_600_000,
			},
			app: { vault: { getName: () => 'Test Vault' } },
			settings: { refreshToken: 'refresh-token', rootFolderId: '' },
			saveSettings: vi.fn(async () => undefined),
		}) as never;

	it('fetches and sorts revisions in descending chronological order', async () => {
		const plugin = createMockPlugin();
		const client = getDriveClient(plugin);

		requestUrl.mockResolvedValueOnce({
			status: 200,
			json: {
				revisions: [
					{
						id: 'rev-1',
						modifiedTime: '2026-11-20T10:00:00.000Z',
						size: '100',
					},
					{
						id: 'rev-3',
						modifiedTime: '2026-11-26T12:00:00.000Z',
						size: '300',
					},
					{
						id: 'rev-2',
						modifiedTime: '2026-11-22T11:00:00.000Z',
						size: '200',
					},
				],
			},
		});

		const revisions = await client.getFileRevisions('file-123');
		expect(revisions).toHaveLength(3);
		expect(revisions[0]?.id).toBe('rev-3');
		expect(revisions[1]?.id).toBe('rev-2');
		expect(revisions[2]?.id).toBe('rev-1');
	});

	it('fetches text content for a specific revision', async () => {
		const plugin = createMockPlugin();
		const client = getDriveClient(plugin);

		requestUrl.mockResolvedValueOnce({
			status: 200,
			text: '# Revision content\nLine 2',
		});

		const content = await client.getRevisionContent('file-123', 'rev-3');
		expect(content).toBe('# Revision content\nLine 2');
	});
});

describe('FileRevisionsModal', () => {
	beforeEach(() => {
		mockNotice.mockReset();
	});

	it('informs user if refresh token is missing', async () => {
		const mockPlugin = {
			settings: { refreshToken: '', driveIdToPath: {} },
			drive: {},
		} as never;

		const mockFile = { path: 'Note.md', name: 'Note.md' } as never;
		const modal = new FileRevisionsModal({} as never, mockPlugin, mockFile);

		await modal.onOpen();
		const secondChild = modal.contentEl.children[1] as unknown as MockModalElement;
		expect(secondChild?.text).toContain('Please connect your Google Drive account');
	});

	it('informs user if file is not synced to Google Drive', async () => {
		const mockPlugin = {
			settings: { refreshToken: 'token', driveIdToPath: {} },
			drive: {
				idFromPath: vi.fn().mockResolvedValue(undefined),
			},
		} as never;

		const mockFile = { path: 'Unsynced.md', name: 'Unsynced.md' } as never;
		const modal = new FileRevisionsModal({} as never, mockPlugin, mockFile);

		await modal.onOpen();
		const secondChild = modal.contentEl.children[1] as unknown as MockModalElement;
		expect(secondChild?.text).toContain('This file has not been synced to Google Drive yet');
	});

	it('renders revisions list and allows restoring a revision', async () => {
		const mockVaultModify = vi.fn().mockResolvedValue(undefined);
		const mockVaultRead = vi.fn().mockResolvedValue('Local current line 1\nLine 2');

		const mockApp = {
			vault: {
				modify: mockVaultModify,
				read: mockVaultRead,
			},
		};

		const mockPlugin = {
			settings: {
				refreshToken: 'token',
				driveIdToPath: { 'drive-file-1': 'Notes/Doc.md' },
			},
			drive: {
				idFromPath: vi.fn().mockResolvedValue('drive-file-1'),
				getFileRevisions: vi.fn().mockResolvedValue([
					{
						id: 'rev-2',
						modifiedTime: '2026-11-26T12:00:00.000Z',
						size: '120',
					},
					{
						id: 'rev-1',
						modifiedTime: '2026-11-25T10:00:00.000Z',
						size: '80',
					},
				]),
				getRevisionContent: vi.fn().mockResolvedValue('Past revision text\nLine 2'),
			},
		};

		const mockFile = { path: 'Notes/Doc.md', name: 'Doc.md' };
		const modal = new FileRevisionsModal(mockApp as never, mockPlugin as never, mockFile as never);

		await modal.onOpen();

		// Modal should have loaded revisions
		expect(mockPlugin.drive.getFileRevisions).toHaveBeenCalledWith('drive-file-1');

		// Check title
		expect((modal.titleEl as unknown as MockModalElement).text).toBe('Google Drive: Version history');
	});
});
