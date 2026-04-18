# Task Attach — Plan Review

**Reviewer**: Plan Review Orchestrator (automated)
**Date**: 2026-04-18
**Issue**: #363 — feat: kanban task attach — CLI interactive session attach
**Status**: ALL PLANS APPROVED FOR IMPLEMENTATION

---

## 1. Scope Summary

Four logical plan areas mapped to implementation files:

| Plan | Area | Files |
|------|------|-------|
| A | Server-side WS multiplexer | `ws-server.ts` (auth signature change), `runtime-server.ts` (history store wiring, bearer auth) |
| B | CLI attach command + terminal I/O | `task-attach.ts` (new), `task.ts` (export helpers, register command) |
| C | Session history persistence + replay | `session-history-store.ts` (new), `session-manager.ts` (onExit persistence), `app-router.ts` + `runtime-api.ts` (TRPC endpoint) |
| D | Interactive task picker | `task-attach.ts` — `runInteractivePicker()` |

---

## 2. User Story Coverage (from #363)

| US | Requirement | Status | Notes |
|----|------------|--------|-------|
| US-1 | Live session attach | PASS | WS connection, restore handshake, real-time output, clean Ctrl+C detach |
| US-2 | Interactive input | PASS | Raw mode, detach via Ctrl+P then Ctrl+Q (docker-style), special keys forwarded |
| US-3 | Resize | PASS | Initial size on connect + SIGWINCH → resize message via control WS |
| US-4 | Read-only mode | PASS | `--readonly` / `-r` flag skips stdin forwarding |
| US-5 | History replay | PASS | OnExit persistence via FileSessionHistoryStore, TRPC query, CLI fallback to history |
| US-6 | Session picker | PASS | No-arg attach → numbered picker of running/awaiting_review sessions |

---

## 3. Interface Consistency

### A+B: WS Handshake Protocol
PASS — CLI uses identical protocol to web-ui:
- Same URL paths (`/api/terminal/io`, `/api/terminal/control`)
- Same query params (`taskId`, `workspaceId`, `clientId`)
- Same restore handshake (receive `restore` → send `restore_complete`)
- Same binary framing on IO socket
- Bearer token auth via `Authorization` header (matching the new `validateUpgradeSession` signature)

### B+C: History Replay Format
PASS — CLI queries `runtimeClient.runtime.getSessionHistory.query({ taskId })` → TRPC → `FileSessionHistoryStore.load()`. The `PersistedSessionSnapshot` type is consistent across all layers.

### B+D: Picker → Attach Flow
PASS — `runInteractivePicker` resolves selection to a taskId and calls `runAttach()`.

---

## 4. Error Handling

### Covered
- WS connect failures → clear error messages with exit codes
- Task not found → `"Task not found."`
- Session not running → falls back to history replay
- History query failure → graceful fallback
- IO/Control WS disconnect → `"[detached] Connection lost."`
- Bearer token auth on WS upgrade
- Path traversal protection in session-history-store (`taskId` validation)

### Issues Found

**ISSUE-1: Unhandled rejection in picker on network failure**
`runtimeClient.workspace.getState.query()` in `runInteractivePicker` (line 329) has no try/catch. If the runtime server is unreachable, this throws an unhandled promise rejection.

**ISSUE-2: Silent failure when stdin is not a TTY**
`runAttach` (line 254) silently skips stdin forwarding when `process.stdin.isTTY` is false. The user connects but cannot type, with no warning. The picker has a TTY check; the attach-with-ID path does not.

**ISSUE-3: History never cleaned up**
`deleteOlderThan()` exists on `SessionHistoryStore` but is never called. Old snapshots accumulate indefinitely in `~/.cline/kanban/session-history/`.

---

## 5. Security

### Covered
- Bearer token auth for CLI → WS connections (timing-safe comparison)
- `validateUpgradeSession` widened to `IncomingMessage` to support both cookie and bearer
- Task ID path traversal protection in `session-history-store.ts`
- Internal auth token from `getInternalToken()` (env var fallback for CLI subprocesses)

### Acceptable risks
- No WS connection rate limiting (localhost-only or auth-protected)
- No max-connection limit per task (low severity — local tooling)

---

## 6. SOLID Principles

| Principle | Assessment |
|-----------|-----------|
| SRP | PASS — Clean separation: persistence (history-store), CLI I/O (task-attach), session management (session-manager) |
| OCP | PASS — History store injected via `setHistoryStore()`, not hardcoded. `SessionHistoryStore` interface allows alternative implementations. |
| LSP | PASS — `FileSessionHistoryStore` correctly implements `SessionHistoryStore` |
| ISP | PASS — `SessionHistoryStore` is small and focused (save, load, delete, deleteOlderThan) |
| DIP | PASS — Session manager depends on `SessionHistoryStore` abstraction |

---

## 7. Test Coverage Assessment

### Existing Tests
- `ws-server.test.ts` — passcode gate updated for new `validateUpgradeSession` signature PASS

### Critical Gaps

**ISSUE-4: No tests for `FileSessionHistoryStore`**
`session-history-store.ts` has non-trivial logic (1MB truncation, path validation, file I/O) with zero test coverage. The truncation algorithm in `truncateSnapshot()` is particularly risky — it estimates character positions from byte lengths and then searches for newline boundaries, which could fail for multi-byte UTF-8 content.

**ISSUE-5: No unit tests for `createDetachParser`**
The detach parser in `task-attach.ts` is a state machine with three states and edge cases (double Ctrl+P, Ctrl+P+other, Ctrl+P+Ctrl+Q). It should be unit-tested independently since it has no external dependencies.

**ISSUE-6: No test for TRPC `getSessionHistory` endpoint**
The new TRPC procedure in `app-router.ts` has no test.

---

## 8. Code Quality Issues

**ISSUE-7: Dynamic import violates project rules**
Line 375 in `task-attach.ts`: `const readline = await import("node:readline")`. AGENTS.md states "NEVER use inline imports." While `node:readline` is a built-in, the project convention is clear. Should be a top-level import.

**ISSUE-8: Shell sessions not persisted**
`startShellSession`'s `onExit` handler doesn't persist history (only `startTaskSession` does). This is likely intentional but should be documented or explicitly excluded with a comment.

---

## 9. Issue Summary

| ID | Severity | Description | Status |
|----|----------|-------------|--------|
| ISSUE-1 | Medium | Unhandled rejection in picker | FIXED — wrapped in try/catch |
| ISSUE-2 | Low | Silent non-TTY stdin skip | FIXED — warning added |
| ISSUE-3 | Low | History files never cleaned up | FIXED — 30-day prune on startup |
| ISSUE-4 | High | No tests for session-history-store | FIXED — `session-history-store.test.ts` added |
| ISSUE-5 | Medium | No unit tests for detach parser | FIXED — `detach-parser.test.ts` added |
| ISSUE-6 | Medium | No test for getSessionHistory TRPC | DEFERRED |
| ISSUE-7 | Low | Dynamic import of node:readline | FIXED — top-level import |
| ISSUE-8 | Info | Shell sessions not persisted | DEFERRED (intentional) |

---

## 10. Verdict

**ALL PLANS APPROVED FOR IMPLEMENTATION**

The architecture is sound, all user stories from #363 are covered, interfaces are consistent, and SOLID principles are followed. All must-fix and should-fix issues have been resolved:

- ISSUE-1: Fixed — error handling in picker
- ISSUE-2: Fixed — non-TTY warning
- ISSUE-3: Fixed — 30-day history cleanup on startup
- ISSUE-4: Fixed — unit tests for session-history-store
- ISSUE-5: Fixed — unit tests for detach parser
- ISSUE-7: Fixed — top-level import

**Remaining deferred items** (non-blocking):
- ISSUE-6: TRPC endpoint test for getSessionHistory
- ISSUE-8: Comment documenting shell session history exclusion
