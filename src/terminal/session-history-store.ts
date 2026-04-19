import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

// ── Types ───────────────────────────────────────────────────────────────────

export interface PersistedSessionSnapshot {
	taskId: string;
	snapshot: string; // ANSI/VT serialized string from @xterm/addon-serialize
	cols: number;
	rows: number;
	exitCode: number | null;
	completedAt: number;
	agentId: string | null;
}

export interface SessionHistoryStore {
	save(taskId: string, snapshot: PersistedSessionSnapshot): Promise<void>;
	load(taskId: string): Promise<PersistedSessionSnapshot | null>;
	delete(taskId: string): Promise<void>;
	deleteOlderThan(maxAgeMs: number): Promise<number>;
}

// ── Implementation ──────────────────────────────────────────────────────────

const MAX_SNAPSHOT_BYTES = 1_000_000; // 1MB max per snapshot
const HISTORY_DIR_NAME = "kanban/session-history";

function getHistoryDir(): string {
	return join(homedir(), ".cline", HISTORY_DIR_NAME);
}

function getFilePath(taskId: string): string {
	if (taskId.includes("/") || taskId.includes("\\") || taskId.includes("..")) {
		throw new Error(`Invalid task ID: ${taskId}`);
	}
	return join(getHistoryDir(), `${taskId}.json`);
}

/**
 * Truncate a snapshot string to fit within maxBytes by keeping the most recent
 * content (end of the string). The snapshot contains ANSI/VT sequences, so we
 * can only safely cut at line boundaries to avoid breaking escape sequences.
 */
function truncateSnapshot(snapshot: string, maxBytes: number): string {
	if (Buffer.byteLength(snapshot, "utf8") <= maxBytes) return snapshot;

	// Work backwards from the end to find a safe cut point.
	// Since ANSI sequences are line-based in xterm serialize output,
	// cutting at a newline boundary is safe.
	const byteLength = Buffer.byteLength(snapshot, "utf8");
	const excess = byteLength - maxBytes;
	// Estimate character position (works well for mostly-ASCII terminal output)
	const estimatedCutChar = Math.floor(excess * (snapshot.length / byteLength));
	// Find next newline after estimated position
	const cutPoint = snapshot.indexOf("\n", estimatedCutChar);
	if (cutPoint === -1) {
		// No newline found; slice from estimated position as last resort
		return snapshot.slice(estimatedCutChar);
	}
	return snapshot.slice(cutPoint + 1);
}

async function ensureHistoryDir(): Promise<void> {
	await mkdir(getHistoryDir(), { recursive: true });
}

export class FileSessionHistoryStore implements SessionHistoryStore {
	async save(taskId: string, data: PersistedSessionSnapshot): Promise<void> {
		await ensureHistoryDir();
		const truncated = {
			...data,
			snapshot: truncateSnapshot(data.snapshot, MAX_SNAPSHOT_BYTES),
		};
		await writeFile(getFilePath(taskId), JSON.stringify(truncated), "utf8");
	}

	async load(taskId: string): Promise<PersistedSessionSnapshot | null> {
		try {
			const content = await readFile(getFilePath(taskId), "utf8");
			return JSON.parse(content) as PersistedSessionSnapshot;
		} catch {
			return null;
		}
	}

	async delete(taskId: string): Promise<void> {
		try {
			await rm(getFilePath(taskId), { force: true });
		} catch {
			// File may not exist — ignore
		}
	}

	async deleteOlderThan(maxAgeMs: number): Promise<number> {
		const cutoff = Date.now() - maxAgeMs;
		let deletedCount = 0;
		let entries: string[];
		try {
			entries = await readdir(getHistoryDir());
		} catch {
			return 0;
		}
		for (const entry of entries) {
			if (!entry.endsWith(".json")) continue;
			try {
				const content = await readFile(join(getHistoryDir(), entry), "utf8");
				const data = JSON.parse(content) as PersistedSessionSnapshot;
				if (data.completedAt < cutoff) {
					await rm(join(getHistoryDir(), entry), { force: true });
					deletedCount++;
				}
			} catch {
				// Malformed or unreadable file — skip
			}
		}
		return deletedCount;
	}
}
