import { describe, expect, it, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
	notices: [] as string[],
	requestUrl: vi.fn(),
}));

vi.mock('obsidian', () => ({
	Notice: class {
		constructor(message: string) {
			mocks.notices.push(message);
		}
	},
	requestUrl: mocks.requestUrl,
}));

import {
	buildGoogleAuthUrl,
	generateCodeChallenge,
	generateCodeVerifier,
	generateOAuthState,
} from '../src/services/auth/pkce';
import {
	disconnectGoogleDrive,
	handleOAuthProtocolCallback,
} from '../src/services/auth/token-service';

describe('OAuth PKCE generator', () => {
	it('generates a code_verifier of requested length', () => {
		const verifier = generateCodeVerifier(64);
		expect(verifier).toHaveLength(64);
		expect(verifier).toMatch(/^[A-Za-z0-9\-._~]+$/);
	});

	it('computes a valid Base64URL SHA-256 code_challenge', async () => {
		const verifier = 'test_code_verifier_string_1234567890_abcdefghijklmnopqrstuvwxyz';
		const challenge = await generateCodeChallenge(verifier);

		expect(challenge).toBeTruthy();
		expect(challenge).not.toContain('+');
		expect(challenge).not.toContain('/');
		expect(challenge).not.toContain('=');
	});

	it('generates a random OAuth state string', () => {
		const state1 = generateOAuthState();
		const state2 = generateOAuthState();
		expect(state1).not.toBe(state2);
		expect(state1.length).toBeGreaterThan(10);
	});

	it('constructs a valid Google OAuth authorization URL', () => {
		const urlString = buildGoogleAuthUrl({
			clientId: 'my-client-id.apps.googleusercontent.com',
			redirectUri: 'https://example.com/oauth/callback',
			codeChallenge: 'challenge-abc',
			state: 'state-xyz',
		});

		const url = new URL(urlString);
		expect(url.hostname).toBe('accounts.google.com');
		expect(url.pathname).toBe('/o/oauth2/v2/auth');
		expect(url.searchParams.get('client_id')).toBe('my-client-id.apps.googleusercontent.com');
		expect(url.searchParams.get('code_challenge')).toBe('challenge-abc');
		expect(url.searchParams.get('code_challenge_method')).toBe('S256');
		expect(url.searchParams.get('state')).toBe('state-xyz');
	});
});

describe('Token Service', () => {
	beforeEach(() => {
		mocks.notices.length = 0;
		mocks.requestUrl.mockReset();
	});

	it('rejects callbacks with error parameters', async () => {
		const plugin = {
			settings: { refreshToken: '' },
		} as never;

		const result = await handleOAuthProtocolCallback(plugin, {
			error: 'access_denied',
			error_description: 'User canceled login',
		});

		expect(result).toBe(false);
		expect(mocks.notices[0]).toContain('Google login failed');
	});

	it('exchanges code for tokens and saves settings', async () => {
		mocks.requestUrl.mockResolvedValueOnce({
			status: 200,
			json: {
				access_token: 'new-access-token',
				refresh_token: 'new-refresh-token',
				expires_in: 3600,
			},
		});

		const plugin = {
			settings: {
				clientId: 'test-client',
				clientSecret: 'test-secret',
				refreshToken: '',
				changesToken: '',
			},
			accessToken: { token: '', expiresAt: 0 },
			drive: {
				getChangesStartToken: vi.fn(async () => 'initial-changes-token'),
			},
			saveSettings: vi.fn(async () => undefined),
			initSyncAfterAuth: vi.fn(async () => undefined),
		};

		const result = await handleOAuthProtocolCallback(plugin as never, {
			code: 'valid-auth-code',
		});

		expect(result).toBe(true);
		expect(plugin.settings.refreshToken).toBe('new-refresh-token');
		expect(plugin.settings.changesToken).toBe('initial-changes-token');
		expect(plugin.accessToken.token).toBe('new-access-token');
		expect(plugin.saveSettings).toHaveBeenCalled();
		expect(plugin.initSyncAfterAuth).toHaveBeenCalled();
	});

	it('disconnects Google Drive account cleanly', async () => {
		const plugin = {
			settings: {
				refreshToken: 'active-token',
				changesToken: 'active-changes',
				rootFolderId: 'folder-123',
			},
			accessToken: { token: 'active-access', expiresAt: 12345 },
			saveSettings: vi.fn(async () => undefined),
		};

		await disconnectGoogleDrive(plugin as never);

		expect(plugin.settings.refreshToken).toBe('');
		expect(plugin.settings.changesToken).toBe('');
		expect(plugin.settings.rootFolderId).toBe('');
		expect(plugin.accessToken.token).toBe('');
		expect(plugin.saveSettings).toHaveBeenCalled();
	});
});