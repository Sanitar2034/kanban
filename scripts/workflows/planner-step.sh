#!/usr/bin/env bash
# planner-step.sh — Generic planner step for multi-step agentic workflow cards.
#
# Each execution of this script corresponds to one iteration of a workflow.
# It reads the workflow state and policy files, enforces policy gates, writes
# an iteration artifact directory, updates the Kanban board card's workflowState
# via the CLI, and schedules the next step.
#
# Usage:
#   planner-step.sh <task-id> <workspace-path> <db-url> <state-file> <policy-file>
#
# Arguments:
#   task-id        Kanban board card task ID
#   workspace-path Absolute path to the task's git worktree
#   db-url         Job queue SQLite URL (e.g. sqlite:///home/user/.kanban/job-queue/jobs.db)
#   state-file     Path to the JSON state file (absolute)
#   policy-file    Path to the JSON policy file (absolute)
#
# Environment:
#   KANBAN_RUNTIME_URL  Override for the Kanban runtime HTTP URL (default: http://localhost:3998)
#   KANBAN_LOG_LEVEL    Set to "debug" for verbose output (default: info)
#
# Exit codes:
#   0  Step completed; next iteration scheduled (or workflow finished)
#   1  Fatal error — workflow stops but does not reschedule
#   2  Policy gate triggered — workflow stopped cleanly
#
# Self-rescheduling:
#   On success the script calls `job_queue schedule --due-in <intervalSeconds>s`
#   to enqueue the next iteration.  Workers that pick up the batch queue will
#   execute the next step automatically.
#
set -euo pipefail

# ─── Arguments ───────────────────────────────────────────────────────────────

TASK_ID="${1:?task-id is required}"
WORKSPACE_PATH="${2:?workspace-path is required}"
DB_URL="${3:?db-url is required}"
STATE_FILE="${4:?state-file is required}"
POLICY_FILE="${5:?policy-file is required}"

KANBAN_RUNTIME_URL="${KANBAN_RUNTIME_URL:-http://localhost:3998}"
LOG_LEVEL="${KANBAN_LOG_LEVEL:-info}"

# ─── Helpers ─────────────────────────────────────────────────────────────────

log() {
  local level="$1"; shift
  if [ "$level" = "debug" ] && [ "$LOG_LEVEL" != "debug" ]; then return; fi
  printf "[planner-step] [%s] [%s] %s\n" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$level" "$*" >&2
}

die() {
  log "error" "$*"
  exit 1
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "Required command not found: $1"
}

require_cmd jq
require_cmd job_queue

# ─── Load state and policy ────────────────────────────────────────────────────

[ -f "$STATE_FILE" ]  || die "State file not found: $STATE_FILE"
[ -f "$POLICY_FILE" ] || die "Policy file not found: $POLICY_FILE"

STATE=$(cat "$STATE_FILE")
POLICY=$(cat "$POLICY_FILE")

ITER=$(echo "$STATE"  | jq '.iteration // 0')
MAX_ITER=$(echo "$POLICY" | jq '.maxIterations // 10')
INTERVAL=$(echo "$POLICY" | jq '.intervalSeconds // 120')
DEADLINE_MINUTES=$(echo "$POLICY" | jq -r '.deadlineMinutes // empty')
ALLOW_CODE_EDITS=$(echo "$POLICY" | jq '.allowCodeEdits // false')
REQUIRE_VERIFY=$(echo "$POLICY" | jq '.requireVerification // true')

# Derive deadline timestamp from state if it exists, else from policy + now
START_TS=$(echo "$STATE" | jq -r '.lastStepAt // empty')
DEADLINE_TS=""
if [ -n "$DEADLINE_MINUTES" ] && [ -n "$START_TS" ]; then
  DEADLINE_TS=$(( START_TS / 1000 + DEADLINE_MINUTES * 60 ))
fi

ITER=$((ITER + 1))
NOW_SECS=$(date +%s)
NOW_MS=$((NOW_SECS * 1000))

log "info" "Starting iteration $ITER / $MAX_ITER for task $TASK_ID"
log "debug" "policy: maxIterations=$MAX_ITER intervalSeconds=$INTERVAL allowCodeEdits=$ALLOW_CODE_EDITS requireVerification=$REQUIRE_VERIFY"

# ─── Policy gate: max iterations ─────────────────────────────────────────────

if [ "$ITER" -gt "$MAX_ITER" ]; then
  log "info" "Reached max iterations ($MAX_ITER). Marking workflow as completed."
  NEW_STATE=$(echo "$STATE" | jq ".iteration=$ITER | .status=\"completed\" | .lastStepAt=$NOW_MS | .nextDueAt=null | .currentJobId=null")
  echo "$NEW_STATE" > "$STATE_FILE"
  _update_workflow_state "completed" "$ITER" "" ""
  exit 2
fi

# ─── Policy gate: deadline ────────────────────────────────────────────────────

if [ -n "$DEADLINE_TS" ] && [ "$NOW_SECS" -gt "$DEADLINE_TS" ]; then
  log "info" "Deadline reached (deadline=$DEADLINE_TS, now=$NOW_SECS). Marking workflow as stopped."
  NEW_STATE=$(echo "$STATE" | jq ".iteration=$ITER | .status=\"stopped\" | .lastStepAt=$NOW_MS | .nextDueAt=null | .currentJobId=null")
  echo "$NEW_STATE" > "$STATE_FILE"
  _update_workflow_state "stopped" "$ITER" "" ""
  exit 2
fi

# ─── Artifact directory for this iteration ────────────────────────────────────

ART_DIR="${WORKSPACE_PATH}/.kanban-workflows/${TASK_ID}/iter-${ITER}"
mkdir -p "$ART_DIR"
PLAN_FILE="${ART_DIR}/plan.md"
EXEC_FILE="${ART_DIR}/exec.md"
VERIFY_FILE="${ART_DIR}/verify.md"

log "debug" "Artifact directory: $ART_DIR"

# ─── Plan step ────────────────────────────────────────────────────────────────

log "info" "Writing plan stub for iteration $ITER"
{
  printf "# Workflow Plan — Iteration %d\n\n" "$ITER"
  printf "**Task ID:** %s\n" "$TASK_ID"
  printf "**Timestamp:** %s\n" "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf "**Workspace:** %s\n\n" "$WORKSPACE_PATH"
  printf "## Context\n\n"
  # Gather lightweight context: git status, recent commits
  if command -v git >/dev/null 2>&1 && [ -d "$WORKSPACE_PATH/.git" ] || [ -f "$WORKSPACE_PATH/.git" ]; then
    printf "### Git Status\n\n\`\`\`\n"
    git -C "$WORKSPACE_PATH" status --short 2>/dev/null || true
    printf "\`\`\`\n\n"
    printf "### Recent Commits\n\n\`\`\`\n"
    git -C "$WORKSPACE_PATH" log --oneline -5 2>/dev/null || true
    printf "\`\`\`\n\n"
  fi
  printf "## Plan\n\n"
  printf "_Planner output will be written here by the agent step._\n"
} > "$PLAN_FILE"

# ─── Exec step ────────────────────────────────────────────────────────────────

log "info" "Writing exec stub for iteration $ITER"
{
  printf "# Workflow Exec — Iteration %d\n\n" "$ITER"
  printf "**Task ID:** %s\n" "$TASK_ID"
  printf "**Timestamp:** %s\n" "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  if [ "$ALLOW_CODE_EDITS" = "true" ]; then
    printf "**Code edits:** allowed\n\n"
  else
    printf "**Code edits:** read-only\n\n"
  fi
  printf "## Output\n\n"
  printf "_Exec output will be written here by the agent step._\n"
} > "$EXEC_FILE"

# ─── Verify step (if required) ────────────────────────────────────────────────

if [ "$REQUIRE_VERIFY" = "true" ]; then
  log "info" "Writing verify stub for iteration $ITER"
  {
    printf "# Workflow Verify — Iteration %d\n\n" "$ITER"
    printf "**Task ID:** %s\n" "$TASK_ID"
    printf "**Timestamp:** %s\n\n" "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    printf "## Verification Result\n\n"
    printf "_Verification output will be written here by the agent step._\n"
  } > "$VERIFY_FILE"
fi

# ─── Update state file ────────────────────────────────────────────────────────

NEXT_DUE_MS=$(( (NOW_SECS + INTERVAL) * 1000 ))

ARTIFACTS=$(echo "$STATE" | jq '.artifacts // []')
ARTIFACTS=$(echo "$ARTIFACTS" | jq \
  --argjson iter "$ITER" \
  --arg plan  "$(realpath --relative-to="$WORKSPACE_PATH" "$PLAN_FILE" 2>/dev/null || echo "$PLAN_FILE")" \
  --arg exec  "$(realpath --relative-to="$WORKSPACE_PATH" "$EXEC_FILE" 2>/dev/null || echo "$EXEC_FILE")" \
  --arg now   "$NOW_MS" \
  '. + [
    {"iteration": $iter, "type": "plan",   "path": $plan, "createdAt": ($now | tonumber)},
    {"iteration": $iter, "type": "exec",   "path": $exec, "createdAt": ($now | tonumber)}
  ]')

if [ "$REQUIRE_VERIFY" = "true" ]; then
  VERIFY_REL=$(realpath --relative-to="$WORKSPACE_PATH" "$VERIFY_FILE" 2>/dev/null || echo "$VERIFY_FILE")
  ARTIFACTS=$(echo "$ARTIFACTS" | jq \
    --argjson iter "$ITER" \
    --arg path "$VERIFY_REL" \
    --arg now  "$NOW_MS" \
    '. + [{"iteration": $iter, "type": "verify", "path": $path, "createdAt": ($now | tonumber)}]')
fi

NEW_STATE=$(echo "$STATE" | jq \
  --argjson iter     "$ITER" \
  --argjson nextDue  "$NEXT_DUE_MS" \
  --argjson now      "$NOW_MS" \
  --argjson arts     "$ARTIFACTS" \
  '.iteration=$iter | .status="running" | .lastStepAt=$now | .nextDueAt=$nextDue | .artifacts=$arts')

echo "$NEW_STATE" > "$STATE_FILE"
log "debug" "State written to $STATE_FILE"

# ─── Notify Kanban via CLI ────────────────────────────────────────────────────

_update_workflow_state() {
  local status="$1" iter="$2" next_due="$3" job_id="$4"
  # Fire-and-forget — don't block or fail the step on TRPC errors
  kanban task update-workflow-state \
    --task-id    "$TASK_ID" \
    --status     "$status" \
    --iteration  "$iter" \
    --next-due-at "$next_due" \
    --current-job-id "$job_id" \
    2>/dev/null || true
}

_update_workflow_state "running" "$ITER" "$NEXT_DUE_MS" ""

# ─── Schedule next iteration ──────────────────────────────────────────────────

QUEUE="kanban.workflow.${TASK_ID}.plan"
SCRIPT_PATH="$(realpath "$0")"

NEXT_JOB_ID=$(job_queue \
  --database-url "$DB_URL" \
  schedule \
  --queue        "$QUEUE" \
  --due-in       "${INTERVAL}s" \
  --command      "$SCRIPT_PATH" \
  --arg          "$TASK_ID" \
  --arg          "$WORKSPACE_PATH" \
  --arg          "$DB_URL" \
  --arg          "$STATE_FILE" \
  --arg          "$POLICY_FILE" \
  2>/dev/null) || NEXT_JOB_ID=""

if [ -n "$NEXT_JOB_ID" ]; then
  # Strip leading "scheduled job " prefix if present
  NEXT_JOB_ID="${NEXT_JOB_ID#scheduled job }"
  log "info" "Next iteration scheduled (job $NEXT_JOB_ID) in ${INTERVAL}s on queue $QUEUE"
  # Update state with the new job ID
  NEW_STATE=$(echo "$NEW_STATE" | jq --arg jid "$NEXT_JOB_ID" '.currentJobId=$jid')
  echo "$NEW_STATE" > "$STATE_FILE"
  _update_workflow_state "running" "$ITER" "$NEXT_DUE_MS" "$NEXT_JOB_ID"
else
  log "warn" "Could not schedule next iteration — job queue may be unavailable"
fi

log "info" "Iteration $ITER complete."
exit 0
