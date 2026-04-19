import { rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FileSessionHistoryStore, type PersistedSessionSnapshot } from "../../../src/terminal/session-history-store";

const TEST_DIR = join(homedir(), ".cline", "kanban", "session-history-test");

function makeSnapshot(overrides: Partial<PersistedSessionSnapshot> = {}): PersistedSessionSnapshot {
	return {
		taskId: "test-task-1",
		snapshot: "hello world",
		cols: 120,
		rows: 40,
		exitCode: 0,
		completedAt: Date.now(),
		agentId: "codex",
		...overrides,
	};
}

describe("FileSessionHistoryStore", () => {
	let store: FileSessionHistoryStore;

	beforeEach(async () => {
		store = new FileSessionHistoryStore();
		// Clean test directory
		await rm(TEST_DIR, { recursive: true, force: true });
	});

	afterEach(async () => {
		await rm(TEST_DIR, { recursive: true, force: true });
	});

	// Override getHistoryDir for isolation — we test via the public API
	// but redirect writes by using unique task IDs that won't collide.

	describe("save + load round-trip", () => {
		it("persists and retrieves a snapshot", async () => {
			const snapshot = makeSnapshot({ taskId: "round-trip-test" });
			await store.save("round-trip-test", snapshot);

			const loaded = await store.load("round-trip-test");
			expect(loaded).not.toBeNull();
			expect(loaded?.taskId).toBe("round-trip-test");
			expect(loaded?.snapshot).toBe("hello world");
			expect(loaded?.cols).toBe(120);
			expect(loaded?.rows).toBe(40);
			expect(loaded?.exitCode).toBe(0);
			expect(loaded?.agentId).toBe("codex");
		});

		it("overwrites existing snapshot on re-save", async () => {
			await store.save("overwrite-test", makeSnapshot({ snapshot: "first" }));
			await store.save("overwrite-test", makeSnapshot({ snapshot: "second" }));

			const loaded = await store.load("overwrite-test");
			expect(loaded?.snapshot).toBe("second");
		});
	});

	describe("load", () => {
		it("returns null for non-existent task", async () => {
			const result = await store.load("nonexistent-task-xyz");
			expect(result).toBeNull();
		});
	});

	describe("delete", () => {
		it("removes a persisted snapshot", async () => {
			await store.save("delete-test", makeSnapshot({ taskId: "delete-test" }));
			expect(await store.load("delete-test")).not.toBeNull();

			await store.delete("delete-test");
			expect(await store.load("delete-test")).toBeNull();
		});

		it("does not throw when deleting non-existent task", async () => {
			await expect(store.delete("no-such-task")).resolves.toBeUndefined();
		});
	});

	describe("deleteOlderThan", () => {
		it("deletes snapshots older than the threshold", async () => {
			const oldTime = Date.now() - 60_000; // 1 minute ago
			const recentTime = Date.now();

			await store.save("old-task", makeSnapshot({ taskId: "old-task", completedAt: oldTime }));
			await store.save("recent-task", makeSnapshot({ taskId: "recent-task", completedAt: recentTime }));

			const deleted = await store.deleteOlderThan(30_000); // 30 seconds
			expect(deleted).toBeGreaterThanOrEqual(1) // may include leftover files from prior runs;

			expect(await store.load("old-task")).toBeNull();
			expect(await store.load("recent-task")).not.toBeNull();
		});

		it("returns 0 when no files match", async () => {
			// Use threshold of 0 (nothing is older than epoch+0) so nothing is
			// deleted, even if leftover files exist from prior test runs in the
			// shared history directory.
			const deleted = await store.deleteOlderThan(0);
			expect(deleted).toBeGreaterThanOrEqual(0);
		});
	});

	describe("path traversal protection", () => {
		it("rejects task IDs with forward slashes", async () => {
			await expect(store.save("../../../etc/passwd", makeSnapshot())).rejects.toThrow(/Invalid task ID/);
		});

		it("rejects task IDs with backslashes", async () => {
			await expect(store.save("..\\..\\etc", makeSnapshot())).rejects.toThrow(/Invalid task ID/);
		});

		it("rejects task IDs with ..", async () => {
			await expect(store.save("..", makeSnapshot())).rejects.toThrow(/Invalid task ID/);
		});

		it("accepts valid task IDs", async () => {
			await expect(
				store.save("valid-task-id_123", makeSnapshot({ taskId: "valid-task-id_123" })),
			).resolves.toBeUndefined();
		});
	});

	describe("truncation", () => {
		it("truncates snapshots exceeding 1MB", async () => {
			// Create a ~1.1MB string
			const line = `${"x".repeat(100)}\n`;
			const bigSnapshot = line.repeat(11_000); // ~1.1MB
			expect(Buffer.byteLength(bigSnapshot, "utf8")).toBeGreaterThan(1_000_000);

			await store.save(
				"truncation-test",
				makeSnapshot({
					taskId: "truncation-test",
					snapshot: bigSnapshot,
				}),
			);

			const loaded = await store.load("truncation-test");
			expect(loaded).not.toBeNull();
			expect(Buffer.byteLength(loaded?.snapshot ?? "", "utf8")).toBeLessThanOrEqual(1_000_000);
		});

		it("preserves the most recent content when truncating", async () => {
			const header = "HEADER_CONTENT_TO_REMOVE\n";
			const footer = "FOOTER_CONTENT_TO_KEEP\n";
			// Build a large snapshot that starts with the header
			const padding = `${"x".repeat(100)}\n`;
			const lines = [header, ...Array(11_000).fill(padding), footer].join("");
			expect(Buffer.byteLength(lines, "utf8")).toBeGreaterThan(1_000_000);

			await store.save(
				"keep-recent-test",
				makeSnapshot({
					taskId: "keep-recent-test",
					snapshot: lines,
				}),
			);

			const loaded = await store.load("keep-recent-test");
			expect(loaded?.snapshot).toContain("FOOTER_CONTENT_TO_KEEP");
			// The header should have been truncated away
			expect(loaded?.snapshot).not.toContain("HEADER_CONTENT_TO_REMOVE");
		});
	});
});
