/**
 * Path manipulation utilities for Google Drive Sync.
 * @module utils/path-utils
 */

import { Notice } from 'obsidian';
import type ObsidianGoogleDrive from '../main';

/**
 * Splits a file path into 100-byte chunks suitable for Google Drive custom file properties.
 *
 * @param path - The vault path to split.
 * @returns Map of property keys ('path', 'path2', etc.) to 100-byte UTF-8 string chunks.
 */
export const splitPath = (path: string): Record<string, string> => {
	const encoder = new TextEncoder();
	let p = '';
	const output: Record<string, string> = {};
	let i = 1;
	for (const char of path) {
		if (encoder.encode(p + char).length > 100) {
			const key = i === 1 ? 'path' : `path${i}`;
			output[key] = p;
			p = '';
			i++;
		}
		p += char;
	}
	const key = i === 1 ? 'path' : `path${i}`;
	output[key] = p;
	return output;
};

/**
 * Reassembles a file path from partitioned Google Drive custom file properties.
 *
 * @param properties - Custom file properties dictionary from Google Drive.
 * @returns Reconstructed relative vault path string.
 */
export const unSplitPath = (properties: Record<string, string>): string => {
	let path = properties.path || '';
	let i = 2;
	while (properties[`path${i}`]) {
		path += properties[`path${i}`];
		i++;
	}
	return path;
};

/**
 * Extracts the file name and extension from a full path string.
 *
 * @param path - File path.
 * @returns The trailing filename component.
 */
export const fileNameFromPath = (path: string): string =>
	path.split('/').pop() || path;

/**
 * Scans Google Drive and rebuilds the local path-to-ID mapping cache.
 * Useful for repairing corrupted or desynchronized metadata state.
 *
 * @param t - Plugin instance.
 * @returns Promise that resolves once paths are repaired.
 */
export const fixDrivePath = async (t: ObsidianGoogleDrive): Promise<void> => {
	const driveFiles = await t.drive.searchFiles({
		include: ['id', 'properties'],
	});
	if (!driveFiles) {
		new Notice('An error occurred fetching Google Drive files.');
		return;
	}
	const idToPath = Object.fromEntries(
		driveFiles.map(({ id, properties }) => [id, unSplitPath(properties)]),
	);
	t.settings.driveIdToPath = idToPath;
	t.settings.operations = {};
	new Notice(
		'Google Drive paths have been fixed. Please restart the plugin to apply changes.',
	);
};
