import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { loadAgentSpecialists } from "../../../src/config/agent-specialists";

describe("loadAgentSpecialists", () => {
	function makeTmpAgentsJson(entries: unknown[]): string {
		const tmpDir = mkdtempSync(join(tmpdir(), "kb-specialists-test-"));
		mkdirSync(join(tmpDir, ".cline", "kanban"), { recursive: true });
		writeFileSync(join(tmpDir, ".cline", "kanban", "agents.json"), JSON.stringify(entries));
		return tmpDir;
	}

	it("returns empty array when agents.json does not exist", () => {
		const tmpDir = mkdtempSync(join(tmpdir(), "kb-specialists-test-"));
		expect(loadAgentSpecialists(tmpDir)).toEqual([]);
	});

	it("loads valid specialists without modelId", () => {
		const tmpDir = makeTmpAgentsJson([{ id: "planner", baseAgentId: "claude", description: "Plans tasks" }]);
		const result = loadAgentSpecialists(tmpDir);
		expect(result).toHaveLength(1);
		expect(result[0]).toEqual({ id: "planner", baseAgentId: "claude", description: "Plans tasks" });
		expect(result[0]?.modelId).toBeUndefined();
	});

	it("loads valid specialists with modelId", () => {
		const tmpDir = makeTmpAgentsJson([
			{ id: "poet", baseAgentId: "cline", description: "Writes beautiful prose", modelId: "claude-opus-4-5" },
		]);
		const result = loadAgentSpecialists(tmpDir);
		expect(result).toHaveLength(1);
		expect(result[0]).toEqual({
			id: "poet",
			baseAgentId: "cline",
			description: "Writes beautiful prose",
			modelId: "claude-opus-4-5",
		});
	});

	it("filters out entries with empty-string modelId", () => {
		const tmpDir = makeTmpAgentsJson([
			{ id: "bad", baseAgentId: "cline", description: "Has blank model", modelId: "" },
			{ id: "good", baseAgentId: "cline", description: "No model field" },
		]);
		const result = loadAgentSpecialists(tmpDir);
		expect(result).toHaveLength(1);
		expect(result[0]?.id).toBe("good");
	});

	it("filters out entries with whitespace-only modelId", () => {
		const tmpDir = makeTmpAgentsJson([
			{ id: "bad", baseAgentId: "cline", description: "Has whitespace model", modelId: "   " },
		]);
		expect(loadAgentSpecialists(tmpDir)).toHaveLength(0);
	});

	it("filters out entries with non-string modelId", () => {
		const tmpDir = makeTmpAgentsJson([
			{ id: "bad", baseAgentId: "cline", description: "Has numeric model", modelId: 42 },
		]);
		expect(loadAgentSpecialists(tmpDir)).toHaveLength(0);
	});

	it("filters out entries missing required fields", () => {
		const tmpDir = makeTmpAgentsJson([
			{ id: "no-base", description: "Missing baseAgentId" },
			{ baseAgentId: "cline", description: "Missing id" },
			{ id: "no-desc", baseAgentId: "cline" },
		]);
		expect(loadAgentSpecialists(tmpDir)).toHaveLength(0);
	});

	it("returns empty array when agents.json is not an array", () => {
		const tmpDir = mkdtempSync(join(tmpdir(), "kb-specialists-test-"));
		mkdirSync(join(tmpDir, ".cline", "kanban"), { recursive: true });
		writeFileSync(join(tmpDir, ".cline", "kanban", "agents.json"), JSON.stringify({ id: "solo" }));
		expect(loadAgentSpecialists(tmpDir)).toHaveLength(0);
	});
});
