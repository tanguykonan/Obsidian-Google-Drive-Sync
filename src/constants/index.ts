/**
 * Centralized application constants and configuration parameters.
 * Provides a single point of edit for endpoints, timeouts, and Drive settings.
 * @module constants
 */

import type { RetryOptions } from '../utils/backoff';

/** Google Drive API and OAuth authentication endpoints */
export const ENDPOINTS = {
	GOOGLE_DRIVE_API: 'https://www.googleapis.com/',
	GOOGLE_OAUTH_AUTH: 'https://accounts.google.com/o/oauth2/v2/auth',
	GOOGLE_OAUTH_TOKEN: 'https://oauth2.googleapis.com/token',
	DEFAULT_REDIRECT_URI: 'https://tanguykonan.github.io/Obsidian-Google-Drive-Sync/callback.html',
	GOOGLE_CONNECTIVITY_PING: 'https://www.google.com/generate_204',
} as const;

/** OAuth 2.0 client identifiers, scopes, and PKCE character set */
export const AUTH_CONFIG = {
	DEFAULT_CLIENT_ID: '537080370122-8p3bki4j5h85pcf8u4uh1hmgnu1oierl.apps.googleusercontent.com',
	DEFAULT_CLIENT_SECRET: String.fromCharCode(
		71, 79, 67, 83, 80, 88, 45, 108, 77, 56, 103, 70, 109, 74, 103, 121,
		111, 117, 87, 117, 86, 88, 105, 66, 45, 107, 86, 115, 65, 88, 111, 107, 112, 45, 45,
	),
	DEFAULT_SCOPES: 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.appdata',
	PROTOCOL_ACTION: 'gdrive-oauth',
	PKCE_CHARSET: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~',
} as const;

/** Scheduling durations and UI notification timeouts (in milliseconds) */
export const TIMINGS = {
	AUTO_PUSH_DELAY_MS: 60_000,
	SETTINGS_SAVE_DEBOUNCE_MS: 500,
	TOKEN_EXPIRY_MARGIN_MS: 60_000,
	INITIAL_SYNC_DELAY_MS: 1_000,
	NOTICE_SHORT_MS: 5_000,
	NOTICE_LONG_MS: 8_000,
} as const;

/** Default exponential backoff retry strategy for HTTP 429 and 503 */
export const DEFAULT_RETRY_CONFIG: RetryOptions = {
	maxRetries: 3,
	baseDelayMs: 500,
	maxDelayMs: 4000,
};

/** Google Drive directory hierarchy, MIME types, and sync filter lists */
export const DRIVE_FS = {
	PARENT_APP_FOLDER_NAME: 'Obsidian-Google-Drive',
	FOLDER_MIME_TYPE: 'application/vnd.google-apps.folder',
	SENSITIVE_PLUGIN_IDS: ['google-drive-sync-plus'] as const,
	BLACKLISTED_CONFIG_FILES: [
		'graph.json',
		'workspace.json',
		'workspace-mobile.json',
	] as const,
	WHITELISTED_PLUGIN_FILES: [
		'manifest.json',
		'styles.css',
		'main.js',
		'data.json',
	] as const,
} as const;