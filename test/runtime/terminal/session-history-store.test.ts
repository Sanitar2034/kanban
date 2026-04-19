import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FileSessionHistoryStore, type PersistedSessionSnapshot } from "../../../src/terminal/session-history-store";

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

	beforeEach(() => {
		store = new FileSessionHistoryStore();
	});

	afterEach(async () => {
		// Clean up any files created by tests
		const testIds = [
			"round-trip-test",
			"overwrite-test",
			"delete-test",
			"old-task",
			"recent-task",
			"valid-task-id_123",
			"truncation-test",
			"keep-recent-test",
		];
		for (const id of testIds) {
			await store.delete(id);
		}
	});

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
			expect(deleted).toBeGreaterThanOrEqual(1);

			expect(await store.load("old-task")).toBeNull();
			expect(await store.load("recent-task")).not.toBeNull();
		});

		it("returns 0 when no files match", async () => {
			const deleted = await store.deleteOlderThan(1);
			expect(deleted).toBe(0);
		});
	});

	describe("path traversal protection", () => {
		it("rejects task IDs with forward slashes", () => {
			expect(() => store.save("../../../etc/passwd", makeSnapshot())).toThrow(/Invalid task ID/);
		});

		it("rejects task IDs with backslashes", () => {
			expect(() => store.save("..\\..\\etc", makeSnapshot())).toThrow(/Invalid task ID/);
		});

		it("rejects task IDs with ..", () => {
			expect(() => store.save("..", makeSnapshot())).toThrow(/Invalid task ID/);
		});

		it("accepts valid task IDs", async () => {
			await expect(
				store.save("valid-task-id_123", makeSnapshot({ taskId: "valid-task-id_123" })),
			).resolves.toBeUndefined();
		});
	});

	describe("truncation", () => {
		it("truncates snapshots exceeding 1MB", async () => {
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
			expect(loaded?.snapshot).not.toContain("HEADER_CONTENT_TO_REMOVE");
		});
	});
});
