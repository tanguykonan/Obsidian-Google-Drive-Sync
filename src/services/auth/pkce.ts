/**
 * OAuth 2.0 PKCE (Proof Key for Code Exchange) utilities.
 * Implements RFC 7636 using standard Web Crypto API (supported on desktop and mobile).
 * @module services/auth/pkce
 */

import { AUTH_CONFIG, ENDPOINTS } from '../../constants';

const PKCE_CHARSET = AUTH_CONFIG.PKCE_CHARSET;

/**
 * Converts an ArrayBuffer into a Base64-URL string (without padding).
 *
 * @param buffer - ArrayBuffer to encode.
 * @returns Base64URL encoded string.
 */
export const bufferToBase64Url = (buffer: ArrayBuffer): string => {
	const bytes = new Uint8Array(buffer);
	let binary = '';
	for (let i = 0; i < bytes.byteLength; i++) {
		binary += String.fromCharCode(bytes[i] as number);
	}
	return btoa(binary)
		.replace(/\+/g, '-')
		.replace(/\//g, '_')
		.replace(/=+$/, '');
};

/**
 * Generates a cryptographically random code_verifier string between 43 and 128 characters.
 *
 * @param length - Desired string length (defaults to 64).
 * @returns The random code_verifier string.
 */
export const generateCodeVerifier = (length = 64): string => {
	const randomValues = new Uint8Array(length);
	crypto.getRandomValues(randomValues);
	let verifier = '';
	for (let i = 0; i < length; i++) {
		verifier += PKCE_CHARSET[(randomValues[i] as number) % PKCE_CHARSET.length];
	}
	return verifier;
};

/**
 * Computes the S256 code_challenge from a code_verifier string.
 * code_challenge = BASE64URL-ENCODE(SHA256(ASCII(code_verifier)))
 *
 * @param codeVerifier - The verifier string.
 * @returns Promise resolving to the Base64URL-encoded SHA-256 challenge string.
 */
export const generateCodeChallenge = async (
	codeVerifier: string,
): Promise<string> => {
	const encoder = new TextEncoder();
	const data = encoder.encode(codeVerifier);
	const digest = await crypto.subtle.digest('SHA-256', data);
	return bufferToBase64Url(digest);
};

/**
 * Generates a random state string for OAuth CSRF mitigation.
 *
 * @returns Random alphanumeric state string.
 */
export const generateOAuthState = (): string => {
	const randomValues = new Uint8Array(24);
	crypto.getRandomValues(randomValues);
	return bufferToBase64Url(randomValues.buffer);
};

/**
 * Configuration parameters for generating a Google OAuth 2.0 authorization URL.
 */
export interface AuthUrlParams {
	/** Google OAuth 2.0 Client ID */
	clientId: string;
	/** Deep-link redirect URI bridge */
	redirectUri: string;
	/** Base64URL-encoded SHA-256 PKCE code challenge */
	codeChallenge: string;
	/** Cryptographic state token for CSRF protection */
	state: string;
	/** Optional OAuth scopes override */
	scope?: string;
}

/**
 * Constructs the Google OAuth 2.0 authorization URL for PKCE authentication.
 *
 * @param params - Configuration options for the authorization URL.
 * @returns Fully formatted authorization URL.
 */
export const buildGoogleAuthUrl = (params: AuthUrlParams): string => {
	const scope = params.scope || AUTH_CONFIG.DEFAULT_SCOPES;

	const url = new URL(ENDPOINTS.GOOGLE_OAUTH_AUTH);
	url.searchParams.set('client_id', params.clientId);
	url.searchParams.set('redirect_uri', params.redirectUri);
	url.searchParams.set('response_type', 'code');
	url.searchParams.set('scope', scope);
	url.searchParams.set('code_challenge', params.codeChallenge);
	url.searchParams.set('code_challenge_method', 'S256');
	url.searchParams.set('state', params.state);
	url.searchParams.set('access_type', 'offline');
	url.searchParams.set('prompt', 'consent');

	return url.toString();
};
