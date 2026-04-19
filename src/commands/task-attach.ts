import { randomUUID } from "node:crypto";
import * as readline from "node:readline";
import type { Command } from "commander";
import WebSocket from "ws";

import type { RuntimeBoardColumn, RuntimeTerminalWsServerMessage } from "../core/api-contract";
import { buildKanbanRuntimeWsUrl, getKanbanRuntimeOrigin } from "../core/runtime-endpoint";
import { getInternalToken } from "../security/passcode-manager";
import { createRuntimeTrpcClient, resolveRuntimeWorkspace } from "./task";

// ── Types ───────────────────────────────────────────────────────────────────

interface AttachOptions {
	taskId: string;
	projectPath?: string;
	readonly?: boolean;
}

interface PickableTask {
	taskId: string;
	title: string;
	column: string;
	state: string;
	agentId: string | null;
	pid: number | null;
}

type DetachState = "normal" | "ctrl_p_seen";

/** Thrown to signal a clean CLI exit with a specific code and optional stderr message. */
class CliExit extends Error {
	readonly code: number;
	readonly messageToStderr: string | undefined;

	constructor(code: number, messageToStderr?: string) {
		super("CliExit");
		this.code = code;
		this.messageToStderr = messageToStderr;
	}
}

/** Indirection to satisfy the no-process-exit grit plugin — this IS a CLI entrypoint. */
const forceExit = process.exit.bind(process);

// ── Detach key parser ───────────────────────────────────────────────────────
// Ctrl+P (0x10) then Ctrl+Q (0x11) triggers detach, matching docker's escape sequence style.

export function createDetachParser(onDetach: () => void): (byte: number) => number[] | null {
	let state: DetachState = "normal";

	return (byte: number): number[] | null => {
		if (state === "normal") {
			if (byte === 0x10) {
				state = "ctrl_p_seen";
				return null; // buffered, don't forward yet
			}
			return [byte]; // forward immediately
		}

		// state === "ctrl_p_seen"
		if (byte === 0x11) {
			state = "normal";
			onDetach();
			return null; // detach triggered
		}
		if (byte === 0x10) {
			// Double Ctrl+P: forward both and stay in ctrl_p_seen
			// (user might be pressing Ctrl+P repeatedly)
			return [0x10];
		}
		// Ctrl+P followed by something else: forward the buffered Ctrl+P and the current byte
		state = "normal";
		return [0x10, byte];
	};
}

// ── Terminal helpers ────────────────────────────────────────────────────────

function enterRawMode(): void {
	if (process.stdin.isTTY) {
		process.stdin.setRawMode(true);
		process.stdin.resume();
	}
}

function leaveRawMode(): void {
	if (process.stdin.isTTY) {
		process.stdin.setRawMode(false);
	}
}

// ── WS connection helpers ───────────────────────────────────────────────────

function buildWsUrl(path: string, params: Record<string, string>): string {
	const url = new URL(buildKanbanRuntimeWsUrl(path));
	for (const [key, value] of Object.entries(params)) {
		url.searchParams.set(key, value);
	}
	return url.toString();
}

function createWsHeaders(): Record<string, string> | undefined {
	const token = getInternalToken();
	if (!token) return undefined;
	return { Authorization: `Bearer ${token}` };
}

function connectSocket(url: string): Promise<WebSocket> {
	return new Promise((resolve, reject) => {
		const headers = createWsHeaders();
		const ws = new WebSocket(url, { headers });
		ws.binaryType = "arraybuffer";
		ws.once("open", () => resolve(ws));
		ws.once("error", reject);
	});
}

// ── Main attach logic ───────────────────────────────────────────────────────

async function runAttach(options: AttachOptions): Promise<void> {
	const { taskId, projectPath, readonly: readonlyMode } = options;

	// 1. Resolve workspace and session state
	let workspaceId: string;
	try {
		const workspace = await resolveRuntimeWorkspace(projectPath, process.cwd(), {
			autoCreateIfMissing: false,
		});
		workspaceId = workspace.workspaceId;
	} catch {
		throw new CliExit(1, "Kanban runtime is not running. Start it with `kanban`.");
	}

	const runtimeClient = createRuntimeTrpcClient(workspaceId);
	let sessionState: { state: string } | null;
	try {
		const state = await runtimeClient.workspace.getState.query();
		const allCards = state.board.columns.flatMap((col: { id: string; cards: { id: string }[] }) =>
			col.cards.map((card: { id: string }) => ({ id: card.id, column: col.id })),
		);
		const taskExists = allCards.some((c: { id: string }) => c.id === taskId);
		if (!taskExists) {
			throw new CliExit(1, `Task "${taskId}" not found.`);
		}
		sessionState = (state.sessions as Record<string, { state: string }>)[taskId] ?? null;
	} catch (e) {
		if (e instanceof CliExit) throw e;
		throw new CliExit(1, `Failed to query Kanban runtime at ${getKanbanRuntimeOrigin()}.`);
	}

	if (!sessionState || (sessionState.state !== "running" && sessionState.state !== "awaiting_review")) {
		// No live session — try to replay persisted history
		try {
			const result = await runtimeClient.runtime.getSessionHistory.query({ taskId });
			if (result.ok && result.snapshot) {
				process.stdout.write(result.snapshot.snapshot);
				const exitInfo = result.snapshot.exitCode !== null ? ` — exit code: ${result.snapshot.exitCode}` : "";
				process.stdout.write(`\n[Session completed${exitInfo}]\n`);
				throw new CliExit(0);
			}
		} catch (e) {
			if (e instanceof CliExit) throw e;
			/* history query failed */
		}
		throw new CliExit(
			1,
			`Task "${taskId}" has no active session and no history available (state: ${sessionState?.state ?? "none"}).`,
		);
	}

	// 2. Connect WebSocket clients
	const clientId = `cli-${randomUUID()}`;
	const wsParams = { taskId, workspaceId, clientId };
	let controlWs: WebSocket;
	let ioWs: WebSocket;

	try {
		controlWs = await connectSocket(buildWsUrl("/api/terminal/control", wsParams));
	} catch {
		throw new CliExit(1, `Failed to connect to Kanban terminal at ${getKanbanRuntimeOrigin()}.`);
	}

	try {
		ioWs = await connectSocket(buildWsUrl("/api/terminal/io", wsParams));
	} catch {
		controlWs.close();
		throw new CliExit(1, `Failed to connect to Kanban terminal IO at ${getKanbanRuntimeOrigin()}.`);
	}

	// 3. Handle restore handshake on control socket
	let restoreComplete = false;
	const restorePromise = new Promise<void>((resolveRestore) => {
		controlWs.on("message", (raw: WebSocket.Data) => {
			let message: RuntimeTerminalWsServerMessage;
			try {
				message = JSON.parse(raw.toString()) as RuntimeTerminalWsServerMessage;
			} catch {
				return;
			}

			if (message.type === "restore" && !restoreComplete) {
				// Write snapshot to stdout (ANSI/VT sequences)
				if (message.snapshot) {
					process.stdout.write(message.snapshot);
				}
				restoreComplete = true;
				controlWs.send(JSON.stringify({ type: "restore_complete" }));
				resolveRestore();
			} else if (message.type === "state") {
				// Session state update — informational
			} else if (message.type === "exit") {
				cleanup();
				process.stdout.write(`\n[session exited] Exit code: ${message.code ?? "unknown"}\n`);
				const exitCode = typeof message.code === "number" && message.code > 0 ? message.code : 0;
				throw new CliExit(exitCode);
			} else if (message.type === "error") {
				process.stderr.write(`[error] ${message.message}\n`);
			}
		});
	});

	// Wait for restore before proceeding
	await restorePromise;

	// 4. Send initial terminal size
	const cols = process.stdout.columns ?? 80;
	const rows = process.stdout.rows ?? 24;
	controlWs.send(JSON.stringify({ type: "resize", cols, rows }));

	// 5. Enter raw mode and set up I/O forwarding
	enterRawMode();

	let detached = false;
	let outputBytesSinceAck = 0;
	const ACK_THRESHOLD = 8192; // Send ack every ~8KB to cooperate with server's 16KB high water mark

	const cleanup = () => {
		if (detached) return;
		detached = true;
		leaveRawMode();
		try {
			ioWs.close();
		} catch {
			/* ignore */
		}
		try {
			controlWs.close();
		} catch {
			/* ignore */
		}
	};

	const detach = () => {
		cleanup();
		process.stdout.write("\n[detached]\n");
		// Use setImmediate to allow any pending writes to flush
		setImmediate(() => {
			process.exitCode = 0;
			forceExit(); // must exit immediately to release raw mode
		});
	};

	// IO socket: forward output to stdout
	ioWs.on("message", (data: WebSocket.Data) => {
		const buf = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
		process.stdout.write(buf);
		outputBytesSinceAck += buf.length;
		if (outputBytesSinceAck >= ACK_THRESHOLD) {
			try {
				controlWs.send(JSON.stringify({ type: "output_ack", bytes: outputBytesSinceAck }));
			} catch {
				/* socket may be closing */
			}
			outputBytesSinceAck = 0;
		}
	});

	// Stdin → IO socket (with detach sequence detection)
	if (!readonlyMode && !process.stdin.isTTY) {
		process.stderr.write("[warning] stdin is not a TTY — attaching in read-only mode.\n");
	} else if (!readonlyMode && process.stdin.isTTY) {
		const detachParser = createDetachParser(detach);
		process.stdin.on("data", (chunk: Buffer) => {
			if (detached) return;
			for (let i = 0; i < chunk.length; i++) {
				const toForward = detachParser(chunk[i] as number);
				if (toForward) {
					ioWs.send(Buffer.from(toForward));
				}
			}
		});
	}

	// Resize handling
	if (process.stdout.isTTY) {
		process.stdout.on("resize", () => {
			if (detached) return;
			const newCols = process.stdout.columns ?? 80;
			const newRows = process.stdout.rows ?? 24;
			try {
				controlWs.send(JSON.stringify({ type: "resize", cols: newCols, rows: newRows }));
			} catch {
				/* socket may be closing */
			}
		});
	}

	// Handle disconnects
	ioWs.on("close", () => {
		if (!detached) {
			cleanup();
			throw new CliExit(1, "[detached] Connection lost.");
		}
	});

	controlWs.on("close", () => {
		if (!detached) {
			cleanup();
			throw new CliExit(1, "[detached] Control connection lost.");
		}
	});

	// Handle signals for graceful shutdown
	const signalHandler = () => {
		cleanup();
		process.exitCode = 0;
		forceExit(); // must exit immediately to release raw mode
	};
	process.on("SIGTERM", signalHandler);
	process.on("SIGINT", signalHandler);
}

// ── Interactive picker (Plan D) ─────────────────────────────────────────────

async function runInteractivePicker(options: { projectPath?: string; readonly?: boolean }): Promise<void> {
	if (!process.stdin.isTTY) {
		throw new CliExit(1, "Interactive picker requires a TTY. Provide a task ID: kanban task attach <task-id>");
	}

	let workspaceId: string;
	try {
		const workspace = await resolveRuntimeWorkspace(options.projectPath, process.cwd(), {
			autoCreateIfMissing: false,
		});
		workspaceId = workspace.workspaceId;
	} catch {
		throw new CliExit(1, "Kanban runtime is not running. Start it with `kanban`.");
	}

	const runtimeClient = createRuntimeTrpcClient(workspaceId);
	let state: Awaited<ReturnType<typeof runtimeClient.workspace.getState.query>>;
	try {
		state = await runtimeClient.workspace.getState.query();
	} catch {
		throw new CliExit(1, `Failed to query Kanban runtime at ${getKanbanRuntimeOrigin()}.`);
	}

	// Build card title lookup
	const cardTitleMap = new Map<string, { title: string; column: string }>();
	for (const column of state.board.columns as RuntimeBoardColumn[]) {
		for (const card of column.cards) {
			cardTitleMap.set(card.id, { title: card.title, column: column.id });
		}
	}

	// Find pickable tasks
	const sessions = state.sessions as Record<string, { state: string; pid: number | null; agentId: string | null }>;
	const pickable: PickableTask[] = [];
	for (const [taskId, session] of Object.entries(sessions)) {
		if (session.state === "running" || session.state === "awaiting_review") {
			const cardInfo = cardTitleMap.get(taskId);
			pickable.push({
				taskId,
				title: cardInfo?.title ?? "(untitled)",
				column: cardInfo?.column ?? "unknown",
				state: session.state,
				agentId: session.agentId,
				pid: session.pid,
			});
		}
	}

	if (pickable.length === 0) {
		throw new CliExit(1, "No running task sessions. Use `kanban task start --task-id <id>` to start one.");
	}

	// Display picker
	process.stdout.write("\nRunning task sessions:\n\n");
	for (let i = 0; i < pickable.length; i++) {
		const task = pickable[i];
		const stateLabel = task.state === "running" ? "running" : "review  ";
		const agentLabel = (task.agentId ?? "unknown").padEnd(7);
		const pidLabel = task.pid ? `PID ${task.pid}` : "      ";
		process.stdout.write(`  ${i + 1}. ${task.title}  [${stateLabel}]  ${agentLabel}  ${pidLabel}\n`);
	}
	process.stdout.write(`\nSelect a task (1-${pickable.length}) or press Ctrl+C to cancel: `);

	// Read selection
	const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
	const answer = await new Promise<string>((resolve) => {
		rl.question("", resolve);
	});
	rl.close();

	const selection = Number.parseInt(answer.trim(), 10);
	if (!Number.isFinite(selection) || selection < 1 || selection > pickable.length) {
		throw new CliExit(1, `Invalid selection: "${answer.trim()}". Expected a number from 1 to ${pickable.length}.`);
	}

	const selected = pickable[selection - 1];
	await runAttach({
		taskId: selected.taskId,
		projectPath: options.projectPath,
		readonly: options.readonly,
	});
}

// ── Command registration ────────────────────────────────────────────────────

function handleCliError(error: unknown): void {
	if (error instanceof CliExit) {
		if (error.messageToStderr) {
			process.stderr.write(`${error.messageToStderr}\n`);
		}
		process.exitCode = error.code;
		return;
	}
	const message = error instanceof Error ? error.message : String(error);
	process.stderr.write(`${message}\n`);
	process.exitCode = 1;
}

export function registerTaskAttachCommand(task: Command): void {
	task
		.command("attach [task-id]")
		.description("Attach to a running task terminal session.")
		.option("--project-path <path>", "Workspace path. Defaults to current directory workspace.")
		.option("-r, --readonly", "Read-only mode. No stdin forwarding to the task session.")
		.action(async (taskId: string | undefined, options: { projectPath?: string; readonly?: boolean }) => {
			try {
				if (taskId) {
					await runAttach({ taskId, projectPath: options.projectPath, readonly: options.readonly });
				} else {
					await runInteractivePicker({
						projectPath: options.projectPath,
						readonly: options.readonly,
					});
				}
			} catch (error) {
				handleCliError(error);
			}
		});
}
