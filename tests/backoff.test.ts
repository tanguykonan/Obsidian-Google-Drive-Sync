import { describe, expect, it, vi } from 'vitest';

vi.stubGlobal('window', globalThis);

import { executeWithRetry } from '../src/utils/backoff';

describe('Backoff Retry Utility', () => {
	it('returns immediately on successful execution', async () => {
		const task = vi.fn(async () => 'success');
		const result = await executeWithRetry(task);

		expect(result).toBe('success');
		expect(task).toHaveBeenCalledTimes(1);
	});

	it('retries on retryable HTTP 429 status and succeeds', async () => {
		let attempts = 0;
		const task = vi.fn(async () => {
			attempts++;
			if (attempts < 3) {
				const err = new Error('Too Many Requests') as Error & { status?: number };
				err.status = 429;
				throw err;
			}
			return 'recovered';
		});

		const result = await executeWithRetry(task, {
			maxRetries: 3,
			baseDelayMs: 5,
			maxDelayMs: 20,
		});

		expect(result).toBe('recovered');
		expect(attempts).toBe(3);
	});

	it('throws immediately on non-retryable errors (e.g. 401 Unauthorized)', async () => {
		const task = vi.fn(async () => {
			const err = new Error('Unauthorized') as Error & { status?: number };
			err.status = 401;
			throw err;
		});

		await expect(
			executeWithRetry(task, { maxRetries: 3, baseDelayMs: 5 }),
		).rejects.toThrow('Unauthorized');

		expect(task).toHaveBeenCalledTimes(1);
	});

	it('exhausts retries and throws after maxRetries', async () => {
		const task = vi.fn(async () => {
			const err = new Error('Service Unavailable') as Error & { status?: number };
			err.status = 503;
			throw err;
		});

		await expect(
			executeWithRetry(task, {
				maxRetries: 2,
				baseDelayMs: 5,
				maxDelayMs: 15,
			}),
		).rejects.toThrow('Service Unavailable');

		expect(task).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
	});
});
