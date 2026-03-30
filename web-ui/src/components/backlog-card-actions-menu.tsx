/**
 * BacklogCardActionsMenu — floating context menu for backlog cards.
 *
 * Triggered by right-click or the ⋯ button on the card. Provides:
 *  - Schedule Task → opens ScheduleTaskDialog
 *  - Start Workflow → opens NewWorkflowDialog
 *  - Auto-start when ready toggle (for cards with dependencies)
 *  - Separator
 *  - Trash card
 *
 * This component manages only the menu/dialog rendering. The parent (board-card
 * or kanban-column) owns the TRPC calls passed in as callbacks.
 */

import type { RuntimeWorkflowPolicy } from "@runtime-contract";
import { useEffect, useRef, useState } from "react";
import { NewWorkflowDialog } from "./new-workflow-dialog";
import { ScheduleTaskDialog } from "./schedule-task-dialog";
import { cn } from "./ui/cn";

export interface BacklogCardActionsMenuProps {
	taskId: string;
	taskTitle: string;
	projectPath: string;
	hasDependencies: boolean;
	autoStartWhenReady: boolean;
	/** Anchor position for the floating menu. */
	position: { x: number; y: number };
	onSchedule: (dueAtMs: number) => Promise<void>;
	onStartWorkflow: (policy: RuntimeWorkflowPolicy) => Promise<void>;
	onToggleAutoStart: () => Promise<void>;
	onTrash: () => Promise<void>;
	onClose: () => void;
}

type ActiveDialog = "schedule" | "workflow" | null;

export function BacklogCardActionsMenu({
	taskId,
	taskTitle,
	projectPath,
	hasDependencies,
	autoStartWhenReady,
	position,
	onSchedule,
	onStartWorkflow,
	onToggleAutoStart,
	onTrash,
	onClose,
}: BacklogCardActionsMenuProps) {
	const menuRef = useRef<HTMLDivElement>(null);
	const [activeDialog, setActiveDialog] = useState<ActiveDialog>(null);

	// Close on outside click / Escape
	useEffect(() => {
		function handleKey(e: KeyboardEvent) {
			if (e.key === "Escape") onClose();
		}
		function handleClick(e: MouseEvent) {
			if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
				onClose();
			}
		}
		document.addEventListener("keydown", handleKey);
		document.addEventListener("mousedown", handleClick);
		return () => {
			document.removeEventListener("keydown", handleKey);
			document.removeEventListener("mousedown", handleClick);
		};
	}, [onClose]);

	// If a sub-dialog is open, render that instead
	if (activeDialog === "schedule") {
		return <ScheduleTaskDialog taskId={taskId} taskTitle={taskTitle} onSchedule={onSchedule} onClose={onClose} />;
	}
	if (activeDialog === "workflow") {
		return (
			<NewWorkflowDialog
				taskId={taskId}
				taskTitle={taskTitle}
				projectPath={projectPath}
				onStart={onStartWorkflow}
				onClose={onClose}
			/>
		);
	}

	return (
		<div
			ref={menuRef}
			style={{ left: position.x, top: position.y }}
			className={cn(
				"fixed z-50 min-w-[180px] rounded-lg shadow-xl",
				"border border-neutral-700 bg-neutral-900 py-1",
			)}
		>
			{/* Schedule */}
			<button
				type="button"
				className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-neutral-200 hover:bg-neutral-800 transition-colors text-left"
				onClick={() => setActiveDialog("schedule")}
			>
				<svg
					width="13"
					height="13"
					viewBox="0 0 16 16"
					fill="none"
					stroke="currentColor"
					strokeWidth="1.5"
					strokeLinecap="round"
					aria-hidden="true"
				>
					<circle cx="8" cy="8" r="6.5" />
					<path d="M8 4.5V8l2.5 1.5" />
				</svg>
				Schedule Task…
			</button>

			{/* Start Workflow */}
			<button
				type="button"
				className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-neutral-200 hover:bg-neutral-800 transition-colors text-left"
				onClick={() => setActiveDialog("workflow")}
			>
				<svg
					width="13"
					height="13"
					viewBox="0 0 16 16"
					fill="none"
					stroke="currentColor"
					strokeWidth="1.5"
					strokeLinecap="round"
					aria-hidden="true"
				>
					<path d="M3 4h2M8 4h2M13 4h1M1 8h4M7 8h2M13 8h1M3 12h2M8 12h2M13 12h1" />
					<circle cx="5.5" cy="4" r="1.5" fill="currentColor" stroke="none" />
					<circle cx="10.5" cy="8" r="1.5" fill="currentColor" stroke="none" />
					<circle cx="5.5" cy="12" r="1.5" fill="currentColor" stroke="none" />
				</svg>
				Start Workflow…
			</button>

			{/* Auto-start toggle (only for cards with dependencies) */}
			{hasDependencies && (
				<button
					type="button"
					className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-neutral-200 hover:bg-neutral-800 transition-colors text-left"
					onClick={async () => {
						await onToggleAutoStart();
						onClose();
					}}
				>
					<span
						className={cn(
							"inline-flex h-3.5 w-6 rounded-full transition-colors shrink-0",
							autoStartWhenReady ? "bg-blue-500" : "bg-neutral-600",
						)}
					>
						<span
							className={cn(
								"m-0.5 h-2.5 w-2.5 rounded-full bg-white transition-transform",
								autoStartWhenReady ? "translate-x-2.5" : "translate-x-0",
							)}
						/>
					</span>
					Auto-start when ready
				</button>
			)}

			<div className="h-px bg-neutral-800 my-1" />

			{/* Trash */}
			<button
				type="button"
				className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-red-400 hover:bg-neutral-800 hover:text-red-300 transition-colors text-left"
				onClick={async () => {
					await onTrash();
					onClose();
				}}
			>
				<svg
					width="13"
					height="13"
					viewBox="0 0 16 16"
					fill="none"
					stroke="currentColor"
					strokeWidth="1.5"
					strokeLinecap="round"
					aria-hidden="true"
				>
					<path d="M2 4h12M5 4V2h6v2M6 7v5M10 7v5M3 4l1 9h8l1-9" />
				</svg>
				Trash
			</button>
		</div>
	);
}
