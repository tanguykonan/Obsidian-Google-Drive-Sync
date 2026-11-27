/**
 * Zero-Knowledge End-to-End Encryption (E2EE) service.
 * Implements authenticated symmetric encryption (AES-256-GCM) with key derivation (PBKDF2-SHA256).
 * Uses standard Web Crypto API compatible with all Obsidian desktop and mobile platforms.
 * @module services/crypto/crypto-service
 */

/** Magic header prefix identifying an encrypted file payload */
export const E2EE_MAGIC_HEADER = 'GDS_ENC_V1';

/** Cryptographic parameters */
export const CRYPTO_PARAMS = {
	SALT_LENGTH_BYTES: 16,
	IV_LENGTH_BYTES: 12,
	PBKDF2_ITERATIONS: 100_000,
	AES_KEY_LENGTH_BITS: 256,
} as const;

/** Minimum byte length required for a valid encrypted payload */
export const MIN_ENCRYPTED_PAYLOAD_BYTES =
	E2EE_MAGIC_HEADER.length +
	CRYPTO_PARAMS.SALT_LENGTH_BYTES +
	CRYPTO_PARAMS.IV_LENGTH_BYTES +
	16; // 16 bytes minimum for AES-GCM authentication tag

/**
 * Custom error thrown when E2EE decryption fails (wrong password or corrupted ciphertext).
 */
export class E2EEDecryptionError extends Error {
	constructor(message = 'Failed to decrypt file. Please verify your E2EE password.') {
		super(message);
		this.name = 'E2EEDecryptionError';
	}
}

/**
 * Checks whether an ArrayBuffer contains a valid E2EE encrypted payload based on its magic header.
 *
 * @param buffer - Data buffer to inspect.
 * @returns True if the payload starts with the E2EE magic header.
 */
export const isEncrypted = (buffer?: ArrayBuffer | null): boolean => {
	if (!buffer || typeof buffer.byteLength !== 'number' || buffer.byteLength < E2EE_MAGIC_HEADER.length) {
		return false;
	}
	const headerBytes = new Uint8Array(buffer, 0, E2EE_MAGIC_HEADER.length);
	const headerString = String.fromCharCode(...headerBytes);
	return headerString === E2EE_MAGIC_HEADER;
};

/**
 * Derives an AES-GCM 256-bit CryptoKey from a user password and cryptographic salt using PBKDF2-SHA256.
 *
 * @param password - Master secret passphrase.
 * @param salt - 16-byte random salt.
 * @returns Derived CryptoKey instance ready for encryption or decryption.
 */
export const deriveKey = async (
	password: string,
	salt: Uint8Array,
): Promise<CryptoKey> => {
	const encoder = new TextEncoder();
	const passwordBytes = encoder.encode(password);

	const baseKey = await crypto.subtle.importKey(
		'raw',
		passwordBytes,
		{ name: 'PBKDF2' },
		false,
		['deriveKey'],
	);

	return crypto.subtle.deriveKey(
		{
			name: 'PBKDF2',
			salt: salt as BufferSource,
			iterations: CRYPTO_PARAMS.PBKDF2_ITERATIONS,
			hash: 'SHA-256',
		},
		baseKey,
		{
			name: 'AES-GCM',
			length: CRYPTO_PARAMS.AES_KEY_LENGTH_BITS,
		},
		false,
		['encrypt', 'decrypt'],
	);
};

/**
 * Encrypts arbitrary binary data using AES-256-GCM with a user-provided passphrase.
 * Prepends the magic header, PBKDF2 salt, and random IV to the resulting buffer.
 *
 * @param data - Plaintext or binary data to encrypt.
 * @param password - Passphrase used to derive the encryption key.
 * @returns ArrayBuffer containing [MAGIC_HEADER | SALT (16B) | IV (12B) | CIPHERTEXT + TAG].
 */
export const encryptData = async (
	data: ArrayBuffer,
	password: string,
): Promise<ArrayBuffer> => {
	if (!password) {
		throw new Error('E2EE encryption requires a non-empty password.');
	}

	const salt = new Uint8Array(CRYPTO_PARAMS.SALT_LENGTH_BYTES);
	crypto.getRandomValues(salt);

	const iv = new Uint8Array(CRYPTO_PARAMS.IV_LENGTH_BYTES);
	crypto.getRandomValues(iv);

	const key = await deriveKey(password, salt);

	const ciphertext = await crypto.subtle.encrypt(
		{
			name: 'AES-GCM',
			iv,
		},
		key,
		data,
	);

	const headerEncoder = new TextEncoder();
	const magicHeaderBytes = headerEncoder.encode(E2EE_MAGIC_HEADER);

	const totalLength =
		magicHeaderBytes.byteLength +
		salt.byteLength +
		iv.byteLength +
		ciphertext.byteLength;

	const output = new Uint8Array(totalLength);
	let offset = 0;

	output.set(magicHeaderBytes, offset);
	offset += magicHeaderBytes.byteLength;

	output.set(salt, offset);
	offset += salt.byteLength;

	output.set(iv, offset);
	offset += iv.byteLength;

	output.set(new Uint8Array(ciphertext), offset);

	return output.buffer;
};

/**
 * Decrypts an encrypted ArrayBuffer payload using AES-256-GCM and the user passphrase.
 *
 * @param encryptedData - Encrypted payload [MAGIC_HEADER | SALT (16B) | IV (12B) | CIPHERTEXT].
 * @param password - Passphrase used for key derivation.
 * @returns ArrayBuffer containing the decrypted plaintext or binary data.
 * @throws E2EEDecryptionError if decryption fails or format is invalid.
 */
export const decryptData = async (
	encryptedData: ArrayBuffer,
	password: string,
): Promise<ArrayBuffer> => {
	if (!password) {
		throw new E2EEDecryptionError('Decryption failed: No E2EE password configured.');
	}

	if (!isEncrypted(encryptedData)) {
		throw new E2EEDecryptionError('Invalid format: File is not encrypted with GDS_ENC_V1.');
	}

	if (encryptedData.byteLength < MIN_ENCRYPTED_PAYLOAD_BYTES) {
		throw new E2EEDecryptionError('Corrupted payload: Encrypted buffer is truncated.');
	}

	const magicLength = E2EE_MAGIC_HEADER.length;
	const saltLength = CRYPTO_PARAMS.SALT_LENGTH_BYTES;
	const ivLength = CRYPTO_PARAMS.IV_LENGTH_BYTES;

	const salt = new Uint8Array(encryptedData, magicLength, saltLength);
	const iv = new Uint8Array(encryptedData, magicLength + saltLength, ivLength);
	const ciphertextOffset = magicLength + saltLength + ivLength;
	const ciphertext = new Uint8Array(encryptedData, ciphertextOffset);

	try {
		const key = await deriveKey(password, salt);
		return await crypto.subtle.decrypt(
			{
				name: 'AES-GCM',
				iv,
			},
			key,
			ciphertext,
		);
	} catch {
		throw new E2EEDecryptionError('Decryption failed: Incorrect password or corrupted data.');
	}
};
