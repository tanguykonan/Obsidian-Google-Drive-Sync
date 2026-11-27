import { describe, expect, it } from 'vitest';
import {
	isPathExcluded,
	parseExclusionPatterns,
} from '../src/services/sync/exclusion';

describe('Exclusion Service', () => {
	describe('parseExclusionPatterns', () => {
		it('parses multiline exclusion rules and trims whitespace', () => {
			const raw = `
				*.tmp
				temp/
				# This is a comment
				private/**
				
				.git/
			`;
			const patterns = parseExclusionPatterns(raw);
			expect(patterns).toEqual(['*.tmp', 'temp/', 'private/**', '.git/']);
		});

		it('returns an empty array when given empty string or comments only', () => {
			expect(parseExclusionPatterns('')).toEqual([]);
			expect(parseExclusionPatterns('   \n# comment\n   ')).toEqual([]);
		});
	});

	describe('isPathExcluded', () => {
		it('returns false when patterns list is empty', () => {
			expect(isPathExcluded('notes/todo.md', [])).toBe(false);
		});

		it('matches directory prefix patterns', () => {
			const patterns = ['temp/', 'archives/'];
			expect(isPathExcluded('temp/draft.md', patterns)).toBe(true);
			expect(isPathExcluded('sub/temp/draft.md', patterns)).toBe(true);
			expect(isPathExcluded('temp', patterns)).toBe(true);
			expect(isPathExcluded('archives/old.md', patterns)).toBe(true);
			expect(isPathExcluded('notes/temp-file.md', patterns)).toBe(false);
		});

		it('matches extension wildcard patterns (*.ext)', () => {
			const patterns = ['*.tmp', '*.bak'];
			expect(isPathExcluded('scratch.tmp', patterns)).toBe(true);
			expect(isPathExcluded('folder/backup.bak', patterns)).toBe(true);
			expect(isPathExcluded('scratch.tmpx', patterns)).toBe(false);
			expect(isPathExcluded('backup.bak.md', patterns)).toBe(false);
		});

		it('matches exact relative paths', () => {
			const patterns = ['config.json', 'secrets/passwords.txt'];
			expect(isPathExcluded('config.json', patterns)).toBe(true);
			expect(isPathExcluded('/config.json', patterns)).toBe(true);
			expect(isPathExcluded('sub/config.json', patterns)).toBe(false);
			expect(isPathExcluded('secrets/passwords.txt', patterns)).toBe(true);
		});

		it('matches glob subdirectory patterns (**)', () => {
			const patterns = ['private/**', 'vault/secret/**'];
			expect(isPathExcluded('private', patterns)).toBe(true);
			expect(isPathExcluded('private/notes.md', patterns)).toBe(true);
			expect(isPathExcluded('private/deep/sub/notes.md', patterns)).toBe(true);
			expect(isPathExcluded('vault/secret/token.txt', patterns)).toBe(true);
			expect(isPathExcluded('other/private/notes.md', patterns)).toBe(false);
		});
	});
});
