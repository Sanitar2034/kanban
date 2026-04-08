# Desktop Branch Commit Cleanup Plan

## Current State
- Branch `feature/desktop-app` is now merged with latest `origin/main` (no conflicts)
- Typecheck passes clean
- 158 files changed, ~33K lines added
- Original had 7 feature commits + merge commit with conflict resolutions

## Proposed Clean Commit Structure

### Commit 1: `feat: runtime descriptor, connection resolution, and auth middleware`
Core infrastructure that enables CLI tools and the desktop app to discover and authenticate against a running Kanban runtime.

**Files:**
- `src/core/runtime-descriptor.ts` — Read/write/stale-check `~/.cline/kanban/runtime.json`
- `src/core/runtime-endpoint.ts` — `resolveRuntimeConnection()`, port 0 support
- `src/core/scoped-command.ts` — Extracted scoped command execution
- `src/core/api-contract.ts` — New API contract types
- `src/core/kanban-command.ts` — Kanban command builder additions
- `src/core/shell.ts` — Shell utility changes
- `src/server/auth-middleware.ts` — Token + CSRF auth middleware
- `src/server/runtime-state-hub.ts` — `isLocal`/`runtimeVersion` fields
- `src/index.ts` — Package root exports
- `test/runtime/auth-middleware.test.ts`
- `test/runtime/csrf-validation.test.ts`
- `test/runtime/runtime-endpoint.test.ts`
- `test/runtime/core/shell.test.ts`
- `test/runtime/package-root-exports.test.ts`

### Commit 2: `feat: server-side desktop APIs and CLI integration`
Server extensions (directory browse, port 0 listen update) and CLI changes (token command, auth headers in hooks/task).

**Files:**
- `src/server/runtime-server.ts` — Auth middleware wiring, directoryBrowseApi, port 0 update
- `src/trpc/app-router.ts` — directoryBrowse router
- `src/trpc/directory-browse-api.ts` — Directory listing API
- `src/trpc/projects-api.ts` — Async pickDirectory return type
- `src/runtime-start.ts` — Extracted runtime startup for desktop reuse
- `src/cli.ts` — Token command registration, version plumbing
- `src/commands/token.ts` — `kanban token generate` command
- `src/commands/hooks.ts` — `resolveRuntimeConnection` + auth headers
- `src/commands/task.ts` — `resolveRuntimeConnection` + auth headers
- `src/prompts/append-system-prompt.ts` — Desktop system prompt additions
- `src/terminal/agent-registry.ts` — Agent registry additions
- `src/terminal/pty-session.ts` — PTY session changes
- `src/terminal/session-manager.ts` — Session manager changes
- `test/cli/token-generate.test.ts`
- `test/runtime/runtime-start.test.ts`
- `test/runtime/append-system-prompt.test.ts`
- `test/runtime/kanban-command.test.ts`
- `test/runtime/snapshot-fields.test.ts`
- `test/runtime/terminal/pty-session.test.ts`
- `test/runtime/trpc/list-directories.test.ts`
- `test/integration/desktop-agent-task-create.integration.test.ts`

### Commit 3: `feat: web UI desktop integration`
UI components for desktop mode: diagnostics, reconnection, server directory browser, and desktop-aware navigation.

**Files:**
- `web-ui/src/App.tsx`
- `web-ui/src/components/diagnostics-dialog.tsx`
- `web-ui/src/components/project-navigation-panel.tsx`
- `web-ui/src/components/project-navigation-panel.test.tsx`
- `web-ui/src/components/reconnection-banner.tsx`
- `web-ui/src/components/runtime-settings-dialog.tsx`
- `web-ui/src/components/runtime-settings-dialog.test.tsx`
- `web-ui/src/components/server-directory-browser.tsx`
- `web-ui/src/components/server-directory-browser.test.tsx`
- `web-ui/src/hooks/runtime-disconnected-fallback.tsx`
- `web-ui/src/hooks/use-diagnostics.ts`
- `web-ui/src/hooks/use-home-agent-session.ts`
- `web-ui/src/hooks/use-home-agent-session.test.tsx`
- `web-ui/src/hooks/use-project-navigation.ts`
- `web-ui/src/hooks/use-git-actions.test.tsx`
- `web-ui/src/hooks/use-runtime-settings-cline-controller.test.tsx`
- `web-ui/src/hooks/use-startup-onboarding.test.tsx`
- `web-ui/src/runtime/native-agent.test.ts`
- `web-ui/src/runtime/use-runtime-config.test.tsx`
- `web-ui/src/runtime/use-runtime-project-config.test.tsx`
- `web-ui/src/runtime/use-runtime-state-stream.ts`
- `web-ui/src/runtime/use-runtime-state-stream.test.ts`
- `web-ui/src/styles/globals.css`

### Commit 4: `feat: Electron desktop app`
The full Electron shell: main process, preload, renderer recovery, connection management, protocol handler, WSL support, build scripts.

**Files:**
- `packages/desktop/*` (all ~70 source, test, and config files)

### Commit 5: `chore: CI, docs, and build config for desktop`
GitHub Actions workflows, documentation, build script changes, and config updates.

**Files:**
- `.github/workflows/desktop-mac.yml`
- `.github/workflows/desktop-publish.yml`
- `.github/workflows/desktop-win.yml`
- `.gitignore`
- `AGENTS.md`
- `README.md`
- `RELEASE_WORKFLOW.md`
- `docs/README.md`
- `docs/desktop-app-runtime-architecture.md`
- `docs/remote-setup.md`
- `package.json`
- `scripts/build.mjs`
- `vitest.config.ts`

## Execution Plan
1. `git reset --soft origin/main` — All feature changes become staged
2. Create each commit by selectively staging the file groups above
3. Run typecheck after each commit to ensure no breakage
4. Force-push to `feature/desktop-app`
