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
const DEFAULT_HISTORY_DIR = join(homedir(), ".cline", "kanban", "session-history");

function getFilePath(taskId: string, baseDir: string): string {
	if (taskId.includes("/") || taskId.includes("\\") || taskId.includes("..")) {
		throw new Error(`Invalid task ID: ${taskId}`);
	}
	return join(baseDir, `${taskId}.json`);
}

/**
 * Truncate a snapshot string to fit within maxBytes by keeping the most recent
 * content (end of the string). The snapshot contains ANSI/VT sequences, so we
 * can only safely cut at line boundaries to avoid breaking escape sequences.
 */
function truncateSnapshot(snapshot: string, maxBytes: number): string {
	if (Buffer.byteLength(snapshot, "utf8") <= maxBytes) return snapshot;

	const byteLength = Buffer.byteLength(snapshot, "utf8");
	const excess = byteLength - maxBytes;
	// Estimate character position (works well for mostly-ASCII terminal output)
	const estimatedCutChar = Math.floor(excess * (snapshot.length / byteLength));
	// Find next newline after estimated position
	const cutPoint = snapshot.indexOf("\n", estimatedCutChar);
	if (cutPoint === -1) {
		return snapshot.slice(estimatedCutChar);
	}
	return snapshot.slice(cutPoint + 1);
}

export class FileSessionHistoryStore implements SessionHistoryStore {
	private readonly baseDir: string;

	constructor(baseDir: string = DEFAULT_HISTORY_DIR) {
		this.baseDir = baseDir;
	}

	async save(taskId: string, data: PersistedSessionSnapshot): Promise<void> {
		await mkdir(this.baseDir, { recursive: true });
		const truncated = {
			...data,
			snapshot: truncateSnapshot(data.snapshot, MAX_SNAPSHOT_BYTES),
		};
		await writeFile(getFilePath(taskId, this.baseDir), JSON.stringify(truncated), "utf8");
	}

	async load(taskId: string): Promise<PersistedSessionSnapshot | null> {
		try {
			const content = await readFile(getFilePath(taskId, this.baseDir), "utf8");
			return JSON.parse(content) as PersistedSessionSnapshot;
		} catch {
			return null;
		}
	}

	async delete(taskId: string): Promise<void> {
		try {
			await rm(getFilePath(taskId, this.baseDir), { force: true });
		} catch {
			// File may not exist — ignore
		}
	}

	async deleteOlderThan(maxAgeMs: number): Promise<number> {
		const cutoff = Date.now() - maxAgeMs;
		let deletedCount = 0;
		let entries: string[];
		try {
			entries = await readdir(this.baseDir);
		} catch {
			return 0;
		}
		for (const entry of entries) {
			if (!entry.endsWith(".json")) continue;
			try {
				const content = await readFile(join(this.baseDir, entry), "utf8");
				const data = JSON.parse(content) as PersistedSessionSnapshot;
				if (data.completedAt < cutoff) {
					await rm(join(this.baseDir, entry), { force: true });
					deletedCount++;
				}
			} catch {
				// Malformed or unreadable file — skip
			}
		}
		return deletedCount;
	}
}
