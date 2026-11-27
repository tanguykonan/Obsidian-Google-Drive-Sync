import { describe, expect, it, vi, beforeEach } from 'vitest';

const notices: string[] = [];

vi.mock('obsidian', () => ({
	Notice: class {
		constructor(message: string) {
			notices.push(message);
		}
	},
}));

import {
	formatConflictPath,
	resolveConflictCopy,
} from '../src/services/sync/conflict-manager';

describe('Conflict Manager', () => {
	beforeEach(() => {
		notices.length = 0;
	});

	it('formats conflict filenames with timestamp without altering extension', () => {
		const fixedDate = new Date(2026, 10, 26, 15, 30, 45); // Nov 26 2026 15:30:45
		const result = formatConflictPath('Folder/Subfolder/Note.md', fixedDate);

		expect(result).toBe('Folder/Subfolder/Note (Conflict 2026-11-26 153045).md');
	});

	it('handles files with no extension or root files', () => {
		const fixedDate = new Date(2026, 0, 5, 9, 5, 1);
		const result = formatConflictPath('README', fixedDate);

		expect(result).toBe('README (Conflict 2026-01-05 090501)');
	});

	it('creates conflict file and issues user notice', async () => {
		const createFile = vi.fn(async () => undefined);
		const plugin = { createFile } as never;

		const content = new TextEncoder().encode('remote content').buffer;
		const conflictPath = await resolveConflictCopy(
			plugin,
			'Work/Project.md',
			content,
			'2026-11-26T15:30:00Z',
		);

		expect(conflictPath).toContain('Work/Project (Conflict 2026-');
		expect(conflictPath.endsWith('.md')).toBe(true);
		expect(createFile).toHaveBeenCalledWith(
			conflictPath,
			content,
			'2026-11-26T15:30:00Z',
		);
		expect(notices[0]).toContain('Conflict detected on "Project.md"');
	});
});
