/**
 * Non-destructive conflict resolution manager.
 * Preserves local and remote changes by generating timestamped conflict copy files.
 * @module services/sync/conflict-manager
 */

import { Notice } from 'obsidian';
import type ObsidianGoogleDrive from '../../main';
import { activityLogger } from './activity-log-service';

/**
 * Generates a timestamped conflict file path.
 * Example: "Notes/Meeting.md" -> "Notes/Meeting (Conflict 2026-11-26 142015).md"
 *
 * @param originalPath - The relative path of the conflicting file.
 * @param date - The date to use for formatting (defaults to now).
 * @returns Formatted conflict file path.
 */
export const formatConflictPath = (
	originalPath: string,
	date: Date = new Date(),
): string => {
	const lastSlash = originalPath.lastIndexOf('/');
	const dir = lastSlash === -1 ? '' : originalPath.slice(0, lastSlash + 1);
	const filename = lastSlash === -1 ? originalPath : originalPath.slice(lastSlash + 1);

	const lastDot = filename.lastIndexOf('.');
	const name = lastDot === -1 ? filename : filename.slice(0, lastDot);
	const ext = lastDot === -1 ? '' : filename.slice(lastDot);

	const pad = (n: number) => String(n).padStart(2, '0');
	const year = date.getFullYear();
	const month = pad(date.getMonth() + 1);
	const day = pad(date.getDate());
	const hours = pad(date.getHours());
	const mins = pad(date.getMinutes());
	const secs = pad(date.getSeconds());

	const timestamp = `${year}-${month}-${day} ${hours}${mins}${secs}`;
	return `${dir}${name} (Conflict ${timestamp})${ext}`;
};

/**
 * Resolves a file conflict by keeping the local file as-is and writing
 * the competing remote content to a newly generated conflict file.
 *
 * @param plugin - Plugin instance.
 * @param originalPath - Relative path of the original conflicting file.
 * @param remoteContent - Binary content downloaded from Google Drive.
 * @param remoteModifiedTime - Optional modification time of the remote version.
 * @returns The relative path of the created conflict copy.
 */
export const resolveConflictCopy = async (
	plugin: ObsidianGoogleDrive,
	originalPath: string,
	remoteContent: ArrayBuffer,
	remoteModifiedTime?: string | number | Date,
): Promise<string> => {
	const conflictPath = formatConflictPath(originalPath);
	await plugin.createFile(conflictPath, remoteContent, remoteModifiedTime);

	const filename = originalPath.split('/').pop() || originalPath;
	const conflictFilename = conflictPath.split('/').pop() || conflictPath;

	new Notice(
		`Conflict detected on "${filename}". Remote version saved as "${conflictFilename}".`,
		8000,
	);
	activityLogger.log(
		'conflict',
		`Conflict copy created: "${conflictFilename}"`,
		originalPath,
	);
	console.warn(`[Sync Conflict] Conflict copy created for ${originalPath} -> ${conflictPath}`);

	return conflictPath;
};
