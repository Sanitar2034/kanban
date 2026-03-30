/**
 * Maintenance job seeding for the Kanban job queue.
 *
 * These jobs are scheduled once at server startup and re-scheduled by the
 * scripts they invoke so that they recur on the desired cadence.  They are
 * idempotent — duplicate scheduling is harmless because the job queue
 * deduplicates by content hash internally.
 *
 * Jobs use the "maintenance" queue so that they are isolated from
 * user-visible "scheduled-tasks" and do not consume worker capacity that is
 * needed for task execution.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getJobQueueDatabaseUrl } from "../core/job-queue-paths";
import { listWorkspaceIndexEntries } from "../state/workspace-state";
import type { JobQueueService } from "./job-queue-service";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MaintenanceJobOptions {
	/** Number of worker threads available in the sidecar.  Affects how many
	 *  concurrent maintenance jobs are allowed.  Default: 2. */
	maxMaintenanceWorkers?: number;
}

// ---------------------------------------------------------------------------
// Job definitions
// ---------------------------------------------------------------------------

interface MaintenanceSeed {
	/** Human-readable name for log messages. */
	name: string;
	/** Delay from now until first run.  Uses job_queue `--due-in` format. */
	dueIn: string;
	/** The command to run (absolute path or PATH-resolvable binary). */
	command: string;
	/** Additional arguments passed to the command. */
	args: string[];
	/** Queue to use.  Defaults to "maintenance". */
	queue?: string;
	/** Maximum attempts before the job is failed-permanently.  Default: 1. */
	maxAttempts?: number;
	/** Wall-clock timeout in seconds.  Default: 300 (5 minutes). */
	timeoutSecs?: number;
}

/**
 * Returns the set of recurring maintenance jobs to seed.
 * The kanban binary path is resolved from the calling process so that the
 * same version that started the server runs the maintenance scripts.
 */
function buildMaintenanceSeeds(kanbanBin: string): MaintenanceSeed[] {
	return [
		// -----------------------------------------------------------------------
		// 1. Replay recently-failed scheduled-task jobs.
		//    Runs 15 minutes after startup, then every hour (the script
		//    re-schedules itself with --due-in 1h).
		// -----------------------------------------------------------------------
		{
			name: "replay-failed-scheduled-tasks",
			dueIn: "15m",
			command: process.execPath,
			args: [kanbanBin, "maintenance", "replay-failed", "--queue", "scheduled-tasks", "--limit", "50"],
			queue: "maintenance",
			maxAttempts: 1,
			timeoutSecs: 120,
		},
		// -----------------------------------------------------------------------
		// 2. Log a job-queue health snapshot.
		//    Runs 5 minutes after startup, then every 30 minutes.
		// -----------------------------------------------------------------------
		{
			name: "health-snapshot",
			dueIn: "5m",
			command: process.execPath,
			args: [kanbanBin, "maintenance", "health-snapshot"],
			queue: "maintenance",
			maxAttempts: 1,
			timeoutSecs: 30,
		},
	];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Resolve the scripts/maintenance directory bundled alongside this file. */
function getMaintenanceScriptsDir(): string {
	// In a compiled build, this module is at dist/server/maintenance-jobs.js;
	// the scripts live at ../../scripts/maintenance/ relative to the package root.
	// In dev/ts-node, __filename gives the actual source path.
	try {
		const base = dirname(fileURLToPath(import.meta.url));
		// Walk up to repo root (src/server → src → repo root) then into scripts/
		return join(base, "..", "..", "scripts", "maintenance");
	} catch {
		// Fallback for CommonJS environments
		return join(__dirname, "..", "..", "scripts", "maintenance");
	}
}

/**
 * Seed periodic maintenance jobs into the job queue.
 *
 * This is called once after the sidecar has started.  It is intentionally
 * fire-and-forget: failures are logged but do not propagate.
 */
export async function seedMaintenanceJobs(
	service: JobQueueService,
	_options: MaintenanceJobOptions = {},
): Promise<void> {
	if (!service.isAvailable() || !service.isSidecarRunning()) {
		return;
	}

	const kanbanBin = process.argv[1] ?? "kanban";
	const seeds = buildMaintenanceSeeds(kanbanBin);

	for (const seed of seeds) {
		try {
			await service.schedule({
				command: seed.command,
				args: seed.args,
				queue: seed.queue ?? "maintenance",
				dueIn: seed.dueIn,
				maxAttempts: seed.maxAttempts ?? 1,
				timeoutSecs: seed.timeoutSecs ?? 300,
			});
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			process.stderr.write(`[job-queue] maintenance seed "${seed.name}" failed: ${msg}\n`);
		}
	}
}

/**
 * Seed per-project automation jobs (dependency auto-start watcher,
 * git-fetch-all, stale-session-checker, worktree-cleanup).
 *
 * One watcher job is seeded per indexed project.  Existing jobs for the
 * same project are not duplicated — the job queue deduplicates by content.
 *
 * Fire-and-forget: failures are logged but do not propagate.
 */
export async function seedProjectAutomationJobs(service: JobQueueService, runtimeUrl: string): Promise<void> {
	if (!service.isAvailable() || !service.isSidecarRunning()) {
		return;
	}

	const dbUrl = getJobQueueDatabaseUrl();
	const scriptsDir = getMaintenanceScriptsDir();

	// ── Global maintenance scripts (one instance total) ──────────────────────
	const globalScripts: Array<{
		name: string;
		script: string;
		args: string[];
		dueIn: string;
		intervalSecs: number;
		queue: string;
	}> = [
		{
			name: "git-fetch-all",
			script: join(scriptsDir, "git-fetch-all.sh"),
			args: [runtimeUrl, dbUrl, "300", "0"],
			dueIn: "2m",
			intervalSecs: 300,
			queue: "kanban.maintenance",
		},
		{
			name: "stale-session-checker",
			script: join(scriptsDir, "stale-session-checker.sh"),
			args: [runtimeUrl, dbUrl, "300", "30"],
			dueIn: "3m",
			intervalSecs: 300,
			queue: "kanban.maintenance",
		},
		{
			name: "worktree-cleanup",
			script: join(scriptsDir, "worktree-cleanup.sh"),
			args: [runtimeUrl, dbUrl, "3600", "24"],
			dueIn: "10m",
			intervalSecs: 3600,
			queue: "kanban.maintenance",
		},
	];

	for (const gs of globalScripts) {
		try {
			await service.schedule({
				command: gs.script,
				args: gs.args,
				queue: gs.queue,
				dueIn: gs.dueIn,
				maxAttempts: 1,
				timeoutSecs: 600,
			});
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			process.stderr.write(`[job-queue] global automation seed "${gs.name}" failed: ${msg}\n`);
		}
	}

	// ── Per-project dependency auto-start watcher ─────────────────────────────
	const indexEntries = await listWorkspaceIndexEntries().catch(() => []);
	const autoStartScript = join(scriptsDir, "dependency-auto-start.sh");

	for (const entry of indexEntries) {
		const projectPath = entry.repoPath;
		if (!projectPath) {
			continue;
		}
		try {
			await service.schedule({
				command: autoStartScript,
				args: [runtimeUrl, dbUrl, "30", projectPath, "2"],
				queue: "kanban.automation",
				dueIn: "30s",
				maxAttempts: 1,
				timeoutSecs: 60,
			});
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			process.stderr.write(`[job-queue] dependency-auto-start seed for "${projectPath}" failed: ${msg}\n`);
		}
	}
}
