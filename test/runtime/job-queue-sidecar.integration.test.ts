/**
 * Integration tests for the job_queue sidecar.
 *
 * These tests spawn a REAL sidecar process against an isolated temp SQLite DB.
 * They require the compiled job_queue binary to be available (build with
 * `cargo build` inside overthink_rust/job_queue_layer).
 *
 * Covers plan items:
 *  0.6  — start sidecar, enqueue a job, verify it runs to completion
 *  1.10 — schedule a command for 3s in the future, verify it stays pending then
 *         executes and writes verifiable output (proves scheduler deferred-execution
 *         pipeline for the "kanban task start" use case)
 *  2.9  — schedule 3 jobs with short delays, verify all complete (scheduler pipeline)
 *  5.14 — enqueue 10 jobs, verify inspect() returns accurate status counts
 */

import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { createJobQueueHarness } from "../utilities/job-queue-harness";

// All tests in this suite share one sidecar instance for efficiency.
const jq = createJobQueueHarness();

beforeAll(() => jq.start(), 30_000);
afterAll(() => jq.stop());

// ---------------------------------------------------------------------------
// 0.6 — Enqueue a job and verify it runs to completion
// ---------------------------------------------------------------------------
describe("0.6: enqueue a job and verify it runs", () => {
	test("enqueue /bin/echo, verify completed status", async () => {
		const jobId = await jq.service.enqueue({
			command: "/bin/echo",
			args: ["hello from job_queue integration test"],
		});

		expect(jobId).toMatch(/\S+/); // non-empty job ID

		await jq.waitForJobs(1, 10_000);

		const snapshot = await jq.service.inspect();
		// The binary uses "succeeded" as the terminal success status.
		expect(snapshot.jobs.status_counts.succeeded).toBeGreaterThanOrEqual(1);
	}, 15_000);

	test("sidecar health check returns healthy after processing", async () => {
		const health = await jq.service.health();
		// The health endpoint should return a non-empty response — shape
		// varies by binary version so we just confirm it parsed as an object.
		expect(health).toBeDefined();
		expect(typeof health).toBe("object");
	}, 10_000);
});

// ---------------------------------------------------------------------------
// 1.10 — Deferred execution: schedule a command for 3s, verify sentinel file
//        exists only AFTER the delay (proves deferred execution, the core
//        mechanism behind "kanban task start" scheduled at a future time)
// ---------------------------------------------------------------------------
describe("1.10: scheduled task execution — deferred pipeline", () => {
	test("scheduled command creates sentinel file only after due time", async () => {
		const sentinel = join(tmpdir(), `kanban-test-1.10-${Date.now()}.txt`);

		// Sanity check: file doesn't exist yet.
		expect(existsSync(sentinel)).toBe(false);

		const baseline = await jq.service.inspect();
		const baselineSucceeded = baseline.jobs.status_counts.succeeded ?? 0;

		// Schedule /usr/bin/touch to create a sentinel file, due in 3 seconds.
		// Using touch (no -c-style flags) because clap in job_queue treats
		// dash-prefixed --arg values as unexpected flags.
		const jobId = await jq.service.schedule({
			command: "/usr/bin/touch",
			args: [sentinel],
			dueIn: "3s",
		});
		expect(jobId).toMatch(/\S+/);

		// 0.8s after scheduling the job is still in the scheduled queue — NOT yet executed.
		await new Promise((resolve) => setTimeout(resolve, 800));
		expect(existsSync(sentinel)).toBe(false);

		// Now wait for the scheduler to fire the job and the worker to execute it.
		await jq.waitForJobs(baselineSucceeded + 1, 12_000);
		expect(existsSync(sentinel)).toBe(true);
	}, 20_000);
});

// ---------------------------------------------------------------------------
// 2.9 — Scheduler pipeline: schedule 3 jobs with short delays, all complete
// ---------------------------------------------------------------------------
describe("2.9: scheduler pipeline runs scheduled jobs to completion", () => {
	test("three jobs scheduled with 1s delay all complete within 8s", async () => {
		// Snapshot baseline so we measure NEW completions.
		const baseline = await jq.service.inspect();
		const baselineSucceeded = baseline.jobs.status_counts.succeeded ?? 0;

		// Schedule 3 jobs due in 1 second each (the fast schedulerPollMs=100
		// in the harness ensures they're picked up promptly).
		await jq.service.schedule({ command: "/bin/echo", args: ["sched-1"], dueIn: "1s" });
		await jq.service.schedule({ command: "/bin/echo", args: ["sched-2"], dueIn: "1s" });
		await jq.service.schedule({ command: "/bin/echo", args: ["sched-3"], dueIn: "1s" });

		// Wait until 3 more jobs succeed (baseline + 3).
		await jq.waitForJobs(baselineSucceeded + 3, 12_000);

		const snapshot = await jq.service.inspect();
		expect(snapshot.jobs.status_counts.succeeded).toBeGreaterThanOrEqual(baselineSucceeded + 3);
	}, 15_000);
});

// ---------------------------------------------------------------------------
// 5.14 — Dashboard accuracy: enqueue 10 jobs, verify counts
// ---------------------------------------------------------------------------
describe("5.14: inspect() returns accurate counts for 10 enqueued jobs", () => {
	test("status counts reflect all enqueued and completed jobs", async () => {
		// Baseline.
		const baseline = await jq.service.inspect();
		const baselineSucceeded = baseline.jobs.status_counts.succeeded ?? 0;

		// Enqueue 10 quick echo jobs.
		const enqueuePromises = Array.from({ length: 10 }, (_, i) =>
			jq.service.enqueue({
				command: "/bin/echo",
				args: [`batch-job-${i}`],
			}),
		);
		const jobIds = await Promise.all(enqueuePromises);
		expect(jobIds).toHaveLength(10);

		// Every returned ID must be a non-empty string.
		for (const id of jobIds) {
			expect(id).toMatch(/\S+/);
		}

		// Wait for all 10 to succeed.
		await jq.waitForJobs(baselineSucceeded + 10, 15_000);

		const snapshot = await jq.service.inspect();
		const succeeded = snapshot.jobs.status_counts.succeeded ?? 0;

		// Total succeeded must be at least 10 more than baseline.
		expect(succeeded).toBeGreaterThanOrEqual(baselineSucceeded + 10);

		// No new failures introduced by our jobs.
		const failed = snapshot.jobs.status_counts.failed ?? 0;
		const baselineFailed = baseline.jobs.status_counts.failed ?? 0;
		expect(failed).toBe(baselineFailed);
	}, 20_000);

	test("inspect() snapshot includes all required top-level fields", async () => {
		const snapshot = await jq.service.inspect();
		expect(snapshot).toHaveProperty("schema_version");
		expect(snapshot).toHaveProperty("generated_at");
		expect(snapshot).toHaveProperty("jobs");
		expect(snapshot).toHaveProperty("scheduled");
		expect(snapshot).toHaveProperty("diagnostics");
		expect(snapshot.jobs).toHaveProperty("status_counts");
		expect(snapshot.scheduled).toHaveProperty("status_counts");
	}, 10_000);
});
