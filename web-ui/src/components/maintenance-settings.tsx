/**
 * maintenance-settings.tsx — Plan item 2.8
 *
 * Settings panel listing the three periodic maintenance jobs
 * (git-fetch-all, stale-session-checker, worktree-cleanup).  Provides a
 * "Run Now" button for each that immediately enqueues a single run via the
 * TRPC job queue API.  The script self-reschedules its next periodic run so
 * triggering it once does not disrupt the ongoing schedule.
 */
import { GitBranch, Loader2, type LucideIcon, RefreshCw, Search, Trash2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { getRuntimeTrpcClient } from "@/runtime/trpc-client";

type ScriptType = "git-fetch-all" | "stale-session-checker" | "worktree-cleanup";

interface MaintenanceJobDefinition {
	id: ScriptType;
	label: string;
	description: string;
	Icon: LucideIcon;
}

const JOBS: MaintenanceJobDefinition[] = [
	{
		id: "git-fetch-all",
		label: "Git Fetch All",
		description: "Fetches from upstream across all workspace repositories every 5 minutes.",
		Icon: GitBranch,
	},
	{
		id: "stale-session-checker",
		label: "Stale Session Checker",
		description: "Stops in-progress tasks that have been idle for more than 30 minutes.",
		Icon: Search,
	},
	{
		id: "worktree-cleanup",
		label: "Worktree Cleanup",
		description: "Removes orphaned Git worktrees for trashed tasks older than 24 hours.",
		Icon: Trash2,
	},
];

/**
 * MaintenanceSettings — rendered inside RuntimeSettingsDialog.
 *
 * Shows the three global maintenance jobs with Run Now buttons that
 * enqueue a single immediate run on the `kanban.maintenance` queue.
 */
export function MaintenanceSettings({ workspaceId }: { workspaceId: string | null }): React.ReactElement {
	const [pending, setPending] = useState<ScriptType | null>(null);
	const [lastTriggered, setLastTriggered] = useState<ScriptType | null>(null);
	const [triggerError, setTriggerError] = useState<string | null>(null);

	const handleRunNow = async (scriptType: ScriptType): Promise<void> => {
		if (pending) return;
		setPending(scriptType);
		setTriggerError(null);
		setLastTriggered(null);
		try {
			const result = await getRuntimeTrpcClient(workspaceId).jobs.triggerMaintenance.mutate({ scriptType });
			if (result.ok) {
				setLastTriggered(scriptType);
				window.setTimeout(() => setLastTriggered(null), 3000);
			} else {
				setTriggerError(result.error ?? "Unknown error");
			}
		} catch (err) {
			setTriggerError(err instanceof Error ? err.message : String(err));
		} finally {
			setPending(null);
		}
	};

	return (
		<div className="flex flex-col gap-2">
			{JOBS.map(({ id, label, description, Icon }) => {
				const isRunning = pending === id;
				const wasTriggered = lastTriggered === id;
				return (
					<div
						key={id}
						className="flex items-start justify-between gap-3 rounded-md border border-border bg-surface-2 px-3 py-2"
					>
						<div className="flex min-w-0 items-start gap-2">
							<Icon size={14} className="mt-0.5 shrink-0 text-text-secondary" />
							<div className="min-w-0">
								<p className="m-0 text-[13px] text-text-primary">{label}</p>
								<p className="m-0 mt-0.5 text-xs text-text-secondary">{description}</p>
							</div>
						</div>
						<Button
							size="sm"
							variant="ghost"
							disabled={isRunning || pending !== null}
							onClick={() => {
								void handleRunNow(id);
							}}
							className="shrink-0 gap-1 text-xs"
						>
							{isRunning ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
							{wasTriggered ? "Triggered!" : "Run Now"}
						</Button>
					</div>
				);
			})}
			{triggerError ? <p className="m-0 mt-1 text-[12px] text-status-red">{triggerError}</p> : null}
		</div>
	);
}
