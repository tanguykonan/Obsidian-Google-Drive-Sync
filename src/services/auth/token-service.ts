/**
 * OAuth 2.0 token management and exchange service for Google Drive.
 * @module services/auth/token-service
 */

import { Notice, requestUrl } from 'obsidian';
import type ObsidianGoogleDrive from '../../main';
import {
	buildGoogleAuthUrl,
	generateCodeChallenge,
	generateCodeVerifier,
	generateOAuthState,
} from './pkce';
import { AUTH_CONFIG, ENDPOINTS, TIMINGS } from '../../constants';

/**
 * Default local loopback redirect URI for desktop OAuth authorization.
 */
export const DEFAULT_REDIRECT_URI: string = ENDPOINTS.DEFAULT_REDIRECT_URI;

/**
 * Temporary in-memory session holding PKCE verification values during the login handshake.
 */
interface PendingAuthSession {
	codeVerifier: string;
	state: string;
	redirectUri: string;
	clientId: string;
	createdAt: number;
}

let pendingAuthSession: PendingAuthSession | null = null;

/**
 * Initiates the Google OAuth 2.0 PKCE login flow.
 * Opens the user's browser with the authorization URL.
 *
 * @param plugin - Plugin instance.
 * @param customRedirectUri - Optional redirect URI override.
 */
export const startGoogleOAuthFlow = async (
	plugin: ObsidianGoogleDrive,
	customRedirectUri?: string,
): Promise<void> => {
	const clientId =
		plugin.settings.clientId.trim() || AUTH_CONFIG.DEFAULT_CLIENT_ID;

	const redirectUri = customRedirectUri || DEFAULT_REDIRECT_URI;
	const codeVerifier = generateCodeVerifier();
	const codeChallenge = await generateCodeChallenge(codeVerifier);
	const state = generateOAuthState();

	pendingAuthSession = {
		codeVerifier,
		state,
		redirectUri,
		clientId,
		createdAt: Date.now(),
	};

	const authUrl = buildGoogleAuthUrl({
		clientId,
		redirectUri,
		codeChallenge,
		state,
	});

	window.open(authUrl, '_blank');
	new Notice(
		'Connecting to Google: Please authorize Obsidian in your browser...',
		TIMINGS.NOTICE_LONG_MS,
	);
};

/**
 * Handles the authorization callback intercepted from the obsidian:// protocol.
 * Exchanges the temporary authorization code for persistent refresh and access tokens.
 *
 * @param plugin - Plugin instance.
 * @param params - Query parameters from the obsidian:// URI.
 * @returns Promise resolving to true if authentication succeeded, false otherwise.
 */
export const handleOAuthProtocolCallback = async (
	plugin: ObsidianGoogleDrive,
	params: Record<string, string>,
): Promise<boolean> => {
	const { code, state, error, error_description } = params;

	if (error) {
		new Notice(`Google login failed: ${error_description || error}`);
		pendingAuthSession = null;
		return false;
	}

	if (!code) {
		new Notice('Google login canceled or missing authorization code.');
		pendingAuthSession = null;
		return false;
	}

	if (pendingAuthSession && state && pendingAuthSession.state !== state) {
		new Notice('OAUTH state mismatch: Authentication rejected for security.');
		pendingAuthSession = null;
		return false;
	}

	const codeVerifier = pendingAuthSession?.codeVerifier || '';
	const redirectUri = pendingAuthSession?.redirectUri || DEFAULT_REDIRECT_URI;
	const clientId =
		plugin.settings.clientId.trim() ||
		pendingAuthSession?.clientId ||
		AUTH_CONFIG.DEFAULT_CLIENT_ID;
	const clientSecret =
		plugin.settings.clientSecret.trim() ||
		(clientId === AUTH_CONFIG.DEFAULT_CLIENT_ID
			? AUTH_CONFIG.DEFAULT_CLIENT_SECRET
			: '');

	pendingAuthSession = null;

	try {
		const bodyParams = new URLSearchParams({
			client_id: clientId,
			grant_type: 'authorization_code',
			code,
			redirect_uri: redirectUri,
		});

		if (codeVerifier) {
			bodyParams.set('code_verifier', codeVerifier);
		}
		if (clientSecret) {
			bodyParams.set('client_secret', clientSecret);
		}

		const response = await requestUrl({
			url: ENDPOINTS.GOOGLE_OAUTH_TOKEN,
			method: 'POST',
			contentType: 'application/x-www-form-urlencoded',
			body: bodyParams.toString(),
			throw: false,
		});

		if (response.status < 200 || response.status >= 300) {
			console.error('Google token exchange error:', response.text);
			new Notice(`Token exchange failed (HTTP ${response.status}): ${response.text}`);
			return false;
		}

		const data = response.json as {
			access_token?: string;
			refresh_token?: string;
			expires_in?: number;
		};

		if (!data.access_token) {
			new Notice('Failed to receive access token from Google.');
			return false;
		}

		plugin.accessToken = {
			token: data.access_token,
			expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
		};

		if (data.refresh_token) {
			plugin.settings.refreshToken = data.refresh_token;
		}

		const changesToken = await plugin.drive.getChangesStartToken();
		if (changesToken) {
			plugin.settings.changesToken = changesToken;
		}

		await plugin.saveSettings();
		new Notice('Google Drive connected successfully!');
		await plugin.initSyncAfterAuth();
		return true;
	} catch (err) {
		console.error('Failed to exchange authorization code for tokens', err);
		new Notice('Network error during Google authentication. Check your connection.');
		return false;
	}
};

/**
 * Disconnects Google Drive by clearing stored tokens and local change tracking.
 *
 * @param plugin - Plugin instance.
 */
export const disconnectGoogleDrive = async (
	plugin: ObsidianGoogleDrive,
): Promise<void> => {
	plugin.settings.refreshToken = '';
	plugin.settings.changesToken = '';
	plugin.settings.rootFolderId = '';
	plugin.accessToken = { token: '', expiresAt: 0 };
	await plugin.saveSettings();
	new Notice('Google Drive account disconnected.');
};