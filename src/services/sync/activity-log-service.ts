/**
 * Activity logging service for tracking real-time Google Drive synchronization events.
 * Maintains an in-memory ring buffer of recent sync events and notifies subscribers.
 * @module services/sync/activity-log-service
 */

/**
 * Categorized type of synchronization activity.
 */
export type ActivityAction =
	| 'push'
	| 'pull'
	| 'delete'
	| 'conflict'
	| 'error'
	| 'info';

/**
 * An individual sync activity record.
 */
export interface ActivityLogEntry {
	/** Unique entry identifier */
	readonly id: string;
	/** Timestamp in milliseconds */
	readonly timestamp: number;
	/** Action category */
	readonly action: ActivityAction;
	/** Human-readable event description */
	readonly message: string;
	/** Optional relative vault file path */
	readonly filePath?: string;
	/** Optional technical details or error stack */
	readonly details?: string;
}

/**
 * Listener function invoked when a new activity log entry is recorded.
 */
export type ActivityLogListener = (entry: ActivityLogEntry) => void;

/**
 * Maximum number of activity records kept in memory.
 */
export const MAX_ACTIVITY_LOG_ENTRIES = 200;

/**
 * In-memory manager for synchronization activity logging.
 */
export class ActivityLogService {
	private entries: ActivityLogEntry[] = [];
	private listeners = new Set<ActivityLogListener>();
	private idCounter = 0;

	/**
	 * Records a new synchronization activity event.
	 *
	 * @param action - Action classification.
	 * @param message - Summary description of the event.
	 * @param filePath - Optional path of the affected file.
	 * @param details - Optional additional context or error details.
	 * @returns The newly created activity log record.
	 */
	log(
		action: ActivityAction,
		message: string,
		filePath?: string,
		details?: string,
	): ActivityLogEntry {
		this.idCounter++;
		const entry: ActivityLogEntry = {
			id: `log-${Date.now()}-${this.idCounter}`,
			timestamp: Date.now(),
			action,
			message,
			filePath,
			details,
		};

		this.entries.unshift(entry);
		if (this.entries.length > MAX_ACTIVITY_LOG_ENTRIES) {
			this.entries.length = MAX_ACTIVITY_LOG_ENTRIES;
		}

		for (const listener of this.listeners) {
			try {
				listener(entry);
			} catch (error) {
				console.error('Error in activity log subscriber', error);
			}
		}

		return entry;
	}

	/**
	 * Returns an immutable snapshot of all recorded log entries (newest first).
	 */
	getEntries(): readonly ActivityLogEntry[] {
		return [...this.entries];
	}

	/**
	 * Subscribes to real-time activity log events.
	 *
	 * @param listener - Callback receiving new log entries.
	 * @returns Unsubscribe cleanup callback.
	 */
	subscribe(listener: ActivityLogListener): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	/**
	 * Clears all recorded entries from memory.
	 */
	clear(): void {
		this.entries = [];
	}

	/**
	 * Formats all recorded log entries into a plain-text representation suitable for export.
	 */
	exportAsText(): string {
		if (this.entries.length === 0) {
			return 'No synchronization activity recorded.';
		}

		return this.entries
			.map((entry) => {
				const date = new Date(entry.timestamp).toISOString();
				const action = entry.action.toUpperCase().padEnd(8, ' ');
				const path = entry.filePath ? ` [${entry.filePath}]` : '';
				const details = entry.details ? ` (${entry.details})` : '';
				return `${date} | ${action} | ${entry.message}${path}${details}`;
			})
			.join('\n');
	}

	/**
	 * Formats all recorded log entries into JSON string format.
	 */
	exportAsJson(): string {
		return JSON.stringify(this.entries, null, 2);
	}
}

/**
 * Global shared activity logger instance.
 */
export const activityLogger = new ActivityLogService();
