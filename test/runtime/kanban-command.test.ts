import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { buildKanbanCommandParts, resolveKanbanCommandParts } from "../../src/core/kanban-command";

describe("resolveKanbanCommandParts", () => {
	it("resolves node plus script entrypoint", () => {
		const parts = resolveKanbanCommandParts({
			execPath: "/usr/local/bin/node",
			argv: ["/usr/local/bin/node", "/tmp/.npx/123/node_modules/kanban/dist/cli.js", "--port", "9123"],
		});
		expect(parts).toEqual(["/usr/local/bin/node", "/tmp/.npx/123/node_modules/kanban/dist/cli.js"]);
	});

	it("resolves tsx launched cli entrypoint", () => {
		const parts = resolveKanbanCommandParts({
			execPath: "/usr/local/bin/node",
			argv: ["/usr/local/bin/node", "/repo/node_modules/tsx/dist/cli.mjs", "/repo/src/cli.ts", "--no-open"],
		});
		expect(parts).toEqual(["/usr/local/bin/node", "/repo/node_modules/tsx/dist/cli.mjs", "/repo/src/cli.ts"]);
	});

	it("resolves --import package specifiers against runtime cwd", () => {
		const cwd = process.cwd();
		const parts = resolveKanbanCommandParts({
			execPath: process.execPath,
			execArgv: ["--import", "tsx"],
			argv: [process.execPath, join(cwd, "src/cli.ts"), "--no-open"],
			cwd,
		});
		expect(parts[0]).toBe(process.execPath);
		expect(parts[1]).toBe("--import");
		expect(parts[2]).toContain("node_modules/tsx/dist/loader.mjs");
		expect(parts[2]).toMatch(/^file:/u);
		expect(parts[3]).toBe(join(cwd, "src/cli.ts"));
	});

	it("resolves relative --require paths against runtime cwd", () => {
		const parts = resolveKanbanCommandParts({
			execPath: "/usr/local/bin/node",
			execArgv: ["--require", "./node_modules/tsx/dist/preflight.cjs"],
			argv: ["/usr/local/bin/node", "/repo/src/cli.ts", "--no-open"],
			cwd: "/repo",
		});
		expect(parts).toEqual([
			"/usr/local/bin/node",
			"--require",
			"/repo/node_modules/tsx/dist/preflight.cjs",
			"/repo/src/cli.ts",
		]);
	});

	it("falls back to execPath when no entrypoint path is available", () => {
		const parts = resolveKanbanCommandParts({
			execPath: "/usr/local/bin/kanban",
			argv: ["/usr/local/bin/kanban", "hooks", "ingest"],
		});
		expect(parts).toEqual(["/usr/local/bin/kanban"]);
	});
});

describe("buildKanbanCommandParts", () => {
	it("appends command arguments to resolved runtime invocation", () => {
		expect(
			buildKanbanCommandParts(["hooks", "ingest"], {
				execPath: "/usr/local/bin/node",
				argv: ["/usr/local/bin/node", "/tmp/.npx/321/node_modules/kanban/dist/cli.js"],
			}),
		).toEqual(["/usr/local/bin/node", "/tmp/.npx/321/node_modules/kanban/dist/cli.js", "hooks", "ingest"]);
	});
});
