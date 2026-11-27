/**
 * Checksum and content fingerprinting utilities.
 * Implements pure RFC 1321 MD5 calculation to match Google Drive's native md5Checksum,
 * and Web Crypto SHA-256 for local state hashing without external runtime dependencies.
 * @module services/sync/hash-service
 */

/**
 * Computes standard RFC 1321 MD5 hexadecimal digest from an ArrayBuffer.
 * Exactly matches Google Drive's md5Checksum property.
 *
 * @param buffer - Data buffer to hash.
 * @returns Lowercase 32-character hexadecimal MD5 hash string.
 */
export const computeMd5 = (buffer: ArrayBuffer): string => {
	const bytes = new Uint8Array(buffer);
	const byteLength = bytes.length;

	// Number of 32-bit words needed after 64-bit length padding
	const wordCount = (((byteLength + 8) >> 6) + 1) << 4;
	const words = new Int32Array(wordCount);

	for (let i = 0; i < byteLength; i++) {
		const wordIdx = i >> 2;
		words[wordIdx] = (words[wordIdx] ?? 0) | ((bytes[i] as number) << ((i % 4) << 3));
	}
	const padIdx = byteLength >> 2;
	words[padIdx] = (words[padIdx] ?? 0) | (0x80 << ((byteLength % 4) << 3));
	words[wordCount - 2] = (byteLength << 3) & 0xffffffff;
	words[wordCount - 1] = Math.floor(byteLength / 0x20000000);

	let a = 1732584193;
	let b = -271733879;
	let c = -1732584194;
	let d = 271733878;

	const rol = (x: number, c: number) => (x << c) | (x >>> (32 - c));
	const cmn = (q: number, a: number, b: number, x: number, s: number, t: number) =>
		((rol(((a + q + x + t) | 0), s) + b) | 0);
	const ff = (a: number, b: number, c: number, d: number, x: number, s: number, t: number) =>
		cmn((b & c) | (~b & d), a, b, x, s, t);
	const gg = (a: number, b: number, c: number, d: number, x: number, s: number, t: number) =>
		cmn((b & d) | (c & ~d), a, b, x, s, t);
	const hh = (a: number, b: number, c: number, d: number, x: number, s: number, t: number) =>
		cmn(b ^ c ^ d, a, b, x, s, t);
	const ii = (a: number, b: number, c: number, d: number, x: number, s: number, t: number) =>
		cmn(c ^ (b | ~d), a, b, x, s, t);

	for (let i = 0; i < words.length; i += 16) {
		const oldA = a;
		const oldB = b;
		const oldC = c;
		const oldD = d;

		const w0 = words[i] as number;
		const w1 = words[i + 1] as number;
		const w2 = words[i + 2] as number;
		const w3 = words[i + 3] as number;
		const w4 = words[i + 4] as number;
		const w5 = words[i + 5] as number;
		const w6 = words[i + 6] as number;
		const w7 = words[i + 7] as number;
		const w8 = words[i + 8] as number;
		const w9 = words[i + 9] as number;
		const w10 = words[i + 10] as number;
		const w11 = words[i + 11] as number;
		const w12 = words[i + 12] as number;
		const w13 = words[i + 13] as number;
		const w14 = words[i + 14] as number;
		const w15 = words[i + 15] as number;

		a = ff(a, b, c, d, w0, 7, -680876936);
		d = ff(d, a, b, c, w1, 12, -389564586);
		c = ff(c, d, a, b, w2, 17, 606105819);
		b = ff(b, c, d, a, w3, 22, -1044525330);
		a = ff(a, b, c, d, w4, 7, -176418897);
		d = ff(d, a, b, c, w5, 12, 1200080426);
		c = ff(c, d, a, b, w6, 17, -1473231341);
		b = ff(b, c, d, a, w7, 22, -45705983);
		a = ff(a, b, c, d, w8, 7, 1770035416);
		d = ff(d, a, b, c, w9, 12, -1958414417);
		c = ff(c, d, a, b, w10, 17, -42063);
		b = ff(b, c, d, a, w11, 22, -1990404162);
		a = ff(a, b, c, d, w12, 7, 1804603682);
		d = ff(d, a, b, c, w13, 12, -40341101);
		c = ff(c, d, a, b, w14, 17, -1502002290);
		b = ff(b, c, d, a, w15, 22, 1236535329);

		a = gg(a, b, c, d, w1, 5, -165796510);
		d = gg(d, a, b, c, w6, 9, -1069501632);
		c = gg(c, d, a, b, w11, 14, 643717713);
		b = gg(b, c, d, a, w0, 20, -373897302);
		a = gg(a, b, c, d, w5, 5, -701558691);
		d = gg(d, a, b, c, w10, 9, 38016083);
		c = gg(c, d, a, b, w15, 14, -660478335);
		b = gg(b, c, d, a, w4, 20, -405537848);
		a = gg(a, b, c, d, w9, 5, 568446438);
		d = gg(d, a, b, c, w14, 9, -1019803690);
		c = gg(c, d, a, b, w3, 14, -187363961);
		b = gg(b, c, d, a, w8, 20, 1163531501);
		a = gg(a, b, c, d, w13, 5, -1444681467);
		d = gg(d, a, b, c, w2, 9, -51403784);
		c = gg(c, d, a, b, w7, 14, 1735328473);
		b = gg(b, c, d, a, w12, 20, -1926607734);

		a = hh(a, b, c, d, w5, 4, -378558);
		d = hh(d, a, b, c, w8, 11, -2022574463);
		c = hh(c, d, a, b, w11, 16, 1839030562);
		b = hh(b, c, d, a, w14, 23, -35309556);
		a = hh(a, b, c, d, w1, 4, -1530992060);
		d = hh(d, a, b, c, w4, 11, 1272893353);
		c = hh(c, d, a, b, w7, 16, -155497632);
		b = hh(b, c, d, a, w10, 23, -1094730640);
		a = hh(a, b, c, d, w13, 4, 681279174);
		d = hh(d, a, b, c, w0, 11, -358537222);
		c = hh(c, d, a, b, w3, 16, -722521979);
		b = hh(b, c, d, a, w6, 23, 76029189);
		a = hh(a, b, c, d, w9, 4, -640364487);
		d = hh(d, a, b, c, w12, 11, -421815835);
		c = hh(c, d, a, b, w15, 16, 530742520);
		b = hh(b, c, d, a, w2, 23, -995338651);

		a = ii(a, b, c, d, w0, 6, -198630844);
		d = ii(d, a, b, c, w7, 10, 1126891415);
		c = ii(c, d, a, b, w14, 15, -1416354905);
		b = ii(b, c, d, a, w5, 21, -57434055);
		a = ii(a, b, c, d, w12, 6, 1700485571);
		d = ii(d, a, b, c, w3, 10, -1894986606);
		c = ii(c, d, a, b, w10, 15, -1051523);
		b = ii(b, c, d, a, w1, 21, -2054922799);
		a = ii(a, b, c, d, w8, 6, 1873313359);
		d = ii(d, a, b, c, w15, 10, -30611744);
		c = ii(c, d, a, b, w6, 15, -1560198380);
		b = ii(b, c, d, a, w13, 21, 1309151649);
		a = ii(a, b, c, d, w4, 6, -145523070);
		d = ii(d, a, b, c, w11, 10, -1120210379);
		c = ii(c, d, a, b, w2, 15, 718787259);
		b = ii(b, c, d, a, w9, 21, -343485551);

		a = (a + oldA) | 0;
		b = (b + oldB) | 0;
		c = (c + oldC) | 0;
		d = (d + oldD) | 0;
	}

	const hexChars = '0123456789abcdef';
	let hex = '';
	for (const num of [a, b, c, d]) {
		for (let i = 0; i < 4; i++) {
			const byte = (num >>> (i << 3)) & 0xff;
			const highNibble = (byte >>> 4) & 0x0f;
			const lowNibble = byte & 0x0f;
			hex += (hexChars[highNibble] ?? '') + (hexChars[lowNibble] ?? '');
		}
	}
	return hex;
};

/**
 * Computes a SHA-256 hexadecimal hash using the Web Crypto API.
 *
 * @param buffer - Data buffer to hash.
 * @returns Promise resolving to a 64-character lowercase hexadecimal hash.
 */
export const computeSha256 = async (buffer: ArrayBuffer): Promise<string> => {
	const digest = await crypto.subtle.digest('SHA-256', buffer);
	const bytes = new Uint8Array(digest);
	let hex = '';
	for (let i = 0; i < bytes.length; i++) {
		hex += (bytes[i] as number).toString(16).padStart(2, '0');
	}
	return hex;
};

/**
 * Case-insensitive comparison between two hashes.
 *
 * @param hashA - First hash string.
 * @param hashB - Second hash string.
 * @returns True if both hashes match identically.
 */
export const areHashesEqual = (hashA?: string, hashB?: string): boolean => {
	if (!hashA || !hashB) return false;
	return hashA.trim().toLowerCase() === hashB.trim().toLowerCase();
};
