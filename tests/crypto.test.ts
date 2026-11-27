import { describe, expect, it } from 'vitest';
import {
	decryptData,
	E2EEDecryptionError,
	encryptData,
	isEncrypted,
} from '../src/services/crypto/crypto-service';

describe('Zero-Knowledge E2EE Crypto Service', () => {
	const password = 'my-super-secret-vault-passphrase-2026';
	const encoder = new TextEncoder();
	const decoder = new TextDecoder();

	it('detects encrypted payloads via isEncrypted', async () => {
		const plaintext = encoder.encode('Hello World vault content').buffer;
		expect(isEncrypted(plaintext)).toBe(false);

		const encrypted = await encryptData(plaintext, password);
		expect(isEncrypted(encrypted)).toBe(true);
	});

	it('successfully encrypts and decrypts text roundtrip', async () => {
		const rawText = '# My Top Secret Journal\n\nConfidential thoughts and plans.';
		const inputBuffer = encoder.encode(rawText).buffer;

		const encrypted = await encryptData(inputBuffer, password);
		expect(encrypted.byteLength).toBeGreaterThan(inputBuffer.byteLength);

		const decrypted = await decryptData(encrypted, password);
		expect(decoder.decode(decrypted)).toBe(rawText);
	});

	it('produces distinct ciphertexts for identical inputs due to random salt and IV', async () => {
		const inputBuffer = encoder.encode('Deterministic input').buffer;

		const encrypted1 = new Uint8Array(await encryptData(inputBuffer, password));
		const encrypted2 = new Uint8Array(await encryptData(inputBuffer, password));

		expect(encrypted1).not.toEqual(encrypted2);
	});

	it('rejects decryption when given an incorrect password', async () => {
		const inputBuffer = encoder.encode('Secrets').buffer;
		const encrypted = await encryptData(inputBuffer, password);

		await expect(decryptData(encrypted, 'wrong-password')).rejects.toThrow(
			E2EEDecryptionError,
		);
	});

	it('rejects decryption on unencrypted plain text', async () => {
		const plaintext = encoder.encode('Plain markdown content without header').buffer;

		await expect(decryptData(plaintext, password)).rejects.toThrow(
			E2EEDecryptionError,
		);
	});

	it('rejects encryption when password is empty', async () => {
		const plaintext = encoder.encode('test').buffer;
		await expect(encryptData(plaintext, '')).rejects.toThrow();
	});

	it('rejects decryption on truncated payload', async () => {
		const plaintext = encoder.encode('Small note').buffer;
		const encrypted = await encryptData(plaintext, password);
		const truncated = encrypted.slice(0, 20); // Less than MIN_ENCRYPTED_PAYLOAD_BYTES

		await expect(decryptData(truncated, password)).rejects.toThrow(
			E2EEDecryptionError,
		);
	});
});
