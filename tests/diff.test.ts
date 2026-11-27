import { describe, expect, it } from 'vitest';
import {
	computeTextDiff,
	extractOriginalPath,
	findConflictPairs,
	isConflictPath,
} from '../src/services/sync/diff-service';

describe('Diff and Conflict Detection Service', () => {
	describe('isConflictPath', () => {
		it('detects standard conflict files with timestamp', () => {
			expect(
				isConflictPath('Notes/Todo (Conflict 2026-11-26 153045).md'),
			).toBe(true);
			expect(
				isConflictPath('Project (Conflict 2026-01-05 090501).canvas'),
			).toBe(true);
			expect(
				isConflictPath('Archive (Conflict 2026-12-31 235959)'),
			).toBe(true);
		});

		it('returns false for normal non-conflict files', () => {
			expect(isConflictPath('Notes/Todo.md')).toBe(false);
			expect(isConflictPath('Conflict/Document.md')).toBe(false);
			expect(isConflictPath('Note (Conflict draft).md')).toBe(false);
		});
	});

	describe('extractOriginalPath', () => {
		it('reconstructs the original filename preserving extension', () => {
			expect(
				extractOriginalPath('Folder/Note (Conflict 2026-11-26 153045).md'),
			).toBe('Folder/Note.md');
			expect(
				extractOriginalPath('Deep/Sub/Canvas (Conflict 2026-05-10 120000).canvas'),
			).toBe('Deep/Sub/Canvas.canvas');
		});

		it('handles files with no extension', () => {
			expect(
				extractOriginalPath('README (Conflict 2026-01-05 090501)'),
			).toBe('README');
		});

		it('returns unchanged path if not a conflict file', () => {
			expect(extractOriginalPath('Notes/Normal.md')).toBe('Notes/Normal.md');
		});
	});

	describe('findConflictPairs', () => {
		it('finds existing conflict pairs in the vault', () => {
			const mockFiles = [
				{ path: 'Notes/Meeting.md' },
				{ path: 'Notes/Meeting (Conflict 2026-11-26 140000).md' },
				{ path: 'Draft.md' },
				{ path: 'Orphan (Conflict 2026-11-26 150000).md' }, // original does not exist
			];
			const mockVault = {
				getFiles: () => mockFiles,
			};

			const pairs = findConflictPairs(mockVault as never);
			expect(pairs).toHaveLength(1);
			expect(pairs[0]).toEqual({
				originalPath: 'Notes/Meeting.md',
				conflictPath: 'Notes/Meeting (Conflict 2026-11-26 140000).md',
			});
		});
	});

	describe('computeTextDiff', () => {
		it('returns unchanged lines for identical texts', () => {
			const text = 'Line 1\nLine 2\nLine 3';
			const diff = computeTextDiff(text, text);

			expect(diff).toHaveLength(3);
			expect(diff.every((l) => l.type === 'unchanged')).toBe(true);
			expect(diff[0]?.localLineNumber).toBe(1);
			expect(diff[0]?.remoteLineNumber).toBe(1);
		});

		it('detects added lines in the remote version', () => {
			const textA = 'First line\nThird line';
			const textB = 'First line\nSecond line\nThird line';

			const diff = computeTextDiff(textA, textB);
			expect(diff).toHaveLength(3);
			expect(diff[0]).toMatchObject({ type: 'unchanged', text: 'First line' });
			expect(diff[1]).toMatchObject({ type: 'added', text: 'Second line', remoteLineNumber: 2 });
			expect(diff[2]).toMatchObject({ type: 'unchanged', text: 'Third line' });
		});

		it('detects removed lines in the local version', () => {
			const textA = 'Intro\nTemporary\nOutro';
			const textB = 'Intro\nOutro';

			const diff = computeTextDiff(textA, textB);
			expect(diff).toHaveLength(3);
			expect(diff[0]).toMatchObject({ type: 'unchanged', text: 'Intro' });
			expect(diff[1]).toMatchObject({ type: 'removed', text: 'Temporary', localLineNumber: 2 });
			expect(diff[2]).toMatchObject({ type: 'unchanged', text: 'Outro' });
		});

		it('detects modified blocks (removed + added)', () => {
			const textA = 'Original sentence';
			const textB = 'Modified sentence';

			const diff = computeTextDiff(textA, textB);
			expect(diff).toHaveLength(2);
			expect(diff[0]).toMatchObject({ type: 'removed', text: 'Original sentence' });
			expect(diff[1]).toMatchObject({ type: 'added', text: 'Modified sentence' });
		});

		it('handles empty inputs gracefully', () => {
			expect(computeTextDiff('', '')).toEqual([]);

			const addedFromEmpty = computeTextDiff('', 'New content');
			expect(addedFromEmpty).toHaveLength(1);
			expect(addedFromEmpty[0]?.type).toBe('added');
		});
	});
});
