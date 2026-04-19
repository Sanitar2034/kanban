import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PersistedSessionSnapshot } from "../../../src/terminal/session-history-store";

const prepareAgentLaunchMock = vi.hoisted(() => vi.fn());
const ptySessionSpawnMock = vi.hoisted(() => vi.fn());

vi.mock("../../../src/terminal/agent-session-adapters.js", () => ({
	prepareAgentLaunch: prepareAgentLaunchMock,
}));

vi.mock("../../../src/terminal/pty-session.js", () => ({
	PtySession: {
		spawn: ptySessionSpawnMock,
	},
}));

import { TerminalSessionManager } from "../../../src/terminal/session-manager";

interface MockSpawnRequest {
	onData?: (chunk: Buffer) => void;
	onExit?: (event: { exitCode: number | null; signal?: number }) => void;
}

function createMockPtySession(pid: number, request: MockSpawnRequest) {
	return {
		pid,
		write: vi.fn(),
		resize: vi.fn(),
		pause: vi.fn(),
		resume: vi.fn(),
		stop: vi.fn(),
		wasInterrupted: vi.fn(() => false),
		triggerExit: (exitCode: number | null) => {
			request.onExit?.({ exitCode });
		},
	};
}

describe("TerminalSessionManager history persistence", () => {
	beforeEach(() => {
		prepareAgentLaunchMock.mockReset();
		ptySessionSpawnMock.mockReset();
		prepareAgentLaunchMock.mockImplementation(async (input: { args: string[]; binary?: string }) => ({
			binary: input.binary,
			args: [...input.args],
			env: {},
		}));
	});

	it("setHistoryStore is idempotent — second call is ignored", () => {
		const manager = new TerminalSessionManager();
		const store1 = {
			save: vi.fn(),
			load: vi.fn(() => Promise.resolve(null)),
			delete: vi.fn(),
			deleteOlderThan: vi.fn(() => Promise.resolve(0)),
		};
		const store2 = {
			save: vi.fn(),
			load: vi.fn(() => Promise.resolve(null)),
			delete: vi.fn(),
			deleteOlderThan: vi.fn(() => Promise.resolve(0)),
		};

		manager.setHistoryStore(store1);
		manager.setHistoryStore(store2);

		const internal = manager as unknown as { historyStore: unknown };
		expect(internal.historyStore).toBe(store1);
	});

	it("saves terminal snapshot to history store on PTY exit", async () => {
		const saved: PersistedSessionSnapshot[] = [];
		const historyStore = {
			save: vi.fn((_taskId: string, snapshot: PersistedSessionSnapshot) => {
				saved.push(snapshot);
				return Promise.resolve();
			}),
			load: vi.fn(() => Promise.resolve(null)),
			delete: vi.fn(),
			deleteOlderThan: vi.fn(() => Promise.resolve(0)),
		};

		const spawnedSessions: Array<ReturnType<typeof createMockPtySession>> = [];
		ptySessionSpawnMock.mockImplementation((request: MockSpawnRequest) => {
			const session = createMockPtySession(111, request);
			spawnedSessions.push(session);
			return session;
		});

		const manager = new TerminalSessionManager();
		manager.setHistoryStore(historyStore);

		// No listener with onOutput → shouldAutoRestart returns false (no listeners)
		// But we need to attach a listener without onOutput so auto-restart check
		// sees listeners.size > 0 but still returns false for non-task restart.
		// Actually, stopTaskSession suppresses auto-restart. Let's use that.

		await manager.startTaskSession({
			taskId: "task-history-1",
			agentId: "claude",
			binary: "claude",
			args: [],
			cwd: "/tmp/task-1",
			prompt: "Fix the bug",
		});

		expect(spawnedSessions[0]).toBeDefined();

		// Stop the session to suppress auto-restart
		manager.stopTaskSession("task-history-1");
		spawnedSessions[0]?.triggerExit(0);

		// Wait for async snapshot save
		await vi.waitFor(() => {
			expect(historyStore.save).toHaveBeenCalledTimes(1);
		});

		expect(saved[0]).toMatchObject({
			taskId: "task-history-1",
			snapshot: expect.any(String),
			cols: expect.any(Number),
			rows: expect.any(Number),
			exitCode: 0,
			agentId: "claude",
		});
		expect(saved[0]?.completedAt).toEqual(expect.any(Number));
	});

	it("does NOT save snapshot when shouldAutoRestart is true", async () => {
		const historyStore = {
			save: vi.fn(() => Promise.resolve()),
			load: vi.fn(() => Promise.resolve(null)),
			delete: vi.fn(),
			deleteOlderThan: vi.fn(() => Promise.resolve(0)),
		};

		const spawnedSessions: Array<ReturnType<typeof createMockPtySession>> = [];
		ptySessionSpawnMock.mockImplementation((request: MockSpawnRequest) => {
			const session = createMockPtySession(111, request);
			spawnedSessions.push(session);
			return session;
		});

		const manager = new TerminalSessionManager();
		manager.setHistoryStore(historyStore);

		// Attach a listener with onOutput so the session is eligible for auto-restart
		manager.attach("task-auto", {
			onState: vi.fn(),
			onOutput: vi.fn(),
			onExit: vi.fn(),
		});

		await manager.startTaskSession({
			taskId: "task-auto",
			agentId: "codex",
			binary: "codex",
			args: [],
			cwd: "/tmp/task-auto",
			prompt: "Fix the bug",
		});

		expect(spawnedSessions[0]).toBeDefined();

		// Trigger exit without stopping — should auto-restart
		spawnedSessions[0]?.triggerExit(130);

		// Wait for auto-restart to happen
		await vi.waitFor(() => {
			expect(ptySessionSpawnMock).toHaveBeenCalledTimes(2);
		});

		// History store should NOT have been called
		expect(historyStore.save).not.toHaveBeenCalled();
	});

	it("does NOT attempt save when historyStore is not set", async () => {
		const spawnedSessions: Array<ReturnType<typeof createMockPtySession>> = [];
		ptySessionSpawnMock.mockImplementation((request: MockSpawnRequest) => {
			const session = createMockPtySession(111, request);
			spawnedSessions.push(session);
			return session;
		});

		const manager = new TerminalSessionManager();
		// Intentionally NOT calling setHistoryStore

		await manager.startTaskSession({
			taskId: "task-no-store",
			agentId: "claude",
			binary: "claude",
			args: [],
			cwd: "/tmp/task-no-store",
			prompt: "Fix the bug",
		});

		expect(spawnedSessions[0]).toBeDefined();
		manager.stopTaskSession("task-no-store");
		spawnedSessions[0]?.triggerExit(0);

		// Give async handlers time to run
		await new Promise((resolve) => setTimeout(resolve, 50));

		// No crash, no errors — just silently skipped
		expect(manager.getSummary("task-no-store")?.exitCode).toBe(0);
	});
});
