import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockSetIcon = vi.fn();
vi.mock('obsidian', () => ({
	setIcon: (el: unknown, icon: string): void => {
		mockSetIcon(el, icon);
	},
}));

const mockPush = vi.fn();
vi.mock('../src/services/sync-push', () => ({
	push: (plugin: unknown): void => {
		mockPush(plugin);
	},
}));

const mockStartOAuth = vi.fn();
vi.mock('../src/services/auth/token-service', () => ({
	startGoogleOAuthFlow: (plugin: unknown): void => {
		mockStartOAuth(plugin);
	},
}));

const mockOpenConflictResolver = vi.fn();
vi.mock('../src/ui/conflict-list-modal', () => ({
	openConflictResolver: (app: unknown, onResolved?: () => void): void => {
		mockOpenConflictResolver(app, onResolved);
	},
}));

import { SyncStatusBar } from '../src/ui/status-bar';

class MockElement {
	classes = new Set<string>();
	text = '';
	attributes: Record<string, string> = {};
	clickHandler?: () => void;

	addClass(...cls: string[]): void {
		cls.forEach((c) => this.classes.add(c));
	}
	removeClass(...cls: string[]): void {
		cls.forEach((c) => this.classes.delete(c));
	}
	empty(): void {
		this.text = '';
	}
	setText(val: string): void {
		this.text = val;
	}
	setAttribute(key: string, val: string): void {
		this.attributes[key] = val;
	}
	onClickEvent(cb: () => void): void {
		this.clickHandler = cb;
	}
	createSpan(options?: { cls?: string }): MockElement {
		const span = new MockElement();
		if (options?.cls) span.addClass(options.cls);
		return span;
	}
}

describe('SyncStatusBar', () => {
	let statusBarEl: MockElement;
	let mockPlugin: {
		addStatusBarItem: ReturnType<typeof vi.fn>;
		settings: { refreshToken: string };
		syncing: boolean;
	};

	beforeEach(() => {
		mockSetIcon.mockClear();
		mockPush.mockClear();
		mockStartOAuth.mockClear();

		statusBarEl = new MockElement();
		mockPlugin = {
			addStatusBarItem: vi.fn(() => statusBarEl as unknown as HTMLElement),
			settings: { refreshToken: 'valid-refresh-token' },
			syncing: false,
		};
	});

	it('initializes with idle status and correct classes', () => {
		const bar = new SyncStatusBar(mockPlugin as never);
		expect(bar.getStatus()).toEqual({ type: 'idle' });
		expect(mockSetIcon).toHaveBeenCalledWith(expect.anything(), 'cloud-check');
	});

	it('updates UI correctly when transitioning to syncing', () => {
		const bar = new SyncStatusBar(mockPlugin as never);
		bar.setStatus({ type: 'syncing', progress: 42 });

		expect(statusBarEl.classes.has('is-syncing')).toBe(true);
		expect(mockSetIcon).toHaveBeenCalledWith(expect.anything(), 'refresh-cw');
	});

	it('updates UI correctly for pending changes', () => {
		const bar = new SyncStatusBar(mockPlugin as never);
		bar.setStatus({ type: 'pending', count: 5 });

		expect(statusBarEl.classes.has('is-pending')).toBe(true);
		expect(mockSetIcon).toHaveBeenCalledWith(expect.anything(), 'clock');
	});

	it('updates UI correctly for conflicts and disconnection', () => {
		const bar = new SyncStatusBar(mockPlugin as never);
		bar.setStatus({ type: 'conflict', count: 2 });
		expect(statusBarEl.classes.has('is-conflict')).toBe(true);
		expect(mockSetIcon).toHaveBeenCalledWith(expect.anything(), 'alert-triangle');

		bar.setStatus({ type: 'disconnected' });
		expect(statusBarEl.classes.has('is-disconnected')).toBe(true);
		expect(mockSetIcon).toHaveBeenCalledWith(expect.anything(), 'cloud-off');

		bar.setStatus({ type: 'offline' });
		expect(mockSetIcon).toHaveBeenCalledWith(expect.anything(), 'wifi-off');
	});

	it('handles click by triggering push when connected and idle', () => {
		new SyncStatusBar(mockPlugin as never);
		statusBarEl.clickHandler?.();

		expect(mockPush).toHaveBeenCalledWith(mockPlugin);
		expect(mockStartOAuth).not.toHaveBeenCalled();
	});

	it('handles click by triggering OAuth flow when disconnected', () => {
		mockPlugin.settings.refreshToken = '';
		new SyncStatusBar(mockPlugin as never);
		statusBarEl.clickHandler?.();

		expect(mockStartOAuth).toHaveBeenCalledWith(mockPlugin);
		expect(mockPush).not.toHaveBeenCalled();
	});

	it('handles click by triggering conflict resolver when in conflict state', () => {
		const bar = new SyncStatusBar(mockPlugin as never);
		bar.setStatus({ type: 'conflict', count: 1 });
		statusBarEl.clickHandler?.();

		expect(mockOpenConflictResolver).toHaveBeenCalled();
		expect(mockPush).not.toHaveBeenCalled();
	});

	it('ignores click when already syncing', () => {
		mockPlugin.syncing = true;
		new SyncStatusBar(mockPlugin as never);
		statusBarEl.clickHandler?.();

		expect(mockPush).not.toHaveBeenCalled();
		expect(mockStartOAuth).not.toHaveBeenCalled();
	});
});
