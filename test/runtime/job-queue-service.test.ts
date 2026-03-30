/**
 * job-queue-service.test.ts
 *
 * Unit tests for JobQueueService — all child_process interaction is mocked so
 * the Rust binary does not need to be installed to run this suite.
 *
 * Cross-cutting concern: "Add JobQueueService unit tests with mocked CLI output"
 * (JOB_QUEUE_INTEGRATION_PLAN.md)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---- hoist mock fns so they are available inside vi.mock factories ---------
// vi.mock() calls are hoisted to the top of the file; using vi.hoisted()
// ensures the variables are initialised before those factories execute.

const { mockExecFile, mockSpawn, mockAccessSync } = vi.hoisted(() => ({
	mockExecFile: vi.fn(),
	mockSpawn: vi.fn(),
	mockAccessSync: vi.fn(),
}));

vi.mock("node:child_process", () => ({
	execFile: mockExecFile,
	spawn: mockSpawn,
}));

vi.mock("node:fs/promises", () => ({
	mkdir: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("node:fs", () => ({
	accessSync: mockAccessSync,
	constants: { X_OK: 1 },
}));

// ---- import SUT after mocks are installed ----------------------------------

import { JobQueueService } from "../../src/server/job-queue-service";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Make mockExecFile resolve with the given stdout string on the next call.
 */
function mockExecSuccess(stdout: string): void {
	mockExecFile.mockImplementationOnce(
		(_bin: string, _args: string[], _opts: unknown, cb: (err: null, stdout: string, stderr: string) => void) => {
			cb(null, stdout, "");
		},
	);
}

/**
 * Make mockExecFile fail with the given error on the next call.
 */
function mockExecFailure(message: string): void {
	mockExecFile.mockImplementationOnce(
		(_bin: string, _args: string[], _opts: unknown, cb: (err: Error, stdout: string, stderr: string) => void) => {
			cb(new Error(message), "", message);
		},
	);
}

/**
 * Create a service instance whose binary is forced to a known path via env.
 */
function createService(): JobQueueService {
	process.env.KANBAN_JOB_QUEUE_BINARY = "/usr/local/bin/job_queue";
	return new JobQueueService();
}

// ---------------------------------------------------------------------------

describe("JobQueueService", () => {
	beforeEach(() => {
		// vi.resetAllMocks() also resets mock implementations (not just call history),
		// which is needed because some tests permanently override mockAccessSync and
		// the next test must start with a fresh, non-throwing mock.
		vi.resetAllMocks();
		process.env.KANBAN_JOB_QUEUE_BINARY = "/usr/local/bin/job_queue";
	});

	afterEach(() => {
		delete process.env.KANBAN_JOB_QUEUE_BINARY;
	});

	// -----------------------------------------------------------------------
	// isAvailable()
	// -----------------------------------------------------------------------

	describe("isAvailable()", () => {
		it("returns true when KANBAN_JOB_QUEUE_BINARY env var is set", () => {
			const svc = createService();
			expect(svc.isAvailable()).toBe(true);
		});

		it("returns false when no binary can be found", () => {
			delete process.env.KANBAN_JOB_QUEUE_BINARY;
			// accessSync throws → dev build path not available
			mockAccessSync.mockImplementation(() => {
				throw new Error("ENOENT");
			});

			const svc = new JobQueueService();
			// which lookups also fail because execFile/execSync is mocked
			expect(svc.isAvailable()).toBe(false);
		});
	});

	// -----------------------------------------------------------------------
	// enqueue()
	// -----------------------------------------------------------------------

	describe("enqueue()", () => {
		it("calls execFile with --database-url and enqueue args, returns job ID", async () => {
			const svc = createService();
			mockExecSuccess("enqueued job abc-123\n");

			const jobId = await svc.enqueue({
				queue: "kanban.tasks",
				command: "/bin/sh",
				args: ["start.sh", "task-1"],
				maxAttempts: 3,
				timeoutSecs: 600,
			});

			expect(jobId).toBe("abc-123");

			const [bin, args] = mockExecFile.mock.calls[0] as [string, string[]];
			expect(bin).toBe("/usr/local/bin/job_queue");
			expect(args).toContain("--database-url");
			expect(args).toContain("enqueue");
			expect(args).toContain("--command");
			expect(args).toContain("/bin/sh");
			expect(args).toContain("--queue");
			expect(args).toContain("kanban.tasks");
			expect(args).toContain("--max-attempts");
			expect(args).toContain("3");
			expect(args).toContain("--timeout-secs");
			expect(args).toContain("600");
			// args passed with --arg
			expect(args).toContain("--arg");
			expect(args).toContain("start.sh");
			expect(args).toContain("task-1");
		});

		it("throws when execFile reports an error", async () => {
			const svc = createService();
			mockExecFailure("connection refused");

			await expect(svc.enqueue({ command: "echo" })).rejects.toThrow("connection refused");
		});

		it("omits optional args when not provided", async () => {
			const svc = createService();
			mockExecSuccess("enqueued job xyz\n");

			await svc.enqueue({ command: "/bin/echo" });

			const [, args] = mockExecFile.mock.calls[0] as [string, string[]];
			expect(args).not.toContain("--queue");
			expect(args).not.toContain("--priority");
			expect(args).not.toContain("--cwd");
			expect(args).not.toContain("--timeout-secs");
		});
	});

	// -----------------------------------------------------------------------
	// schedule()
	// -----------------------------------------------------------------------

	describe("schedule()", () => {
		it("passes --due-in when dueIn is given", async () => {
			const svc = createService();
			mockExecSuccess("scheduled job sched-1\n");

			const jobId = await svc.schedule({
				queue: "kanban.maintenance",
				command: "/bin/sh",
				dueIn: "5m",
			});

			expect(jobId).toBe("sched-1");

			const [, args] = mockExecFile.mock.calls[0] as [string, string[]];
			expect(args).toContain("schedule");
			expect(args).toContain("--due-in");
			expect(args).toContain("5m");
		});

		it("passes --due-at when dueAt is given", async () => {
			const svc = createService();
			mockExecSuccess("scheduled job sched-2\n");

			const ts = 1_700_000_000;
			await svc.schedule({ command: "/bin/echo", dueAt: ts });

			const [, args] = mockExecFile.mock.calls[0] as [string, string[]];
			expect(args).toContain("--due-at");
			expect(args).toContain(String(ts));
		});
	});

	// -----------------------------------------------------------------------
	// inspect()
	// -----------------------------------------------------------------------

	describe("inspect()", () => {
		it("returns parsed JSON snapshot", async () => {
			const svc = createService();

			const snapshot = {
				schema_version: 1,
				generated_at: 1_700_000_000,
				jobs: { status_counts: { queued: 2, running: 1 }, queue_status_counts: {} },
				scheduled: { status_counts: { pending: 3 }, queue_status_counts: {} },
				diagnostics: {},
				performance: {},
				worker_activity: { active_workers_recent: 2, stale_workers: 0, workers: {} },
				alerts: [],
			};

			mockExecSuccess(JSON.stringify(snapshot));

			const result = await svc.inspect();
			expect(result.jobs.status_counts.queued).toBe(2);
			expect(result.scheduled.status_counts.pending).toBe(3);
			expect(result.alerts).toHaveLength(0);

			const [, args] = mockExecFile.mock.calls[0] as [string, string[]];
			expect(args).toContain("inspect");
			expect(args).toContain("--json");
		});

		it("passes --queue filter when specified", async () => {
			const svc = createService();
			mockExecSuccess(
				JSON.stringify({
					schema_version: 1,
					generated_at: 0,
					jobs: { status_counts: {}, queue_status_counts: {} },
					scheduled: { status_counts: {}, queue_status_counts: {} },
					diagnostics: {},
					performance: {},
					worker_activity: { active_workers_recent: 0, stale_workers: 0, workers: {} },
					alerts: [],
				}),
			);

			await svc.inspect({ queue: "kanban.maintenance" });

			const [, args] = mockExecFile.mock.calls[0] as [string, string[]];
			expect(args).toContain("--queue");
			expect(args).toContain("kanban.maintenance");
		});
	});

	// -----------------------------------------------------------------------
	// health()
	// -----------------------------------------------------------------------

	describe("health()", () => {
		it("returns parsed health report", async () => {
			const svc = createService();

			const report = {
				generated_at: 1_700_000_000,
				status: "ok",
				reasons: [],
				summary: { queued: 0, running: 2, scheduled_pending: 5 },
			};

			mockExecSuccess(JSON.stringify(report));

			const result = await svc.health();
			expect(result.status).toBe("ok");
			expect(result.summary.running).toBe(2);
			expect(result.summary.scheduled_pending).toBe(5);

			const [, args] = mockExecFile.mock.calls[0] as [string, string[]];
			expect(args).toContain("health");
			expect(args).toContain("--json");
		});

		it("returns degraded status with reasons", async () => {
			const svc = createService();

			mockExecSuccess(
				JSON.stringify({
					generated_at: 0,
					status: "degraded",
					reasons: ["stale workers detected"],
					summary: { queued: 100, running: 0, scheduled_pending: 0 },
				}),
			);

			const result = await svc.health();
			expect(result.status).toBe("degraded");
			expect(result.reasons).toContain("stale workers detected");
		});
	});

	// -----------------------------------------------------------------------
	// pauseQueue() / resumeQueue()
	// -----------------------------------------------------------------------

	describe("pauseQueue()", () => {
		it("calls admin queue pause with queue, actor, reason", async () => {
			const svc = createService();
			mockExecSuccess("queue paused\n");

			await svc.pauseQueue("kanban.tasks", "maintenance window");

			const [, args] = mockExecFile.mock.calls[0] as [string, string[]];
			expect(args).toContain("admin");
			expect(args).toContain("queue");
			expect(args).toContain("pause");
			expect(args).toContain("--queue");
			expect(args).toContain("kanban.tasks");
			expect(args).toContain("--actor");
			expect(args).toContain("kanban");
			expect(args).toContain("--reason");
			expect(args).toContain("maintenance window");
		});
	});

	describe("resumeQueue()", () => {
		it("calls admin queue resume", async () => {
			const svc = createService();
			mockExecSuccess("queue resumed\n");

			await svc.resumeQueue("kanban.tasks", "maintenance done");

			const [, args] = mockExecFile.mock.calls[0] as [string, string[]];
			expect(args).toContain("resume");
			expect(args).toContain("kanban.tasks");
		});
	});

	// -----------------------------------------------------------------------
	// replayFailed()
	// -----------------------------------------------------------------------

	describe("replayFailed()", () => {
		it("parses 'replayed N' from stdout and returns N", async () => {
			const svc = createService();
			mockExecSuccess("replayed 7 jobs\n");

			const count = await svc.replayFailed();
			expect(count).toBe(7);

			const [, args] = mockExecFile.mock.calls[0] as [string, string[]];
			expect(args).toContain("admin");
			expect(args).toContain("jobs");
			expect(args).toContain("replay");
			expect(args).toContain("--status");
			expect(args).toContain("failed");
		});

		it("passes --queue and --limit when provided", async () => {
			const svc = createService();
			mockExecSuccess("replayed 3 jobs\n");

			const count = await svc.replayFailed({ queue: "kanban.batch.abc", limit: 10 });
			expect(count).toBe(3);

			const [, args] = mockExecFile.mock.calls[0] as [string, string[]];
			expect(args).toContain("--queue");
			expect(args).toContain("kanban.batch.abc");
			expect(args).toContain("--limit");
			expect(args).toContain("10");
		});

		it("returns 0 when output does not match 'replayed N' pattern", async () => {
			const svc = createService();
			mockExecSuccess("no failed jobs found\n");

			const count = await svc.replayFailed();
			expect(count).toBe(0);
		});
	});

	// -----------------------------------------------------------------------
	// isSidecarRunning()
	// -----------------------------------------------------------------------

	describe("isSidecarRunning()", () => {
		it("returns false before startSidecar() is called", () => {
			const svc = createService();
			expect(svc.isSidecarRunning()).toBe(false);
		});

		it("returns true after startSidecar() spawns successfully", async () => {
			const svc = createService();

			const fakeProcess = {
				on: vi.fn().mockReturnThis(),
				kill: vi.fn(),
				killed: false,
				pid: 1234,
				stdin: null,
				stdout: null,
				stderr: null,
			};

			mockSpawn.mockReturnValueOnce(fakeProcess);

			await svc.startSidecar({ workers: 2 });

			expect(svc.isSidecarRunning()).toBe(true);

			const [bin, args] = mockSpawn.mock.calls[0] as [string, string[]];
			expect(bin).toBe("/usr/local/bin/job_queue");
			expect(args).toContain("run-all");
			expect(args).toContain("--workers");
			expect(args).toContain("2");
		});

		it("returns false after stopSidecar() is called", async () => {
			const svc = createService();

			let exitCallback: ((code: number) => void) | null = null;
			const fakeProcess = {
				on: vi.fn().mockImplementation((event: string, cb: (code: number) => void) => {
					if (event === "exit") {
						exitCallback = cb;
					}
					return fakeProcess;
				}),
				kill: vi.fn().mockImplementation(() => {
					// Simulate process exiting when killed
					setTimeout(() => exitCallback?.(0), 0);
				}),
				killed: false,
			};

			mockSpawn.mockReturnValueOnce(fakeProcess);

			await svc.startSidecar();
			expect(svc.isSidecarRunning()).toBe(true);

			await svc.stopSidecar();
			expect(svc.isSidecarRunning()).toBe(false);
		});
	});
});
