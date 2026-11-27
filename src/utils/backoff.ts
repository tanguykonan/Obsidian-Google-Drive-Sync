/**
 * Network resilience and exponential backoff utility with jitter.
 * Handles rate limits (HTTP 429) and transient server errors (HTTP 500, 503).
 * @module utils/backoff
 */

export interface RetryOptions {
	/** Maximum number of retry attempts before giving up (default: 3) */
	maxRetries?: number;
	/** Initial base delay in milliseconds (default: 1000ms) */
	baseDelayMs?: number;
	/** Maximum ceiling delay in milliseconds (default: 16000ms) */
	maxDelayMs?: number;
	/** Predicate function determining if an error is retryable */
	isRetryable?: (error: unknown) => boolean;
}

const defaultIsRetryable = (error: unknown): boolean => {
	if (error && typeof error === 'object') {
		const err = error as { status?: number; statusCode?: number; message?: string };
		const code = err.status || err.statusCode;
		if (code === 429 || code === 500 || code === 502 || code === 503 || code === 504) {
			return true;
		}
		if (typeof err.message === 'string') {
			return (
				err.message.includes('429') ||
				err.message.includes('503') ||
				err.message.includes('rate limit') ||
				err.message.includes('network') ||
				err.message.includes('offline')
			);
		}
	}
	return false;
};

/**
 * Asynchronously pauses execution for a given duration.
 *
 * @param ms - Delay in milliseconds.
 */
export const sleep = (ms: number): Promise<void> =>
	new Promise((resolve) => window.setTimeout(resolve, ms));

/**
 * Executes an asynchronous operation, automatically retrying with exponential backoff and jitter on failure.
 *
 * @param task - Async function to execute.
 * @param options - Configuration for retries and backoff intervals.
 * @returns The resolved result of the task.
 */
export const executeWithRetry = async <T>(
	task: () => Promise<T>,
	options: RetryOptions = {},
): Promise<T> => {
	const maxRetries = options.maxRetries ?? 3;
	const baseDelayMs = options.baseDelayMs ?? 1000;
	const maxDelayMs = options.maxDelayMs ?? 16000;
	const isRetryable = options.isRetryable ?? defaultIsRetryable;

	let attempt = 0;

	while (true) {
		try {
			return await task();
		} catch (error) {
			attempt++;
			if (attempt > maxRetries || !isRetryable(error)) {
				throw error;
			}

			// Full jitter exponential backoff: random between 0 and min(maxDelay, baseDelay * 2^attempt)
			const exponentialDelay = Math.min(maxDelayMs, baseDelayMs * Math.pow(2, attempt));
			const delayWithJitter = Math.floor(Math.random() * exponentialDelay);

			console.warn(
				`[Network Retry] Attempt ${attempt}/${maxRetries} failed. Retrying in ${delayWithJitter}ms...`,
				error,
			);
			await sleep(delayWithJitter);
		}
	}
};
