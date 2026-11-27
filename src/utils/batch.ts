/**
 * Concurrency and batch processing helpers for asynchronous operations.
 * @module utils/batch
 */

import type { TAbstractFile, TFolder } from 'obsidian';

/**
 * Executes an array of asynchronous tasks concurrently with a maximum batch limit.
 *
 * @param tasks - Array of factory functions returning promises.
 * @param limit - Maximum number of concurrent executions (default: 10).
 * @returns Array of resolved values corresponding to each task.
 *
 * @example
 * ```typescript
 * const results = await batchAsync([() => fetchFile(1), () => fetchFile(2)], 5);
 * ```
 */
export const batchAsync = async <T>(
	tasks: (() => Promise<T>)[],
	limit = 10,
): Promise<T[]> => {
	const results: T[] = [];
	for (let i = 0; i < tasks.length; i += limit) {
		const batch = tasks.slice(i, i + limit);
		const batchResults = await Promise.all(batch.map((task) => task()));
		results.push(...batchResults);
	}
	return results;
};

/**
 * Groups an array of folder paths or TFolder instances into hierarchical batches
 * sorted by depth, ensuring parent folders are created before their children.
 *
 * @param folders - Array of folder path strings or TFolder objects.
 * @returns An array of batches (arrays of folders at each respective depth).
 */
export const foldersToBatches = <T extends string | TFolder | TAbstractFile>(
	folders: T[],
): T[][] => {
	const depthMap: Record<number, T[]> = {};

	for (const folder of folders) {
		const path = typeof folder === 'string' ? folder : folder.path;
		const depth = path.split('/').length;
		if (!depthMap[depth]) {
			depthMap[depth] = [];
		}
		depthMap[depth].push(folder);
	}

	const sortedDepths = Object.keys(depthMap)
		.map(Number)
		.sort((a, b) => a - b);

	return sortedDepths.map((depth) => depthMap[depth] as T[]);
};

/**
 * Formats a user-friendly sync progress message string.
 *
 * @param start - Starting percentage of the current stage.
 * @param end - Ending percentage of the current stage.
 * @param completed - Number of items completed in the current batch.
 * @param total - Total number of items in the current batch.
 * @returns Formatted progress string (e.g., "Syncing (45%)").
 */
export const getSyncMessage = (
	start: number,
	end: number,
	completed: number,
	total: number,
): string => {
	if (total === 0) return `Syncing (${Math.round(start)}%)`;
	const percentage = Math.round(start + (end - start) * (completed / total));
	return `Syncing (${Math.min(100, Math.max(0, percentage))}%)`;
};
