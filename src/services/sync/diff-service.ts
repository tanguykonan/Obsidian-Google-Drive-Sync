/**
 * Text difference calculation and conflict detection engine.
 * Computes line-by-line diffs using Longest Common Subsequence (LCS) algorithm.
 * @module services/sync/diff-service
 */

import type { Vault } from 'obsidian';

/**
 * Type of change for an individual diff line.
 */
export type DiffChangeType = 'added' | 'removed' | 'unchanged';

/**
 * Represents a single line in a diff comparison.
 */
export interface DiffLine {
	/** Type of line change */
	type: DiffChangeType;
	/** Content of the line */
	text: string;
	/** 1-based line number in the local version (if applicable) */
	localLineNumber?: number;
	/** 1-based line number in the remote/conflict version (if applicable) */
	remoteLineNumber?: number;
}

/**
 * Regular expression matching conflict copy filenames:
 * e.g. "Note (Conflict 2026-11-26 153045).md" or "Doc (Conflict 2026-11-26 153045)"
 */
export const CONFLICT_FILENAME_REGEX =
	/\s\(Conflict \d{4}-\d{2}-\d{2} \d{6}\)(\.[^/.]+)?$/;

/**
 * Checks whether a given path corresponds to a conflict copy.
 *
 * @param path - Relative vault path.
 * @returns True if path matches the conflict pattern.
 */
export const isConflictPath = (path: string): boolean =>
	CONFLICT_FILENAME_REGEX.test(path);

/**
 * Reconstructs the original file path from a conflict copy path.
 *
 * @param conflictPath - Relative vault path of the conflict file.
 * @returns Reconstructed original path, or original path unchanged if not a conflict.
 *
 * @example
 * extractOriginalPath('Notes/Todo (Conflict 2026-11-26 120000).md');
 * // returns 'Notes/Todo.md'
 */
export const extractOriginalPath = (conflictPath: string): string => {
	const match = conflictPath.match(CONFLICT_FILENAME_REGEX);
	if (!match) return conflictPath;

	const ext = match[1] ?? '';
	return conflictPath.replace(CONFLICT_FILENAME_REGEX, ext);
};

/**
 * Scans the vault to find all conflict files and their corresponding original files.
 *
 * @param vault - Active Obsidian vault instance.
 * @returns Array of conflict pairs with existing original and conflict paths.
 */
export const findConflictPairs = (
	vault: Vault,
): Array<{ originalPath: string; conflictPath: string }> => {
	if (!vault || typeof vault.getFiles !== 'function') return [];
	const allFiles = vault.getFiles();
	const allPaths = new Set(allFiles.map((f) => f.path));
	const pairs: Array<{ originalPath: string; conflictPath: string }> = [];

	for (const file of allFiles) {
		if (isConflictPath(file.path)) {
			const originalPath = extractOriginalPath(file.path);
			if (allPaths.has(originalPath)) {
				pairs.push({ originalPath, conflictPath: file.path });
			}
		}
	}

	return pairs;
};

/**
 * Computes a line-by-line diff between two text documents using LCS.
 *
 * @param textA - The baseline/local text content.
 * @param textB - The incoming/remote text content.
 * @returns Array of diff lines with line numbers and change types.
 */
export const computeTextDiff = (textA: string, textB: string): DiffLine[] => {
	const linesA = textA ? textA.split('\n') : [];
	const linesB = textB ? textB.split('\n') : [];

	const n = linesA.length;
	const m = linesB.length;

	// Optimization: if identical texts, return all unchanged
	if (textA === textB) {
		return linesA.map((text, i) => ({
			type: 'unchanged',
			text,
			localLineNumber: i + 1,
			remoteLineNumber: i + 1,
		}));
	}

	// Compute Longest Common Subsequence matrix
	const dp: number[][] = Array.from({ length: n + 1 }, () =>
		new Array<number>(m + 1).fill(0),
	);

	for (let i = 0; i < n; i++) {
		const rowCurrent = dp[i + 1]!;
		const rowPrev = dp[i]!;
		const lineA = linesA[i];

		for (let j = 0; j < m; j++) {
			if (lineA === linesB[j]) {
				rowCurrent[j + 1] = (rowPrev[j] ?? 0) + 1;
			} else {
				const top = rowPrev[j + 1] ?? 0;
				const left = rowCurrent[j] ?? 0;
				rowCurrent[j + 1] = top >= left ? top : left;
			}
		}
	}

	// Backtrack to build the diff list
	const diff: DiffLine[] = [];
	let i = n;
	let j = m;

	while (i > 0 || j > 0) {
		if (i > 0 && j > 0 && linesA[i - 1] === linesB[j - 1]) {
			diff.push({
				type: 'unchanged',
				text: linesA[i - 1]!,
				localLineNumber: i,
				remoteLineNumber: j,
			});
			i--;
			j--;
		} else if (
			j > 0 &&
			(i === 0 || (dp[i]![j - 1] ?? 0) >= (dp[i - 1]![j] ?? 0))
		) {
			diff.push({
				type: 'added',
				text: linesB[j - 1]!,
				remoteLineNumber: j,
			});
			j--;
		} else if (i > 0) {
			diff.push({
				type: 'removed',
				text: linesA[i - 1]!,
				localLineNumber: i,
			});
			i--;
		}
	}

	return diff.reverse();
};
