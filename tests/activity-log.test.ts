import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockNotice = vi.hoisted(() => vi.fn());
const mockSetIcon = vi.hoisted(() => vi.fn());

class MockViewElement {
	classes = new Set<string>();
	text = '';
	children: MockViewElement[] = [];
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
	createEl(tag: string, options?: { cls?: string; text?: string; attr?: Record<string, string> }): MockViewElement {
		const el = new MockViewElement();
		if (options?.cls) el.addClass(...options.cls.split(' '));
		if (options?.text) el.text = options.text;
		if (options?.attr) el.attributes = { ...options.attr };
		this.children.push(el);
		return el;
	}
	createDiv(options?: { cls?: string; text?: string }): MockViewElement {
		const el = new MockViewElement();
		if (options?.cls) el.addClass(...options.cls.split(' '));
		if (options?.text) el.text = options.text;
		this.children.push(el);
		return el;
	}
	createSpan(options?: { cls?: string; text?: string }): MockViewElement {
		const el = new MockViewElement();
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
	click(): void {
		this.eventListeners['click']?.forEach((h) => h());
	}
	querySelector(selector: string): MockViewElement | null {
		const search = (el: MockViewElement): MockViewElement | null => {
			for (const child of el.children) {
				if (selector.startsWith('.') && child.classes.has(selector.slice(1))) {
					return child;
				}
				const found = search(child);
				if (found) return found;
			}
			return null;
		};
		return search(this);
	}
	querySelectorAll(selector: string): MockViewElement[] {
		const res: MockViewElement[] = [];
		const search = (el: MockViewElement) => {
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
	setIcon: (el: unknown, icon: string) => {
		mockSetIcon(el, icon);
	},
	ItemView: class {
		leaf: unknown;
		contentEl = new MockViewElement();
		constructor(leaf: unknown) {
			this.leaf = leaf;
		}
	},
	WorkspaceLeaf: class {},
}));

vi.mock('../src/services/sync-push', () => ({
	push: vi.fn(),
}));

vi.mock('../src/services/sync-pull', () => ({
	pull: vi.fn(),
}));

import {
	activityLogger,
	ActivityLogService,
	MAX_ACTIVITY_LOG_ENTRIES,
} from '../src/services/sync/activity-log-service';
import {
	ActivityLogView,
	ACTIVITY_LOG_VIEW_TYPE,
} from '../src/ui/activity-log-view';

describe('ActivityLogService', () => {
	let logger: ActivityLogService;

	beforeEach(() => {
		logger = new ActivityLogService();
	});

	it('records log entries and retrieves them in descending order', () => {
		logger.log('push', 'Uploaded note', 'Notes/A.md');
		logger.log('pull', 'Downloaded note', 'Notes/B.md');

		const entries = logger.getEntries();
		expect(entries).toHaveLength(2);
		expect(entries[0]?.action).toBe('pull');
		expect(entries[0]?.filePath).toBe('Notes/B.md');
		expect(entries[1]?.action).toBe('push');
		expect(entries[1]?.filePath).toBe('Notes/A.md');
	});

	it('notifies subscribers upon logging new entries', () => {
		const listener = vi.fn();
		const unsub = logger.subscribe(listener);

		logger.log('conflict', 'Conflict created', 'Notes/Conflict.md');
		expect(listener).toHaveBeenCalledTimes(1);
		expect(listener).toHaveBeenCalledWith(
			expect.objectContaining({
				action: 'conflict',
				message: 'Conflict created',
				filePath: 'Notes/Conflict.md',
			}),
		);

		unsub();
		logger.log('info', 'Another event');
		expect(listener).toHaveBeenCalledTimes(1);
	});

	it('caps the ring buffer at MAX_ACTIVITY_LOG_ENTRIES', () => {
		for (let i = 0; i < MAX_ACTIVITY_LOG_ENTRIES + 50; i++) {
			logger.log('info', `Event ${i}`);
		}

		expect(logger.getEntries().length).toBe(MAX_ACTIVITY_LOG_ENTRIES);
		expect(logger.getEntries()[0]?.message).toBe(
			`Event ${MAX_ACTIVITY_LOG_ENTRIES + 49}`,
		);
	});

	it('exports logs to readable plain text and json', () => {
		logger.log('push', 'Uploaded file', 'Notes/Test.md');

		const text = logger.exportAsText();
		expect(text).toContain('PUSH');
		expect(text).toContain('Uploaded file');
		expect(text).toContain('[Notes/Test.md]');

		const json = logger.exportAsJson();
		const parsed = JSON.parse(json) as Array<{ action: string }>;
		expect(Array.isArray(parsed)).toBe(true);
		expect(parsed[0]?.action).toBe('push');
	});

	it('clears all entries from buffer', () => {
		logger.log('error', 'API failure');
		expect(logger.getEntries().length).toBe(1);

		logger.clear();
		expect(logger.getEntries().length).toBe(0);
		expect(logger.exportAsText()).toBe('No synchronization activity recorded.');
	});
});

describe('ActivityLogView', () => {
	beforeEach(() => {
		activityLogger.clear();
		mockNotice.mockReset();
		mockSetIcon.mockReset();
	});

	it('renders view type, display text and header elements', async () => {
		const mockPlugin = {} as never;
		const view = new ActivityLogView({} as never, mockPlugin);

		expect(view.getViewType()).toBe(ACTIVITY_LOG_VIEW_TYPE);
		expect(view.getDisplayText()).toBe('Google Drive activity');
		expect(view.getIcon()).toBe('activity');

		await view.onOpen();

		const contentEl = view.contentEl as unknown as MockViewElement;
		expect(contentEl.classes.has('gdrive-activity-view')).toBe(true);

		// Header title
		const titleEl = contentEl.querySelector('.gdrive-activity-title');
		expect(titleEl?.text).toBe('Activity log');
	});

	it('reacts to real-time log events and renders items', async () => {
		const mockPlugin = {} as never;
		const view = new ActivityLogView({} as never, mockPlugin);
		await view.onOpen();

		activityLogger.log('push', 'Uploaded Note.md', 'Notes/Note.md');

		const contentEl = view.contentEl as unknown as MockViewElement;
		const items = contentEl.querySelectorAll('.gdrive-activity-item');
		expect(items.length).toBe(1);
		expect(items[0]?.classes.has('mod-push')).toBe(true);
		expect(items[0]?.querySelector('.gdrive-activity-message')?.text).toContain('Uploaded Note.md');

		await view.onClose();
	});
});
