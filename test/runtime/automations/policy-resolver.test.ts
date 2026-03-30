import { describe, expect, it } from "vitest";
import type { AutomationAgentInstance, AutomationAgentTemplate } from "../../../src/automations/automation-types";
import { resolvePolicy } from "../../../src/automations/policy-resolver";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const INSTANCE_UUID = "00000000-0000-0000-0000-000000000001";

function makeTemplate(overrides: Partial<AutomationAgentTemplate> = {}): AutomationAgentTemplate {
	return {
		id: "quality-enforcer",
		name: "Quality Enforcer",
		description: "Runs quality checks.",
		version: "1.0.0",
		allowedActions: ["create_backlog_task", "auto_start_task"],
		defaultPolicy: {
			scanIntervalSeconds: 300,
			maxFindingsPerScan: 20,
			maxTasksCreatedPerHour: 5,
			maxAutoStartsPerHour: 2,
			cooldownMinutes: 60,
			severityThreshold: "warning",
		},
		ruleIds: [],
		...overrides,
	};
}

function makeInstance(overrides: Partial<AutomationAgentInstance> = {}): AutomationAgentInstance {
	return {
		id: INSTANCE_UUID,
		templateId: "quality-enforcer",
		label: "Quality Enforcer — test",
		projectPaths: ["/home/user/project"],
		enabled: true,
		policyOverrides: {},
		createdAt: Date.now(),
		updatedAt: Date.now(),
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("resolvePolicy", () => {
	it("returns template defaults when instance has no overrides", () => {
		const template = makeTemplate();
		const instance = makeInstance({ policyOverrides: {} });
		const policy = resolvePolicy(template, instance);

		expect(policy.scanIntervalSeconds).toBe(300);
		expect(policy.maxFindingsPerScan).toBe(20);
		expect(policy.maxTasksCreatedPerHour).toBe(5);
		expect(policy.maxAutoStartsPerHour).toBe(2);
		expect(policy.cooldownMinutes).toBe(60);
		expect(policy.severityThreshold).toBe("warning");
		expect(policy.allowedActions).toEqual(["create_backlog_task", "auto_start_task"]);
	});

	it("applies instance numeric overrides", () => {
		const template = makeTemplate();
		const instance = makeInstance({
			policyOverrides: {
				scanIntervalSeconds: 600,
				maxTasksCreatedPerHour: 2,
				cooldownMinutes: 120,
			},
		});
		const policy = resolvePolicy(template, instance);

		expect(policy.scanIntervalSeconds).toBe(600);
		expect(policy.maxTasksCreatedPerHour).toBe(2);
		expect(policy.cooldownMinutes).toBe(120);
		// Untouched fields from template
		expect(policy.maxFindingsPerScan).toBe(20);
		expect(policy.maxAutoStartsPerHour).toBe(2);
	});

	it("instance can restrict allowedActions to a subset", () => {
		const template = makeTemplate({
			allowedActions: ["create_backlog_task", "auto_start_task"],
		});
		const instance = makeInstance({
			policyOverrides: { allowedActions: ["create_backlog_task"] },
		});
		const policy = resolvePolicy(template, instance);
		expect(policy.allowedActions).toEqual(["create_backlog_task"]);
	});

	it("instance cannot expand allowedActions beyond template", () => {
		const template = makeTemplate({
			allowedActions: ["create_backlog_task"],
		});
		const instance = makeInstance({
			// Tries to add "auto_start_task" which the template does not allow
			policyOverrides: { allowedActions: ["create_backlog_task", "auto_start_task"] },
		});
		const policy = resolvePolicy(template, instance);
		expect(policy.allowedActions).toEqual(["create_backlog_task"]);
		expect(policy.allowedActions).not.toContain("auto_start_task");
	});

	it("null policyOverrides.allowedActions falls back to template set", () => {
		const template = makeTemplate({
			allowedActions: ["create_backlog_task", "auto_start_task"],
		});
		const instance = makeInstance({
			policyOverrides: { allowedActions: null as unknown as undefined },
		});
		const policy = resolvePolicy(template, instance);
		expect(policy.allowedActions).toEqual(["create_backlog_task", "auto_start_task"]);
	});

	it("empty allowedActions override results in empty action set", () => {
		const template = makeTemplate({
			allowedActions: ["create_backlog_task", "auto_start_task"],
		});
		const instance = makeInstance({
			policyOverrides: { allowedActions: [] },
		});
		const policy = resolvePolicy(template, instance);
		expect(policy.allowedActions).toEqual([]);
	});

	it("override with actions not in template results in empty set", () => {
		const template = makeTemplate({
			allowedActions: ["create_backlog_task"],
		});
		const instance = makeInstance({
			policyOverrides: { allowedActions: ["auto_start_task"] },
		});
		const policy = resolvePolicy(template, instance);
		expect(policy.allowedActions).toEqual([]);
	});

	it("severity threshold override is respected", () => {
		const template = makeTemplate();
		const instance = makeInstance({ policyOverrides: { severityThreshold: "error" } });
		const policy = resolvePolicy(template, instance);
		expect(policy.severityThreshold).toBe("error");
	});

	it("undefined policyOverrides treated as no overrides", () => {
		const template = makeTemplate();
		const instance = makeInstance({ policyOverrides: undefined });
		const policy = resolvePolicy(template, instance);
		expect(policy.scanIntervalSeconds).toBe(300);
		expect(policy.allowedActions).toEqual(["create_backlog_task", "auto_start_task"]);
	});
});
