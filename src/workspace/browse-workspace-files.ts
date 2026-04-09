import { execFile } from "node:child_process";
import { readFile as fsReadFile, writeFile as fsWriteFile, readdir, stat } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { createGitProcessEnv } from "../core/git-process-env.js";

const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2MB

const BINARY_EXTENSIONS = new Set([
	"png",
	"jpg",
	"jpeg",
	"gif",
	"bmp",
	"ico",
	"webp",
	"avif",
	"mp3",
	"mp4",
	"wav",
	"ogg",
	"webm",
	"flac",
	"aac",
	"zip",
	"tar",
	"gz",
	"bz2",
	"xz",
	"7z",
	"rar",
	"pdf",
	"doc",
	"docx",
	"xls",
	"xlsx",
	"ppt",
	"pptx",
	"exe",
	"dll",
	"so",
	"dylib",
	"bin",
	"dat",
	"woff",
	"woff2",
	"ttf",
	"eot",
	"otf",
	"sqlite",
	"db",
	"o",
	"obj",
	"class",
	"pyc",
	"wasm",
]);

function isBinaryPath(filePath: string): boolean {
	const ext = filePath.slice(filePath.lastIndexOf(".") + 1).toLowerCase();
	return BINARY_EXTENSIONS.has(ext);
}

function isBinaryBuffer(buffer: Buffer): boolean {
	const check = buffer.subarray(0, Math.min(8192, buffer.length));
	for (let i = 0; i < check.length; i++) {
		const byte = check[i]!;
		if (byte === 0) return true;
		if (byte < 7 && byte !== 0) return true;
	}
	return false;
}

function securePath(cwd: string, requestedPath: string): string {
	const resolved = resolve(cwd, requestedPath);
	if (!resolved.startsWith(cwd)) {
		throw new Error("Path traversal not allowed");
	}
	return resolved;
}

export interface RuntimeDirectoryEntry {
	name: string;
	path: string;
	type: "file" | "directory";
}

export async function listDirectoryEntries(
	cwd: string,
	dirPath: string,
): Promise<{ entries: RuntimeDirectoryEntry[] }> {
	const targetDir = dirPath ? securePath(cwd, dirPath) : cwd;
	const items = await readdir(targetDir, { withFileTypes: true });
	const entries: RuntimeDirectoryEntry[] = [];

	const dirs: RuntimeDirectoryEntry[] = [];
	const files: RuntimeDirectoryEntry[] = [];

	for (const item of items) {
		if (item.name === ".git" || item.name === "node_modules" || item.name === ".worktrees") {
			continue;
		}
		const entryPath = relative(cwd, join(targetDir, item.name));
		if (item.isDirectory()) {
			dirs.push({ name: item.name, path: entryPath, type: "directory" });
		} else if (item.isFile() || item.isSymbolicLink()) {
			files.push({ name: item.name, path: entryPath, type: "file" });
		}
	}

	dirs.sort((a, b) => a.name.localeCompare(b.name));
	files.sort((a, b) => a.name.localeCompare(b.name));
	entries.push(...dirs, ...files);

	return { entries };
}

export interface RuntimeFileReadResponse {
	path: string;
	content: string | null;
	size: number;
	isBinary: boolean;
	error?: string;
}

export async function readWorkspaceFile(cwd: string, filePath: string): Promise<RuntimeFileReadResponse> {
	const fullPath = securePath(cwd, filePath);

	try {
		const fileStat = await stat(fullPath);
		if (!fileStat.isFile()) {
			return { path: filePath, content: null, size: 0, isBinary: false, error: "Not a file" };
		}

		if (fileStat.size > MAX_FILE_SIZE) {
			return {
				path: filePath,
				content: null,
				size: fileStat.size,
				isBinary: false,
				error: `File too large (${Math.round(fileStat.size / 1024)}KB). Max: ${MAX_FILE_SIZE / 1024}KB`,
			};
		}

		if (isBinaryPath(filePath)) {
			return { path: filePath, content: null, size: fileStat.size, isBinary: true };
		}

		const buffer = await fsReadFile(fullPath);
		if (isBinaryBuffer(buffer)) {
			return { path: filePath, content: null, size: fileStat.size, isBinary: true };
		}

		return { path: filePath, content: buffer.toString("utf-8"), size: fileStat.size, isBinary: false };
	} catch (err) {
		return {
			path: filePath,
			content: null,
			size: 0,
			isBinary: false,
			error: err instanceof Error ? err.message : String(err),
		};
	}
}

export interface RuntimeFileWriteResponse {
	ok: boolean;
	error?: string;
}

export async function writeWorkspaceFile(
	cwd: string,
	filePath: string,
	content: string,
): Promise<RuntimeFileWriteResponse> {
	const fullPath = securePath(cwd, filePath);

	try {
		await fsWriteFile(fullPath, content, "utf-8");
		return { ok: true };
	} catch (err) {
		return { ok: false, error: err instanceof Error ? err.message : String(err) };
	}
}

// ── Git gutter line status ─────────────────────────────────────

export type GitLineChangeType = "added" | "modified" | "deleted";

export interface GitLineChange {
	type: GitLineChangeType;
	/** 1-based start line in the working copy. For deleted lines this is the line after which deletion occurred. */
	startLine: number;
	/** Number of lines affected (0 for pure deletions). */
	lineCount: number;
}

export interface RuntimeFileGitLineStatusResponse {
	path: string;
	changes: GitLineChange[];
}

function runGitDiff(cwd: string, filePath: string): Promise<string> {
	return new Promise((resolve, reject) => {
		execFile(
			"git",
			["diff", "--unified=0", "--no-color", "HEAD", "--", filePath],
			{ cwd, env: createGitProcessEnv(), maxBuffer: 1024 * 1024 },
			(error, stdout) => {
				if (error && (error as NodeJS.ErrnoException).code === "ENOENT") {
					reject(new Error("git is not available"));
					return;
				}
				// git diff exits with 1 when there are differences — that's fine
				resolve(stdout);
			},
		);
	});
}

const HUNK_HEADER_REGEX = /^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/;

function parseGitDiffHunks(diffOutput: string): GitLineChange[] {
	const changes: GitLineChange[] = [];
	for (const line of diffOutput.split("\n")) {
		const match = HUNK_HEADER_REGEX.exec(line);
		if (!match) {
			continue;
		}
		const oldCount = match[2] !== undefined ? Number.parseInt(match[2], 10) : 1;
		const newStart = Number.parseInt(match[3]!, 10);
		const newCount = match[4] !== undefined ? Number.parseInt(match[4], 10) : 1;

		if (oldCount === 0 && newCount > 0) {
			// Pure addition
			changes.push({ type: "added", startLine: newStart, lineCount: newCount });
		} else if (newCount === 0 && oldCount > 0) {
			// Pure deletion — mark the line after which content was removed
			changes.push({ type: "deleted", startLine: newStart, lineCount: 0 });
		} else {
			// Modification (lines replaced)
			changes.push({ type: "modified", startLine: newStart, lineCount: newCount });
		}
	}
	return changes;
}

export async function getFileGitLineStatus(cwd: string, filePath: string): Promise<RuntimeFileGitLineStatusResponse> {
	try {
		const diffOutput = await runGitDiff(cwd, filePath);
		const changes = parseGitDiffHunks(diffOutput);
		return { path: filePath, changes };
	} catch {
		return { path: filePath, changes: [] };
	}
}
