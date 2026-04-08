# Multi-Window Review Stuck In Progress Investigation

## Problem summary

When the same Kanban workspace is open in multiple windows, a task can reach `Review` in one window while remaining stuck in `In Progress` in another.

The strongest repro does not require any manual drag or click interaction:

1. Open the same workspace in two Kanban windows.
2. Keep the same task visible in `In Progress` in both.
3. Let the task finish naturally and become ready for review.
4. Observe:
   - one window moves the task to `Review`
   - the other window stays stuck with the task in `In Progress`

The lagging window does not reliably self-correct.

## Confirmed behavior

- This is not just a clickability problem.
- The cleaner failure is cross-window board divergence:
  - Window A: task transitions to `Review`
  - Window B: task remains in `In Progress`
- The earlier "review card is visible but not clickable" symptom is likely a related secondary failure after partial sync, not the core bug.

## Code path involved

The `In Progress` -> `Review` transition is triggered from task session state, not from a normal manual drag.

Relevant path:

- `web-ui/src/hooks/use-board-interactions.ts`
  - When a session summary becomes `awaiting_review` and the task is currently in `in_progress`, the hook calls `tryProgrammaticCardMove(taskId, "in_progress", "review")`.
  - If that returns `"started"` or `"blocked"`, the hook does **not** apply the direct `moveTaskToColumn(..., "review")` fallback.
  - It assumes the DnD-driven move will complete.

- `web-ui/src/components/kanban-board.tsx`
  - `requestProgrammaticCardMove(...)` starts a synthetic DnD move using `@hello-pangea/dnd`.
  - The board relies on that programmatic move to finish cleanly and eventually reach normal drag end handling.

- `web-ui/src/hooks/use-workspace-persistence.ts`ca

- `web-ui/src/hooks/use-workspace-sync.ts`
  - Visible windows refresh workspace state when snapshots/visibility conditions change.

## Likely root cause

The lagging window can get stranded in an intermediate "programmatic move started" state.

More specifically:

1. Session state changes to `awaiting_review`.
2. `useBoardInteractions` starts a programmatic move.
3. Because the move reports `"started"` or `"blocked"`, the direct board-state fallback is skipped.
4. The local window now depends entirely on the DnD lifecycle to finish.
5. In some multi-window cases, that DnD lifecycle does not complete in one window.
6. Since the board mutation was never applied directly, that window remains stuck in `In Progress`.

This explains the easy repro better than a pure sync-delay theory.

## Why the earlier stale-drag cleanup is not sufficient

A previous local patch (never merged) added cleanup when board data already showed that the task had landed in a different column.

That hardening helps with a narrower case:

- the lagging window eventually receives the updated board state
- but stale drag/programmatic state remains locally
- review cards can become unclickable until stale state is cleared

It does **not** solve the stronger repro described above, because:

- in the broken window, `data.columns` may never change to `review`
- if board data never changes, stale drag cleanup never fires
- the task stays stuck in `In Progress`

Conclusion:

- stale drag cleanup is still useful hardening (and is included in the Option 2 implementation below)
- it is not the primary fix for the confirmed repro

## Solution options and tradeoffs

### Option 1: Add a timeout-based recovery fallback for programmatic review moves

Idea:

- When `tryProgrammaticCardMove(..., "in_progress", "review")` returns `"started"` or `"blocked"`, start a short timer.
- If the task is still in `In Progress` after the timer expires, force `moveTaskToColumn(..., "review")`.

Pros:

- Smallest targeted fix.
- Preserves the current animation path when it works.
- Directly addresses the "stuck forever" failure mode.

Cons:

- Adds recovery logic on top of a brittle lifecycle rather than simplifying it.
- Needs careful cancellation so a successful drag does not race with the fallback.
- Can produce occasional visual snapping if the timer fires after partial animation.

Risk level:

- Low to medium.
- Good short-term fix if we want minimal code churn.

### Option 2: Make board-state transition authoritative and animation best-effort

Idea:

- Move the task in board state immediately when session state says `awaiting_review`.
- Treat the animation as optional polish instead of the only mechanism that commits the move.

Pros:

- Strongest correctness model.
- Multi-window sync becomes much safer because correctness no longer depends on DnD completion.
- Easier to reason about than "move only if synthetic drag finishes".

Cons:

- Bigger behavioral refactor.
- Existing programmatic DnD flow may need to be rethought or reduced.
- Can change the current motion behavior in subtle ways.

Risk level:

- Medium.
- Best long-term shape if we want correctness over animation coupling.

**Implementation notes (resolved):**

The animation can still be attempted even after the direct board move because `latestDataRef.current` in `kanban-board.tsx` is updated via a `useEffect` that runs after the render triggered by `setBoard`. When `tryProgrammaticCardMove` is called synchronously inside the `setBoard` callback, `latestDataRef.current` still reflects the pre-move state, so `requestProgrammaticCardMove` can find the card and start the animation. The animation's eventual drop becomes a no-op.

A guard in `applyDragResult` is required as a companion: `if (!movedCard || movedCard.id !== result.draggableId) return { board }`. Without it, if the animation drop fires after the board state has already moved the task, the card at `source.index` may be a different task, causing an incorrect column move.

The stale-drag cleanup useEffect in `kanban-board.tsx` is also included as secondary hardening: it detects when `data.columns` already shows the task at its destination while local drag state is still active, and clears `dragOccurredRef.current` so card clicks are not blocked if the DnD lifecycle never delivers `onDragEnd`.

The `review → in_progress` transition (session goes back to `running`) uses the identical code pattern and receives the same fix.

### Option 3: Add reconciliation on workspace hydration / sync

Idea:

- When applying streamed or refreshed workspace state, reconcile board columns with session summaries.
- If a task session is `awaiting_review` but the board still says `in_progress`, move it to `review`.

Pros:

- Strong multi-window safety net.
- Helps stale windows recover after sync even if a local animation got stranded.

Cons:

- Duplicates transition logic across sync and interaction paths.
- Risks masking the real lifecycle bug instead of fixing it.
- Can create more hidden coupling between runtime session state and board hydration.

Risk level:

- Medium.
- Useful as a secondary guard, not ideal as the only fix.

### Option 4: Stop using programmatic DnD for this transition

Idea:

- Replace synthetic DnD for session-driven transitions with a simpler state update plus lighter visual treatment.

Pros:

- Simplest correctness model.
- Removes the class of bugs caused by synthetic drag lifecycle failures.
- Likely easier to maintain.

Cons:

- UX regression if the current animated move is considered important.
- Larger product/UI decision, not just a bug fix.

Risk level:

- Medium to high.
- Strong architectural cleanup, but more invasive.

## Recommended direction

If the goal is to fix the bug with minimal risk:

1. Implement Option 1 as the primary fix.
2. Optionally keep the stale-drag cleanup hardening as a secondary guard for the "review but unclickable" symptom.

If the goal is to improve the model long-term:

1. Move toward Option 2.
2. Consider Option 3 only as a safety net, not the primary source of truth.

## Open questions (resolved by static analysis)

- **Does the stranded window ever recover on focus/visibility changes without a reload?** `use-workspace-sync.ts` does refresh on visibility change, but board hydration only applies when the revision changes. In the stuck window, board state is never updated, so revision-based recovery won't help unless the server sends a new snapshot. Unreliable.

- **Does the bug reproduce only for `in_progress → review`, or also for `review → in_progress`?** Both. The `running && columnId === "review"` branch uses the identical "skip direct move if animation started/blocked" pattern and has the same vulnerability.

- **Is the broken window reporting `"started"` and then never completing, or stuck in repeated `"blocked"` responses?** The primary failure mode is `"started"` with no subsequent `onDragEnd`. Once the programmatic move is in flight, `programmaticCardMoveInFlightRef` remains set, so subsequent calls for the same task return `"blocked"` — but the real root cause is the initial `"started"` whose DnD lifecycle never finishes.

## Status

**Implemented as Option 2** in `web-ui/src/hooks/use-board-interactions.ts`, `web-ui/src/components/kanban-board.tsx`, and `web-ui/src/state/board-state.ts`. Tests added in `kanban-board.test.tsx` and `use-board-interactions.test.tsx`.
