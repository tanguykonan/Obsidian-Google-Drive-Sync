/**
 * Core types and interfaces for the Google Drive Sync plugin.
 * @module types
 */

/**
 * File metadata record returned by Google Drive API v3.
 */
export interface FileMetadata {
	id: string;
	name: string;
	description: string;
	mimeType: string;
	starred: boolean;
	properties: Record<string, string>;
	modifiedTime: string;
	md5Checksum?: string;
	trashed: boolean;
}

/** Search condition for Google Drive string fields */
export type StringSearch = string | { contains: string } | { not: string };

/** Comparison operator for ISO date strings */
export type DateComparison = { eq: string } | { gt: string } | { lt: string };

/**
 * Query parameters used to filter files in Google Drive.
 */
export interface QueryMatch {
	name?: StringSearch | StringSearch[];
	mimeType?: StringSearch | StringSearch[];
	parent?: string;
	starred?: boolean;
	query?: string;
	properties?: Record<string, string>;
	modifiedTime?: DateComparison;
}

/**
 * Change record returned by the Google Drive Changes API.
 */
export interface Change {
	kind: string;
	removed: boolean;
	file: FileMetadata;
	fileId: string;
	time: string;
}

/**
 * File revision metadata returned by Google Drive Revisions API v3.
 */
export interface DriveRevision {
	id: string;
	modifiedTime: string;
	size?: string;
	keepForever?: boolean;
	originalFilename?: string;
	mimeType?: string;
}

/**
 * Persisted plugin configuration stored in data.json.
 */
export interface PluginSettings {
	refreshToken: string;
	clientId: string;
	clientSecret: string;
	autoPush: boolean;
	/** Map of vault file path to pending local operation ('create' | 'delete' | 'modify') */
	operations: Record<string, 'create' | 'delete' | 'modify'>;
	/** Cache mapping Google Drive file ID to relative vault path */
	driveIdToPath: Record<string, string>;
	/** Google Drive ID of the vault root directory */
	rootFolderId: string;
	/** Epoch timestamp in ms of the last successful sync */
	lastSyncedAt: number;
	/** Cursor token for Google Drive Changes API */
	changesToken: string;
	/** Newline-separated list of path exclusion patterns */
	excludedPatterns: string;
	/** Whether End-to-End Encryption (E2EE) is enabled */
	e2eeEnabled: boolean;
	/** Passphrase used for AES-256-GCM zero-knowledge encryption */
	e2eePassword: string;
}

/** Default plugin configuration values */
export const DEFAULT_SETTINGS: Readonly<PluginSettings> = Object.freeze({
	refreshToken: '',
	clientId: '',
	clientSecret: '',
	autoPush: false,
	operations: {},
	driveIdToPath: {},
	rootFolderId: '',
	lastSyncedAt: 0,
	changesToken: '',
	excludedPatterns: '',
	e2eeEnabled: false,
	e2eePassword: '',
});

/** Temporary in-memory access token state */
export interface AccessTokenState {
	token: string;
	expiresAt: number;
}

/** HTTP request options for the Google Drive network agent */
export interface RequestOptions {
	body?: BodyInit;
	headers?: Record<string, string>;
	json?: unknown;
}

/** Normalized HTTP response wrapper around Obsidian's RequestUrlResponse */
export interface DriveResponse {
	readonly ok: boolean;
	readonly status: number;
	arrayBuffer(): Promise<ArrayBuffer>;
	json<T>(): Promise<T>;
	text(): Promise<string>;
}

/**
 * Custom error thrown when a Google Drive API request fails.
 */
export class GoogleDriveApiError extends Error {
	constructor(
		public readonly statusCode: number,
		message: string,
		public readonly endpoint?: string,
	) {
		super(`[GoogleDriveApiError ${statusCode}] ${message}${endpoint ? ` (${endpoint})` : ''}`);
		this.name = 'GoogleDriveApiError';
	}
}