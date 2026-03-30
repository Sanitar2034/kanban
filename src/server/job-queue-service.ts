/**
 * JobQueueService — Node-side interface to the `job_queue` Rust sidecar.
 *
 * This service owns the lifecycle of the sidecar process and wraps every
 * CLI interaction with typed, async methods.  The rest of Kanban never
 * touches the SQLite DB or the binary directly — it always goes through
 * this class so that internal consistency guarantees of the queue are
 * preserved.
 */
import { type ChildProcess, execFile, spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { getJobQueueDatabaseUrl, getJobQueueDataDir, resolveJobQueueBinary } from "../core/job-queue-paths";

// ---------------------------------------------------------------------------
// Public data types
// ---------------------------------------------------------------------------

export interface JobQueueStatusCounts {
	status_counts: Record<string, number>;
	queue_status_counts: Record<string, Record<string, number>>;
}

export interface JobQueueWorkerActivitySection {
	stale_threshold_secs: number;
	active_workers_recent: number;
	stale_workers: number;
	workers: Record<string, unknown>;
}

export interface JobQueueInspectSnapshot {
	schema_version: number;
	generated_at: number;
	jobs: JobQueueStatusCounts;
	scheduled: JobQueueStatusCounts;
	diagnostics: Record<string, unknown>;
	contention: Record<string, unknown>;
	performance: {
		window_secs: number;
		sample_size: number;
		completed_per_sec: number;
		failed_per_sec: number;
		retries_per_sec: number;
		by_queue: Record<string, unknown>;
		by_signature: Record<string, unknown>;
		by_worker: Record<string, unknown>;
	};
	worker_activity: JobQueueWorkerActivitySection;
	alerts: string[];
	oldest_queued: unknown[];
}

export interface JobQueueHealthSummary {
	queued: number;
	running: number;
	scheduled_pending: number;
	overdue_scheduled: number;
	expired_running: number;
	stale_workers: number;
	active_workers_recent: number;
}

export interface JobQueueHealthReport {
	generated_at: number;
	status: "ok" | "degraded";
	reasons: string[];
	summary: JobQueueHealthSummary;
	shard_count: number;
}

export interface JobQueueEnqueueOptions {
	queue?: string;
	priority?: number;
	maxAttempts?: number;
	command: string;
	args?: string[];
	cwd?: string;
	timeoutSecs?: number;
}

export interface JobQueueScheduleOptions extends JobQueueEnqueueOptions {
	/** Relative delay, e.g. "10s", "5m", "2h", "1d".  Mutually exclusive with dueAt. */
	dueIn?: string;
	/** Absolute UNIX timestamp (seconds).  Mutually exclusive with dueIn. */
	dueAt?: number;
}

export interface JobQueueServiceOptions {
	/** Number of worker goroutines in the sidecar. Default: 4. */
	workers?: number;
	/** Scheduler poll interval in ms. Default: 500. */
	schedulerPollMs?: number;
}

// ---------------------------------------------------------------------------
// JobQueueService
// ---------------------------------------------------------------------------

export class JobQueueService {
	private binaryCache: string | null | undefined = undefined; // undefined = not yet checked
	private sidecarProcess: ChildProcess | null = null;
	private readonly databaseUrl: string;
	private inspectCache: JobQueueInspectSnapshot | null = null;
	private inspectInterval: ReturnType<typeof setInterval> | null = null;

	constructor() {
		this.databaseUrl = getJobQueueDatabaseUrl();
	}

	// -------------------------------------------------------------------------
	// Binary availability
	// -------------------------------------------------------------------------

	/** Returns true if the job_queue binary can be found and executed. */
	/** Expose the configured database URL so callers can pass it to shell scripts. */
	getDatabaseUrl(): string {
		return this.databaseUrl;
	}

	isAvailable(): boolean {
		if (this.binaryCache === undefined) {
			this.binaryCache = resolveJobQueueBinary();
		}
		return this.binaryCache !== null;
	}

	private getBinary(): string {
		if (this.binaryCache === undefined) {
			this.binaryCache = resolveJobQueueBinary();
		}
		if (this.binaryCache === null) {
			throw new Error(
				"Job queue binary not found. " +
					"Build it with `cargo build` inside overthink_rust/job_queue_layer, " +
					"or set KANBAN_JOB_QUEUE_BINARY to the path.",
			);
		}
		return this.binaryCache;
	}

	// -------------------------------------------------------------------------
	// Low-level CLI execution
	// -------------------------------------------------------------------------

	private exec(args: string[], timeoutMs = 30_000): Promise<string> {
		const bin = this.getBinary();
		const fullArgs = ["--database-url", this.databaseUrl, ...args];

		return new Promise((resolve, reject) => {
			execFile(bin, fullArgs, { timeout: timeoutMs }, (error, stdout, stderr) => {
				if (error) {
					reject(new Error(`job_queue ${args[0] ?? "?"}: ${(stderr || error.message).trim()}`));
					return;
				}
				resolve(stdout);
			});
		});
	}

	// -------------------------------------------------------------------------
	// Sidecar lifecycle
	// -------------------------------------------------------------------------

	/** Returns true when the sidecar `run-all` process is alive. */
	isSidecarRunning(): boolean {
		return this.sidecarProcess !== null && !this.sidecarProcess.killed;
	}

	/**
	 * Start the sidecar `run-all` process (workers + scheduler in one process).
	 * Idempotent — safe to call if already running.
	 */
	async startSidecar(options: JobQueueServiceOptions = {}): Promise<void> {
		if (this.isSidecarRunning()) {
			return;
		}

		const bin = this.getBinary();
		const workers = options.workers ?? 4;
		const pollMs = options.schedulerPollMs ?? 500;

		// Ensure the data directory exists before the binary tries to open the DB.
		await mkdir(getJobQueueDataDir(), { recursive: true });

		this.sidecarProcess = spawn(
			bin,
			[
				"--database-url",
				this.databaseUrl,
				"run-all",
				"--workers",
				String(workers),
				"--poll-ms",
				String(pollMs),
				"--heartbeat-secs",
				"10",
				"--reaper-every-ticks",
				"10",
				"--reaper-batch-size",
				"100",
				"--event-driven-idle",
			],
			{
				stdio: ["ignore", "pipe", "pipe"],
				detached: false,
			},
		);

		// Pipe sidecar stdout/stderr to kanban's own stderr with a prefix so it's
		// easy to filter in logs.
		this.sidecarProcess.stdout?.on("data", (chunk: Buffer) => {
			process.stderr.write(`[job-queue] ${chunk}`);
		});
		this.sidecarProcess.stderr?.on("data", (chunk: Buffer) => {
			process.stderr.write(`[job-queue] ${chunk}`);
		});

		this.sidecarProcess.on("exit", (code, signal) => {
			const reason = signal ? `signal ${signal}` : `code ${code}`;
			if (code !== 0 && code !== null) {
				process.stderr.write(`[job-queue] sidecar exited (${reason})\n`);
			}
			this.sidecarProcess = null;
		});
	}

	/**
	 * Stop the sidecar gracefully (SIGINT → wait 5 s → SIGKILL).
	 * Safe to call even when not running.
	 */
	async stopSidecar(): Promise<void> {
		this.stopInspectPolling();

		const proc = this.sidecarProcess;
		if (!proc) {
			return;
		}

		await new Promise<void>((resolve) => {
			const forceKillTimer = setTimeout(() => {
				try {
					proc.kill("SIGKILL");
				} catch {
					/* ignore */
				}
				resolve();
			}, 5_000);

			proc.on("exit", () => {
				clearTimeout(forceKillTimer);
				resolve();
			});

			try {
				proc.kill("SIGINT");
			} catch {
				clearTimeout(forceKillTimer);
				resolve();
			}
		});

		this.sidecarProcess = null;
	}

	// -------------------------------------------------------------------------
	// Queue mutations
	// -------------------------------------------------------------------------

	/**
	 * Enqueue a job for immediate execution.
	 * Returns the new job ID.
	 */
	async enqueue(options: JobQueueEnqueueOptions): Promise<string> {
		const args = buildEnqueueArgs(options);
		const output = await this.exec(["enqueue", ...args]);
		// Output format: "enqueued job <uuid>"
		const id = output.trim().replace(/^enqueued job\s+/, "");
		if (!id) {
			throw new Error(`Unexpected enqueue output: ${output.trim()}`);
		}
		return id;
	}

	/**
	 * Schedule a job for future execution.
	 * Returns the new scheduled job ID.
	 */
	async schedule(options: JobQueueScheduleOptions): Promise<string> {
		if (!options.dueIn && !options.dueAt) {
			throw new Error("schedule() requires either dueIn or dueAt");
		}
		const args = buildEnqueueArgs(options);
		if (options.dueIn) {
			args.push("--due-in", options.dueIn);
		}
		if (options.dueAt) {
			args.push("--due-at", String(options.dueAt));
		}
		const output = await this.exec(["schedule", ...args]);
		// Output format: "scheduled job <uuid>"
		const id = output.trim().replace(/^scheduled job\s+/, "");
		if (!id) {
			throw new Error(`Unexpected schedule output: ${output.trim()}`);
		}
		return id;
	}

	// -------------------------------------------------------------------------
	// Queue queries
	// -------------------------------------------------------------------------

	/** Fetch a full inspect snapshot as a typed object. */
	async inspect(options?: { queue?: string; windowSecs?: number }): Promise<JobQueueInspectSnapshot> {
		const args = ["inspect", "--json"];
		if (options?.queue) {
			args.push("--queue", options.queue);
		}
		if (options?.windowSecs) {
			args.push("--window-secs", String(options.windowSecs));
		}
		const output = await this.exec(args);
		return JSON.parse(output) as JobQueueInspectSnapshot;
	}

	/** Fetch a health summary. */
	async health(options?: { queue?: string }): Promise<JobQueueHealthReport> {
		const args = ["health", "--json"];
		if (options?.queue) {
			args.push("--queue", options.queue);
		}
		const output = await this.exec(args);
		return JSON.parse(output) as JobQueueHealthReport;
	}

	/** Return the cached inspect snapshot without hitting the CLI. */
	getCachedInspect(): JobQueueInspectSnapshot | null {
		return this.inspectCache;
	}

	// -------------------------------------------------------------------------
	// Inspect polling
	// -------------------------------------------------------------------------

	/**
	 * Start a background polling loop that refreshes the inspect snapshot every
	 * `intervalMs` milliseconds and calls `onChange` whenever the snapshot
	 * content changes.
	 */
	startInspectPolling(intervalMs: number, onChange: (snapshot: JobQueueInspectSnapshot) => void): void {
		if (this.inspectInterval) {
			return;
		}
		this.inspectInterval = setInterval(async () => {
			if (!this.isSidecarRunning()) {
				return;
			}
			try {
				const snapshot = await this.inspect();
				const next = JSON.stringify(snapshot);
				const prev = this.inspectCache ? JSON.stringify(this.inspectCache) : null;
				if (next !== prev) {
					this.inspectCache = snapshot;
					onChange(snapshot);
				}
			} catch {
				// Polling failure is non-fatal — next tick will retry.
			}
		}, intervalMs);
		this.inspectInterval.unref?.();
	}

	/** Stop the background inspect polling loop. */
	stopInspectPolling(): void {
		if (this.inspectInterval) {
			clearInterval(this.inspectInterval);
			this.inspectInterval = null;
		}
	}

	// -------------------------------------------------------------------------
	// Admin operations
	// -------------------------------------------------------------------------

	/** Pause a queue — workers will stop claiming from it. */
	async pauseQueue(queue: string, reason?: string): Promise<void> {
		const args = ["admin", "queue", "pause", "--queue", queue, "--actor", "kanban"];
		if (reason) {
			args.push("--reason", reason);
		}
		await this.exec(args);
	}

	/** Resume a previously paused queue. */
	async resumeQueue(queue: string, reason?: string): Promise<void> {
		const args = ["admin", "queue", "resume", "--queue", queue, "--actor", "kanban"];
		if (reason) {
			args.push("--reason", reason);
		}
		await this.exec(args);
	}

	/**
	 * Delete jobs matching the given criteria.
	 *
	 * Uses `admin jobs delete --status <status> [--queue <queue>] [--limit <n>]`.
	 * Returns the number of jobs deleted.
	 *
	 * Typical use: cancel all scheduled/queued jobs for a trashed task's queue.
	 */
	async deleteJobs(options: {
		queue?: string;
		status?: "scheduled" | "queued" | "failed" | "cancelled";
		limit?: number;
		dryRun?: boolean;
	}): Promise<number> {
		const status = options.status ?? "scheduled";
		const args = ["admin", "jobs", "delete", "--status", status, "--actor", "kanban"];
		if (options.queue) {
			args.push("--queue", options.queue);
		}
		if (options.limit) {
			args.push("--limit", String(options.limit));
		}
		if (options.dryRun) {
			args.push("--dry-run");
		}
		const output = await this.exec(args);
		// Output: "deleted N job(s)"  OR  "dry-run: would delete N job(s)"
		const match = output.match(/(\d+)\s+job/);
		return match ? Number.parseInt(match[1], 10) : 0;
	}

	/**
	 * Replay failed jobs back to `queued` state.
	 * Returns the number of jobs replayed.
	 */
	async replayFailed(options?: { queue?: string; limit?: number; dryRun?: boolean }): Promise<number> {
		const args = ["admin", "jobs", "replay", "--status", "failed", "--actor", "kanban"];
		if (options?.queue) {
			args.push("--queue", options.queue);
		}
		if (options?.limit) {
			args.push("--limit", String(options.limit));
		}
		if (options?.dryRun) {
			args.push("--dry-run");
		}
		const output = await this.exec(args);
		// Output: "replayed N job(s)"  OR  "dry-run: would replay N job(s)"
		const match = output.match(/(\d+)\s+job/);
		return match ? Number.parseInt(match[1], 10) : 0;
	}
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build the shared CLI args common to both `enqueue` and `schedule`. */
function buildEnqueueArgs(options: JobQueueEnqueueOptions): string[] {
	const args: string[] = ["--command", options.command];
	if (options.queue) {
		args.push("--queue", options.queue);
	}
	if (options.priority !== undefined) {
		args.push("--priority", String(options.priority));
	}
	if (options.maxAttempts !== undefined) {
		args.push("--max-attempts", String(options.maxAttempts));
	}
	if (options.cwd) {
		args.push("--cwd", options.cwd);
	}
	if (options.timeoutSecs !== undefined) {
		args.push("--timeout-secs", String(options.timeoutSecs));
	}
	for (const arg of options.args ?? []) {
		args.push("--arg", arg);
	}
	return args;
}
