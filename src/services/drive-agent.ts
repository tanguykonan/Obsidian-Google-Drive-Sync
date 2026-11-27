/**
 * Network layer for Google Drive API interactions using Obsidian's requestUrl.
 * @module services/drive-agent
 */

import { Notice, requestUrl, type RequestUrlResponse } from 'obsidian';
import type ObsidianGoogleDrive from '../main';
import type { DriveResponse, RequestOptions, AccessTokenState } from '../types';
import { executeWithRetry } from '../utils/backoff';
import { AUTH_CONFIG, DEFAULT_RETRY_CONFIG, ENDPOINTS, TIMINGS } from '../constants';

/**
 * Serializes request options into an HTTP body payload and appropriate Content-Type header.
 *
 * @param options - Request options containing json, string, or binary data.
 * @returns Serialized body and optional content-type.
 */
export const serializeBody = async (
	options: RequestOptions,
): Promise<{ body?: string | ArrayBuffer; contentType?: string }> => {
	if (options.json !== undefined) {
		return {
			body: JSON.stringify(options.json),
			contentType: 'application/json',
		};
	}

	if (options.body === undefined || options.body === null) return {};
	if (typeof options.body === 'string') return { body: options.body };
	if (options.body instanceof ArrayBuffer) return { body: options.body };
	if (ArrayBuffer.isView(options.body)) {
		return {
			body: options.body.buffer.slice(
				options.body.byteOffset,
				options.body.byteOffset + options.body.byteLength,
			),
		};
	}

	const encoded = new Request('https://localhost', {
		method: 'POST',
		body: options.body,
	});
	return {
		body: await encoded.arrayBuffer(),
		contentType: encoded.headers.get('Content-Type') ?? undefined,
	};
};

/**
 * Wraps an Obsidian RequestUrlResponse into the standard DriveResponse contract.
 *
 * @param response - Raw response from requestUrl.
 * @returns Normalized DriveResponse object.
 */
export const toDriveResponse = (response: RequestUrlResponse): DriveResponse => ({
	ok: response.status >= 200 && response.status < 300,
	status: response.status,
	arrayBuffer: async () => response.arrayBuffer,
	json: async <T>() => response.json as T,
	text: async () => response.text,
});

/**
 * Creates a configured network agent bound to the plugin instance.
 * Automatically injects authorization tokens and manages retry loops.
 *
 * @param t - Plugin instance.
 * @returns Client with get, post, patch, and delete HTTP methods.
 */
export const getDriveAgent = (t: ObsidianGoogleDrive) => {
	const send = (
		method: string,
		path: string,
		options: RequestOptions = {},
	) => {
		const response = (async () => {
			if (
				t.accessToken.token &&
				t.accessToken.expiresAt - Date.now() < TIMINGS.TOKEN_EXPIRY_MARGIN_MS
			) {
				await refreshAccessToken(t);
			}

			const { body, contentType } = await serializeBody(options);
			const headers = { ...options.headers };
			if (t.accessToken.token) {
				headers.Authorization = `Bearer ${t.accessToken.token}`;
			}

			const result = await executeWithRetry(
				async () => {
					const res = await requestUrl({
						url: new URL(path, ENDPOINTS.GOOGLE_DRIVE_API).toString(),
						method,
						headers,
						body,
						contentType,
						throw: false,
					});
					if (res.status === 429 || res.status === 503) {
						const retryErr = new Error(res.text) as Error & { status?: number };
						retryErr.status = res.status;
						throw retryErr;
					}
					return res;
				},
				DEFAULT_RETRY_CONFIG,
			);

			if (result.status < 200 || result.status >= 300) {
				new Notice(`Error: ${result.text}`);
				throw new Error(
					`Request failed with status ${result.status}: ${result.text}`,
				);
			}
			return toDriveResponse(result);
		})();

		return {
			arrayBuffer: () => response.then((res) => res.arrayBuffer()),
			json: <T>() => response.then((res) => res.json<T>()),
			text: () => response.then((res) => res.text()),
			then: response.then.bind(response),
		};
	};

	return {
		get: (path: string, options?: RequestOptions) => send('GET', path, options),
		post: (path: string, options?: RequestOptions) => send('POST', path, options),
		patch: (path: string, options?: RequestOptions) => send('PATCH', path, options),
		delete: (path: string, options?: RequestOptions) => send('DELETE', path, options),
	};
};

/**
 * Refreshes the OAuth 2.0 access token using the stored refresh token.
 * Exchanges directly with Google's token endpoint without intermediate proxies.
 *
 * @param t - Plugin instance.
 * @param refreshToken - Optional explicit refresh token override.
 * @returns Updated access token state or undefined on failure.
 */
export const refreshAccessToken = async (
	t: ObsidianGoogleDrive,
	refreshToken?: string,
): Promise<AccessTokenState | undefined> => {
	try {
		const token = refreshToken || t.settings.refreshToken;
		const clientId = t.settings.clientId.trim() || AUTH_CONFIG.DEFAULT_CLIENT_ID;

		const params: Record<string, string> = {
			client_id: clientId,
		};
		const clientSecret =
			t.settings.clientSecret.trim() ||
			(clientId === AUTH_CONFIG.DEFAULT_CLIENT_ID
				? AUTH_CONFIG.DEFAULT_CLIENT_SECRET
				: '');
		if (clientSecret) {
			params.client_secret = clientSecret;
		}
		params.grant_type = 'refresh_token';
		params.refresh_token = token;

		const bodyParams = new URLSearchParams(params);

		const response = await requestUrl({
			url: ENDPOINTS.GOOGLE_OAUTH_TOKEN,
			method: 'POST',
			contentType: 'application/x-www-form-urlencoded',
			body: bodyParams.toString(),
			throw: false,
		});

		if ([400, 401, 403].includes(response.status)) {
			console.error(
				`Refresh token rejected (HTTP ${response.status}): ${response.text}`,
			);
			new Notice(
				'Your refresh token was rejected. Please add a new refresh token and try again.',
				0,
			);
			return undefined;
		}

		if (response.status < 200 || response.status >= 300) {
			new Notice(
				`Could not refresh your access token (HTTP ${response.status}). Your refresh token was kept; please try again.`,
			);
			return undefined;
		}

		const { expires_in, access_token } = response.json as {
			expires_in: number;
			access_token: string;
		};

		t.accessToken = {
			token: access_token,
			expiresAt: Date.now() + expires_in * 1000,
		};
		return t.accessToken;
	} catch {
		new Notice(
			'Could not refresh your access token. Your refresh token was kept; check your connection and try again.',
		);
		return undefined;
	}
};
