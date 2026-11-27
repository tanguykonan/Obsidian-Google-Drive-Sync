/**
 * Selective synchronization and path exclusion filters.
 * Supports directory prefixes, file extensions, and glob-like wildcard patterns.
 * @module services/sync/exclusion
 */

/**
 * Parses raw newline-separated exclusion rules into a normalized array of pattern strings.
 *
 * @param raw - Multiline string of exclusion patterns.
 * @returns Cleaned array of non-empty pattern strings.
 */
export const parseExclusionPatterns = (raw: string): string[] =>
	raw
		.split('\n')
		.map((line) => line.trim())
		.filter((line) => line.length > 0 && !line.startsWith('#'));

/**
 * Checks if a relative vault path matches any configured exclusion patterns.
 *
 * @param path - Relative path inside the vault (e.g. "Work/temp/draft.md").
 * @param patterns - List of exclusion pattern strings.
 * @returns True if the path matches at least one exclusion rule, false otherwise.
 *
 * @example
 * ```typescript
 * isPathExcluded('temp/notes.md', ['temp/']); // true
 * isPathExcluded('data/backup.tmp', ['*.tmp']); // true
 * isPathExcluded('notes/meeting.md', ['temp/']); // false
 * ```
 */
export const isPathExcluded = (path: string, patterns: string[]): boolean => {
	if (!patterns.length || !path) return false;

	const normalizedPath = path.startsWith('/') ? path.slice(1) : path;

	for (const pattern of patterns) {
		const cleanPattern = pattern.startsWith('/') ? pattern.slice(1) : pattern;

		// Directory match (e.g. "temp/" or "archives/")
		if (cleanPattern.endsWith('/')) {
			if (
				normalizedPath.startsWith(cleanPattern) ||
				normalizedPath === cleanPattern.slice(0, -1) ||
				normalizedPath.includes(`/${cleanPattern}`)
			) {
				return true;
			}
			continue;
		}

		// Extension wildcard match (e.g. "*.tmp" or "*.bak")
		if (cleanPattern.startsWith('*.')) {
			const ext = cleanPattern.slice(1); // ".tmp"
			if (normalizedPath.endsWith(ext)) {
				return true;
			}
			continue;
		}

		// Exact match
		if (normalizedPath === cleanPattern) {
			return true;
		}

		// Subdirectory glob match (e.g. "private/**")
		if (cleanPattern.endsWith('/**')) {
			const base = cleanPattern.slice(0, -3);
			if (normalizedPath === base || normalizedPath.startsWith(`${base}/`)) {
				return true;
			}
		}
	}

	return false;
};
