import { describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => ({
	Notice: class {},
	Modal: class {},
	FuzzySuggestModal: class {},
	TAbstractFile: class {},
	TFile: class {},
	TFolder: class {},
	requestUrl: vi.fn(),
}));

import { registerPluginCommands } from '../src/commands';

describe('registerPluginCommands', () => {
	it('registers all user-facing commands with stable IDs', () => {
		const registeredCommands: Array<{ id: string; name: string }> = [];
		const mockPlugin = {
			addCommand: vi.fn((cmd: { id: string; name: string }) => {
				registeredCommands.push(cmd);
			}),
		};

		registerPluginCommands(mockPlugin as never);

		expect(mockPlugin.addCommand).toHaveBeenCalledTimes(8);
		const ids = registeredCommands.map((c) => c.id);
		expect(ids).toContain('connect-google-drive');
		expect(ids).toContain('push');
		expect(ids).toContain('pull');
		expect(ids).toContain('reset');
		expect(ids).toContain('fix-drive-path');
		expect(ids).toContain('resolve-conflicts');
		expect(ids).toContain('show-version-history');
		expect(ids).toContain('open-activity-log');
	});
});
