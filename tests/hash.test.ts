import { describe, expect, it } from 'vitest';
import {
	areHashesEqual,
	computeMd5,
	computeSha256,
} from '../src/services/sync/hash-service';

describe('Hash Service - RFC 1321 MD5 & SHA-256', () => {
	const textToBuffer = (str: string): ArrayBuffer =>
		new TextEncoder().encode(str).buffer;

	it('produces correct RFC 1321 MD5 test vector for empty string', () => {
		const hash = computeMd5(textToBuffer(''));
		expect(hash).toBe('d41d8cd98f00b204e9800998ecf8427e');
	});

	it('produces correct MD5 test vector for "a"', () => {
		const hash = computeMd5(textToBuffer('a'));
		expect(hash).toBe('0cc175b9c0f1b6a831c399e269772661');
	});

	it('produces correct MD5 test vector for "abc"', () => {
		const hash = computeMd5(textToBuffer('abc'));
		expect(hash).toBe('900150983cd24fb0d6963f7d28e17f72');
	});

	it('produces correct MD5 test vector for "message digest"', () => {
		const hash = computeMd5(textToBuffer('message digest'));
		expect(hash).toBe('f96b697d7cb7938d525a2f31aaf161d0');
	});

	it('computes valid SHA-256 hex digest', async () => {
		const hash = await computeSha256(textToBuffer('hello world'));
		expect(hash).toBe(
			'b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9',
		);
	});

	it('compares hashes case-insensitively', () => {
		expect(
			areHashesEqual(
				'd41d8cd98f00b204e9800998ecf8427e',
				'D41D8CD98F00B204E9800998ECF8427E',
			),
		).toBe(true);
		expect(
			areHashesEqual(
				'd41d8cd98f00b204e9800998ecf8427e',
				'900150983cd24fb0d6963f7d28e17f72',
			),
		).toBe(false);
		expect(areHashesEqual(undefined, 'abc')).toBe(false);
	});
});
