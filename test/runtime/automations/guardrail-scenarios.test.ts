/**
 * Guardrail engine scenario tests.
 *
 * These tests verify the anti-runaway guarantees: preflight tripwires,
 * per-instance hourly task-creation budgets, deduplication (existing open
 * findings are not re-triggered), remediation suppression, and the global
 * budget cap.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AutomationStore } from "../../../src/automations/automation-store";
import type {
	AutomationAgentInstance,
	AutomationAgentTemplate,
	AutomationFinding,
	RemediationRecord,
	ResolvedPolicy,
} from "../../../src/automations/automation-types";
import { GuardrailEngine } from "../../../src/automations/guardrail-engine";

// ---------------------------------------------------------------------------
// Constants matching the engine's internal tripwire thresholds (keep in sync)
// ---------------------------------------------------------------------------

/** TRIPWIRE_FINDINGS_MULTIPLIER from guardrail-engine.ts */
const TRIPWIRE_FINDINGS_MULTIPLIER = 3;
/** GLOBAL_MAX_TASKS_PER_HOUR from guardrail-engine.ts */
const GLOBAL_MAX_TASKS_PER_HOUR = 20;

// ---------------------------------------------------------------------------
// UUIDs for fixtures
// ---------------------------------------------------------------------------

let _seq = 1;
function nextUuid(): string {
	const n = String(_seq++).padStart(12, "0");
	return `00000000-0000-0000-0000-${n}`;
}

// ---------------------------------------------------------------------------
// Mock store factory — creates a minimal AutomationStore stub.
// ---------------------------------------------------------------------------

function makeMockStore(overrides: Partial<Record<keyof AutomationStore, unknown>> = {}): AutomationStore {
	return {
		listInstances: vi.fn().mockResolvedValue([]),
		getInstance: vi.fn().mockResolvedValue(null),
		saveInstance: vi.fn().mockResolvedValue(undefined),
		deleteInstance: vi.fn().mockResolvedValue(undefined),
		listFindings: vi.fn().mockResolvedValue([]),
		getFinding: vi.fn().mockResolvedValue(null),
		saveFinding: vi.fn().mockResolvedValue(undefined),
		getRemediation: vi.fn().mockResolvedValue(null),
		saveRemediation: vi.fn().mockResolvedValue(undefined),
		listRemediations: vi.fn().mockResolvedValue([]),
		listScanRuns: vi.fn().mockResolvedValue([]),
		saveScanRun: vi.fn().mockResolvedValue(undefined),
		listAuditEvents: vi.fn().mockResolvedValue([]),
		appendAuditEvent: vi.fn().mockResolvedValue(undefined),
		purgeAuditEvents: vi.fn().mockResolvedValue(0),
		countTasksCreatedInWindow: vi.fn().mockResolvedValue(0),
		countAutoStartsInWindow: vi.fn().mockResolvedValue(0),
		countGlobalTasksCreatedInWindow: vi.fn().mockResolvedValue(0),
		countGlobalAutoStartsInWindow: vi.fn().mockResolvedValue(0),
		...overrides,
	} as unknown as AutomationStore;
}

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makeInstance(overrides: Partial<AutomationAgentInstance> = {}): AutomationAgentInstance {
	return {
		id: nextUuid(),
		templateId: "quality-enforcer",
		label: "Quality Enforcer — test",
		projectPaths: ["/project"],
		enabled: true,
		policyOverrides: {},
		createdAt: Date.now(),
		updatedAt: Date.now(),
		...overrides,
	};
}

function makeTemplate(overrides: Partial<AutomationAgentTemplate> = {}): AutomationAgentTemplate {
	return {
		id: "quality-enforcer",
		name: "Quality Enforcer",
		description: "Quality checks",
		version: "1.0.0",
		ruleIds: [],
		allowedActions: ["create_backlog_task", "auto_start_task"],
		defaultPolicy: {
			scanIntervalSeconds: 300,
			maxFindingsPerScan: 20,
			maxTasksCreatedPerHour: 5,
			maxAutoStartsPerHour: 2,
			cooldownMinutes: 60,
			severityThreshold: "warning",
		},
		...overrides,
	};
}

function makePolicy(overrides: Partial<ResolvedPolicy> = {}): ResolvedPolicy {
	return {
		scanIntervalSeconds: 300,
		maxFindingsPerScan: 20,
		maxTasksCreatedPerHour: 5,
		maxAutoStartsPerHour: 2,
		cooldownMinutes: 60,
		severityThreshold: "warning",
		allowedActions: ["create_backlog_task", "auto_start_task"],
		...overrides,
	};
}

function makeFinding(overrides: Partial<AutomationFinding> = {}): AutomationFinding {
	return {
		id: nextUuid(),
		fingerprint: `fp-${nextUuid()}`,
		instanceId: nextUuid(),
		templateId: "quality-enforcer",
		projectPath: "/project",
		ruleId: "no-untested-code",
		title: "Missing tests",
		description: "Module has no tests.",
		category: "missing-tests",
		affectedFiles: [],
		severity: "warning",
		status: "open",
		evidence: {},
		firstSeenAt: Date.now(),
		lastSeenAt: Date.now(),
		linkedTaskId: null,
		...overrides,
	};
}

function makeRemediation(
	fingerprint: string,
	lastAttemptAt: number,
	overrides: Partial<RemediationRecord> = {},
): RemediationRecord {
	return {
		findingFingerprint: fingerprint,
		taskId: nextUuid(),
		createdAt: lastAttemptAt,
		lastAttemptAt,
		attemptCount: 1,
		state: "active",
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GuardrailEngine", () => {
	let store: AutomationStore;
	let engine: GuardrailEngine;
	let template: AutomationAgentTemplate;
	let instance: AutomationAgentInstance;
	let policy: ResolvedPolicy;

	beforeEach(() => {
		store = makeMockStore();
		engine = new GuardrailEngine(store);
		template = makeTemplate();
		instance = makeInstance();
		policy = makePolicy();
	});

	// -------------------------------------------------------------------------
	// Preflight tripwire (too-many-findings)
	// -------------------------------------------------------------------------

	it("halts immediately when rawFindingsCount exceeds maxFindingsPerScan × tripwire multiplier", async () => {
		const findings = [makeFinding()];
		const overLimit = policy.maxFindingsPerScan * TRIPWIRE_FINDINGS_MULTIPLIER + 1;

		const decisions = await engine.evaluateFindings(findings, instance, template, policy, overLimit);

		expect(decisions).toHaveLength(1);
		expect(decisions[0]?.action).toBe("halt");
	});

	it("does NOT halt when rawFindingsCount is at (not over) the tripwire threshold", async () => {
		store = makeMockStore({
			getFinding: vi.fn().mockResolvedValue(null),
			getRemediation: vi.fn().mockResolvedValue(null),
		});
		engine = new GuardrailEngine(store);

		const findings = [makeFinding()];
		// Exactly at threshold — should NOT trigger (engine uses strict >)
		const atLimit = policy.maxFindingsPerScan * TRIPWIRE_FINDINGS_MULTIPLIER;

		const decisions = await engine.evaluateFindings(findings, instance, template, policy, atLimit);

		expect(decisions[0]?.action).not.toBe("halt");
	});

	// -------------------------------------------------------------------------
	// Budget enforcement
	// -------------------------------------------------------------------------

	it("suppresses create_task when hourly task budget is exhausted", async () => {
		store = makeMockStore({
			// Historical count equals the per-instance limit
			countTasksCreatedInWindow: vi.fn().mockResolvedValue(policy.maxTasksCreatedPerHour),
			countAutoStartsInWindow: vi.fn().mockResolvedValue(0),
			countGlobalTasksCreatedInWindow: vi.fn().mockResolvedValue(0),
			countGlobalAutoStartsInWindow: vi.fn().mockResolvedValue(0),
			getFinding: vi.fn().mockResolvedValue(null),
			getRemediation: vi.fn().mockResolvedValue(null),
		});
		engine = new GuardrailEngine(store);

		const findings = [makeFinding()];
		const decisions = await engine.evaluateFindings(findings, instance, template, policy, 1);

		expect(decisions[0]?.action).toBe("suppress");
	});

	it("allows create_task when per-instance and global budgets are not exhausted", async () => {
		store = makeMockStore({
			countTasksCreatedInWindow: vi.fn().mockResolvedValue(0),
			countAutoStartsInWindow: vi.fn().mockResolvedValue(0),
			countGlobalTasksCreatedInWindow: vi.fn().mockResolvedValue(0),
			countGlobalAutoStartsInWindow: vi.fn().mockResolvedValue(0),
			getFinding: vi.fn().mockResolvedValue(null),
			getRemediation: vi.fn().mockResolvedValue(null),
		});
		engine = new GuardrailEngine(store);

		// severity "warning" → canAutoStart = false → falls through to create_task
		const findings = [makeFinding({ severity: "warning" })];
		const decisions = await engine.evaluateFindings(findings, instance, template, policy, 1);

		expect(decisions[0]?.action).toBe("create_task");
	});

	// -------------------------------------------------------------------------
	// Deduplication
	// -------------------------------------------------------------------------

	it("returns update_existing for a finding that already has an open record", async () => {
		const finding = makeFinding();
		const existingFinding: AutomationFinding = { ...finding, status: "open" };

		store = makeMockStore({
			countTasksCreatedInWindow: vi.fn().mockResolvedValue(0),
			countAutoStartsInWindow: vi.fn().mockResolvedValue(0),
			countGlobalTasksCreatedInWindow: vi.fn().mockResolvedValue(0),
			countGlobalAutoStartsInWindow: vi.fn().mockResolvedValue(0),
			getFinding: vi.fn().mockResolvedValue(existingFinding),
			getRemediation: vi.fn().mockResolvedValue(null),
		});
		engine = new GuardrailEngine(store);

		const decisions = await engine.evaluateFindings([finding], instance, template, policy, 1);

		// "open" status → update_existing (don't create a duplicate task)
		expect(decisions[0]?.action).toBe("update_existing");
	});

	it("returns create_task when existing finding was resolved (re-appearing issue)", async () => {
		const finding = makeFinding();
		const resolvedFinding: AutomationFinding = { ...finding, status: "resolved" };

		store = makeMockStore({
			countTasksCreatedInWindow: vi.fn().mockResolvedValue(0),
			countAutoStartsInWindow: vi.fn().mockResolvedValue(0),
			countGlobalTasksCreatedInWindow: vi.fn().mockResolvedValue(0),
			countGlobalAutoStartsInWindow: vi.fn().mockResolvedValue(0),
			// Resolved finding → deduplication returns null → treated as new
			getFinding: vi.fn().mockResolvedValue(resolvedFinding),
			getRemediation: vi.fn().mockResolvedValue(null),
		});
		engine = new GuardrailEngine(store);

		const decisions = await engine.evaluateFindings([finding], instance, template, policy, 1);

		expect(decisions[0]?.action).toBe("create_task");
	});

	it("suppresses a manually-suppressed finding permanently", async () => {
		const finding = makeFinding();
		const suppressedFinding: AutomationFinding = { ...finding, status: "suppressed" };

		store = makeMockStore({
			getFinding: vi.fn().mockResolvedValue(suppressedFinding),
		});
		engine = new GuardrailEngine(store);

		const decisions = await engine.evaluateFindings([finding], instance, template, policy, 1);

		expect(decisions[0]?.action).toBe("suppress");
	});

	// -------------------------------------------------------------------------
	// Cooldown — requires BOTH existingFinding AND remediation to be non-null
	// -------------------------------------------------------------------------

	it("suppresses finding within cooldown when both existingFinding and remediation are present", async () => {
		const finding = makeFinding();
		// Use "resolved" status so deduplication returns null (passes through to cooldown check)
		const resolvedFinding: AutomationFinding = { ...finding, status: "resolved" };
		const recentRemediation = makeRemediation(
			finding.fingerprint,
			Date.now() - 1000, // 1 second ago — well within 60-minute cooldown
		);

		store = makeMockStore({
			countTasksCreatedInWindow: vi.fn().mockResolvedValue(0),
			countAutoStartsInWindow: vi.fn().mockResolvedValue(0),
			countGlobalTasksCreatedInWindow: vi.fn().mockResolvedValue(0),
			countGlobalAutoStartsInWindow: vi.fn().mockResolvedValue(0),
			getFinding: vi.fn().mockResolvedValue(resolvedFinding),
			getRemediation: vi.fn().mockResolvedValue(recentRemediation),
		});
		engine = new GuardrailEngine(store);

		const decisions = await engine.evaluateFindings([finding], instance, template, policy, 1);

		expect(decisions[0]?.action).toBe("suppress");
	});

	it("allows create_task when remediation is beyond the cooldown window", async () => {
		const finding = makeFinding();
		const resolvedFinding: AutomationFinding = { ...finding, status: "resolved" };
		const oldRemediation = makeRemediation(
			finding.fingerprint,
			Date.now() - 4 * 60 * 60 * 1000, // 4 hours ago — beyond the 60-minute cooldown
		);

		store = makeMockStore({
			countTasksCreatedInWindow: vi.fn().mockResolvedValue(0),
			countAutoStartsInWindow: vi.fn().mockResolvedValue(0),
			countGlobalTasksCreatedInWindow: vi.fn().mockResolvedValue(0),
			countGlobalAutoStartsInWindow: vi.fn().mockResolvedValue(0),
			getFinding: vi.fn().mockResolvedValue(resolvedFinding),
			getRemediation: vi.fn().mockResolvedValue(oldRemediation),
		});
		engine = new GuardrailEngine(store);

		const decisions = await engine.evaluateFindings([finding], instance, template, policy, 1);

		expect(decisions[0]?.action).toBe("create_task");
	});

	// -------------------------------------------------------------------------
	// Global budget cap
	// -------------------------------------------------------------------------

	it("suppresses when global tasks-created-in-window exceeds the global cap", async () => {
		store = makeMockStore({
			countTasksCreatedInWindow: vi.fn().mockResolvedValue(0),
			countAutoStartsInWindow: vi.fn().mockResolvedValue(0),
			// Global count well above the GLOBAL_MAX_TASKS_PER_HOUR = 20 limit
			countGlobalTasksCreatedInWindow: vi.fn().mockResolvedValue(GLOBAL_MAX_TASKS_PER_HOUR),
			countGlobalAutoStartsInWindow: vi.fn().mockResolvedValue(0),
			getFinding: vi.fn().mockResolvedValue(null),
			getRemediation: vi.fn().mockResolvedValue(null),
		});
		engine = new GuardrailEngine(store);

		const findings = [makeFinding()];
		const decisions = await engine.evaluateFindings(findings, instance, template, policy, 1);

		expect(decisions[0]?.action).toBe("suppress");
	});

	// -------------------------------------------------------------------------
	// resetForScan clears in-scan counters
	// -------------------------------------------------------------------------

	it("resetForScan clears state so the second scan evaluates fresh", async () => {
		store = makeMockStore({
			countTasksCreatedInWindow: vi.fn().mockResolvedValue(0),
			countAutoStartsInWindow: vi.fn().mockResolvedValue(0),
			countGlobalTasksCreatedInWindow: vi.fn().mockResolvedValue(0),
			countGlobalAutoStartsInWindow: vi.fn().mockResolvedValue(0),
			// Return null on every call so dedup/cooldown don't fire
			getFinding: vi.fn().mockResolvedValue(null),
			getRemediation: vi.fn().mockResolvedValue(null),
		});
		engine = new GuardrailEngine(store);

		// First scan
		await engine.evaluateFindings([makeFinding()], instance, template, policy, 1);

		// Reset and verify a fresh scan can create_task again
		engine.resetForScan();

		const decisions = await engine.evaluateFindings([makeFinding()], instance, template, policy, 1);

		expect(decisions[0]?.action).toBe("create_task");
	});
});
