/**
 * jobs-api.ts — TRPC handler functions for the job queue integration.
 *
 * These are the domain functions that the app-router delegates to.
 * They receive a dependency-injected `JobQueueService` and return plain
 * serialisable objects, keeping all business logic out of the router file.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { RuntimeWorkflowPolicy, RuntimeWorkflowState } from "../core/api-contract";
import type { JobQueueService } from "../server/job-queue-service";

export interface CreateJobsApiDependencies {
	getJobQueueService: () => JobQueueService;
}

export function createJobsApi(deps: CreateJobsApiDependencies) {
	const svc = () => deps.getJobQueueService();

	return {
		// -----------------------------------------------------------------
		// Status
		// -----------------------------------------------------------------

		/** Returns the current availability, running state, health, and inspect snapshot. */
		getStatus: async () => {
			const service = svc();
			const available = service.isAvailable();
			if (!available) {
				return { available: false, running: false, health: null, inspect: null };
			}
			const running = service.isSidecarRunning();
			if (!running) {
				return { available: true, running: false, health: null, inspect: null };
			}
			try {
				const [health, inspect] = await Promise.all([service.health(), service.inspect()]);
				return { available: true, running: true, health, inspect };
			} catch {
				// Sidecar may still be starting — return graceful partial state.
				return { available: true, running: true, health: null, inspect: null };
			}
		},

		// -----------------------------------------------------------------
		// Mutations
		// -----------------------------------------------------------------

		/** Immediately enqueue a job and return its ID. */
		enqueue: async (input: {
			command: string;
			args?: string[];
			queue?: string;
			priority?: number;
			maxAttempts?: number;
			cwd?: string;
			timeoutSecs?: number;
		}) => {
			const jobId = await svc().enqueue(input);
			return { ok: true, jobId };
		},

		/** Schedule a job for future execution and return its ID. */
		schedule: async (input: {
			command: string;
			args?: string[];
			queue?: string;
			priority?: number;
			maxAttempts?: number;
			cwd?: string;
			timeoutSecs?: number;
			dueIn?: string;
			dueAt?: number;
		}) => {
			const jobId = await svc().schedule(input);
			return { ok: true, jobId };
		},

		/** Pause a queue (workers stop claiming from it). */
		pauseQueue: async (input: { queue: string; reason?: string }) => {
			await svc().pauseQueue(input.queue, input.reason);
			return { ok: true };
		},

		/** Resume a paused queue. */
		resumeQueue: async (input: { queue: string; reason?: string }) => {
			await svc().resumeQueue(input.queue, input.reason);
			return { ok: true };
		},

		/** Replay failed jobs back to queued state. */
		replayFailed: async (input?: { queue?: string; limit?: number }) => {
			const count = await svc().replayFailed(input);
			return { ok: true, replayed: count };
		},

		// -----------------------------------------------------------------
		// Sidecar lifecycle
		// -----------------------------------------------------------------

		/** Start the sidecar process programmatically (e.g., from the UI). */
		startSidecar: async () => {
			const service = svc();
			if (!service.isAvailable()) {
				return { ok: false, error: "Binary not found. Set KANBAN_JOB_QUEUE_BINARY or build the sidecar." };
			}
			await service.startSidecar();
			return { ok: true };
		},

		/** Stop the sidecar process. */
		stopSidecar: async () => {
			await svc().stopSidecar();
			return { ok: true };
		},

		// -----------------------------------------------------------------
		// Batch operations (Project 6)
		// -----------------------------------------------------------------

		/**
		 * Enqueue a set of backlog tasks as a prioritised batch on an isolated
		 * per-batch queue.  Tasks are enqueued with descending priority so the
		 * first task in the list has the highest priority.  The job queue's worker
		 * pool provides natural concurrency control — only `concurrency` workers
		 * need to be assigned to the batch queue for strict cap enforcement.
		 */
		/**
		 * startWorkflow — initialises a multi-step agentic workflow for a board card.
		 *
		 * Writes state.json + policy.json into `.kanban-workflows/<taskId>/` inside the
		 * project workspace, then enqueues the first planner-step.sh invocation on the
		 * per-task queue `kanban.workflow.<taskId>.plan`.  The caller is responsible for
		 * updating the board card's workflowState (via task.update-workflow-state) once
		 * the jobId is known.
		 */
		startWorkflow: async (input: { taskId: string; projectPath: string; policy: RuntimeWorkflowPolicy }) => {
			const queueName = `kanban.workflow.${input.taskId}.plan`;
			const workflowDir = join(input.projectPath, ".kanban-workflows", input.taskId);
			await mkdir(workflowDir, { recursive: true });

			// Initial state
			const initialState: RuntimeWorkflowState = {
				iteration: 0,
				status: "running",
				lastStepAt: null,
				nextDueAt: null,
				currentJobId: null,
				artifacts: [],
			};
			const stateFile = join(workflowDir, "state.json");
			const policyFile = join(workflowDir, "policy.json");

			// Persist deadline into policy JSON as unix-seconds for shell scripts
			const policyForScript = {
				...input.policy,
				deadlineTs:
					input.policy.deadlineMinutes !== undefined && input.policy.deadlineMinutes !== null
						? Math.floor(Date.now() / 1000) + input.policy.deadlineMinutes * 60
						: null,
			};

			await writeFile(stateFile, JSON.stringify(initialState, null, 2), "utf8");
			await writeFile(policyFile, JSON.stringify(policyForScript, null, 2), "utf8");

			const kanbanBin = process.argv[1] ?? "kanban";
			const plannerScript = join(__dirname, "..", "..", "scripts", "workflows", "planner-step.sh");

			const jobId = await svc().schedule({
				queue: queueName,
				command: "bash",
				args: [plannerScript, input.taskId, input.projectPath, svc().getDatabaseUrl(), stateFile, policyFile],
				dueIn: "1s",
				maxAttempts: 1,
				timeoutSecs: input.policy.intervalSeconds * 2 + 60,
			});

			// Fire-and-forget: update the card's workflowState with the currentJobId
			const updateArgs = [
				kanbanBin,
				"task",
				"update-workflow-state",
				"--task-id",
				input.taskId,
				"--project-path",
				input.projectPath,
				"--status",
				"running",
				"--current-job-id",
				jobId,
			];
			void import("node:child_process").then(({ execFile }) => {
				execFile(process.execPath, updateArgs, { timeout: 10_000 }, () => null);
			});

			return { ok: true, jobId, queue: queueName, workflowDir };
		},

		/**
		 * pauseWorkflow — pauses the per-task workflow queue.
		 * The current iteration job may still finish but no new steps will be claimed.
		 */
		pauseWorkflow: async (input: { taskId: string; projectPath: string; reason?: string }) => {
			const queueName = `kanban.workflow.${input.taskId}.plan`;
			const reason = input.reason ?? "paused by user";
			await svc().pauseQueue(queueName, reason);

			const kanbanBin = process.argv[1] ?? "kanban";
			void import("node:child_process").then(({ execFile }) => {
				execFile(
					process.execPath,
					[
						kanbanBin,
						"task",
						"update-workflow-state",
						"--task-id",
						input.taskId,
						"--project-path",
						input.projectPath,
						"--status",
						"paused",
					],
					{ timeout: 10_000 },
					() => null,
				);
			});

			return { ok: true, queue: queueName };
		},

		/**
		 * resumeWorkflow — resumes a previously paused workflow queue.
		 */
		resumeWorkflow: async (input: { taskId: string; projectPath: string; reason?: string }) => {
			const queueName = `kanban.workflow.${input.taskId}.plan`;
			const reason = input.reason ?? "resumed by user";
			await svc().resumeQueue(queueName, reason);

			const kanbanBin = process.argv[1] ?? "kanban";
			void import("node:child_process").then(({ execFile }) => {
				execFile(
					process.execPath,
					[
						kanbanBin,
						"task",
						"update-workflow-state",
						"--task-id",
						input.taskId,
						"--project-path",
						input.projectPath,
						"--status",
						"running",
					],
					{ timeout: 10_000 },
					() => null,
				);
			});

			return { ok: true, queue: queueName };
		},

		/**
		 * stopWorkflow — permanently stops a workflow.  Pauses the queue and marks the
		 * card status as "stopped" so the planner-step guard exits on any pending run.
		 */
		stopWorkflow: async (input: { taskId: string; projectPath: string }) => {
			const queueName = `kanban.workflow.${input.taskId}.plan`;
			// Best-effort pause; queue may not exist if no jobs were ever enqueued.
			await svc()
				.pauseQueue(queueName, "stopped by user")
				.catch(() => null);

			const kanbanBin = process.argv[1] ?? "kanban";
			void import("node:child_process").then(({ execFile }) => {
				execFile(
					process.execPath,
					[
						kanbanBin,
						"task",
						"update-workflow-state",
						"--task-id",
						input.taskId,
						"--project-path",
						input.projectPath,
						"--status",
						"stopped",
					],
					{ timeout: 10_000 },
					() => null,
				);
			});

			return { ok: true, queue: queueName };
		},

		createBatch: async (input: { taskIds: string[]; concurrency: number; projectPath: string }) => {
			const batchId = globalThis.crypto.randomUUID().slice(0, 8);
			const queue = `kanban.batch.${batchId}`;
			const kanbanBin = process.argv[1] ?? "kanban";
			const jobIds: string[] = [];

			for (let i = 0; i < input.taskIds.length; i++) {
				const taskId = input.taskIds[i];
				// Priority descends so earlier tasks in the list are processed first.
				const priority = input.taskIds.length - i;
				const jobId = await svc().enqueue({
					queue,
					priority,
					command: process.execPath,
					args: [kanbanBin, "task", "start", "--task-id", taskId, "--project-path", input.projectPath],
					maxAttempts: 2,
					timeoutSecs: 7200,
				});
				jobIds.push(jobId);
			}

			return {
				ok: true,
				batchId,
				queue,
				jobIds,
				taskCount: input.taskIds.length,
				concurrency: input.concurrency,
			};
		},
	};
}

export type JobsApi = ReturnType<typeof createJobsApi>;
