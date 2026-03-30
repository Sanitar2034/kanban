/**
 * automations-api.ts — TRPC handler functions for the Automation Agents platform.
 *
 * Delegates to the AutomationService singleton.  Returns plain serialisable
 * objects so the router stays thin.
 */
import type { AutomationService } from "../automations/automation-service";
import type { AutomationInstancePolicyOverrides } from "../automations/automation-types";
import { templateRegistry } from "../automations/template-registry";

export interface CreateAutomationsApiDependencies {
	getAutomationService: () => AutomationService;
}

export function createAutomationsApi(deps: CreateAutomationsApiDependencies) {
	const svc = () => deps.getAutomationService();

	return {
		// -----------------------------------------------------------------------
		// Templates
		// -----------------------------------------------------------------------

		/** List all registered agent templates. */
		listTemplates() {
			return templateRegistry.listTemplates();
		},

		// -----------------------------------------------------------------------
		// Instances
		// -----------------------------------------------------------------------

		/** List all instances (across all templates). */
		async listInstances() {
			return svc().listInstances();
		},

		/** Get a single instance by ID. */
		async getInstance(id: string) {
			const instance = await svc().getInstance(id);
			if (!instance) {
				throw new Error(`Automation instance "${id}" not found.`);
			}
			return instance;
		},

		/** Create a new instance of a template. */
		async createInstance(input: {
			templateId: string;
			label: string;
			projectPaths: string[];
			policyOverrides?: AutomationInstancePolicyOverrides;
		}) {
			return svc().createInstance(input);
		},

		/** Update an existing instance's label, projectPaths, or policyOverrides. */
		async updateInstance(
			id: string,
			updates: { label?: string; projectPaths?: string[]; policyOverrides?: AutomationInstancePolicyOverrides },
		) {
			return svc().updateInstance(id, updates);
		},

		/** Enable an instance (start scanning). */
		async enableInstance(id: string) {
			return svc().enableInstance(id);
		},

		/** Disable an instance (stop scanning). */
		async disableInstance(id: string) {
			return svc().disableInstance(id);
		},

		/** Delete an instance and all its data. */
		async deleteInstance(id: string) {
			await svc().deleteInstance(id);
		},

		/** Trigger an immediate scan for an instance. */
		async triggerScan(instanceId: string) {
			await svc().triggerScan(instanceId);
			return { queued: true };
		},

		// -----------------------------------------------------------------------
		// Findings
		// -----------------------------------------------------------------------

		/** List findings, optionally filtered by instance. */
		async listFindings(instanceId?: string) {
			return svc().listFindings(instanceId);
		},

		/** Suppress a finding by fingerprint. */
		async suppressFinding(fingerprint: string) {
			await svc().suppressFinding(fingerprint);
		},

		// -----------------------------------------------------------------------
		// Audit + runs
		// -----------------------------------------------------------------------

		/** List audit events, optionally filtered by instance. */
		async listAuditEvents(instanceId?: string) {
			return svc().listAuditEvents(instanceId);
		},

		/** List scan runs, optionally filtered by instance. */
		async listScanRuns(instanceId?: string) {
			return svc().listScanRuns(instanceId);
		},
	};
}

export type AutomationsApi = ReturnType<typeof createAutomationsApi>;
