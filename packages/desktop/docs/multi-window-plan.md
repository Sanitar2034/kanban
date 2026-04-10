# Multi-Window Support Implementation Plan

**Branch:** `feature/desktop-app`
**Worktree:** `/Users/johnchoi1/main/kanban-desktop`

## Goal

Enable VS Code-style multi-window support in the Kanban desktop app. Each window can be locked to a single project, and all windows share the same runtime process. In browser mode users can already have multiple tabs per project — this brings parity to Electron.

## Guardrails (approved by user)

- `WindowRegistry` is the **sole owner** of BrowserWindow lifecycle, focus tracking, and per-window metadata (projectId, recovery handlers, title updates).
- In `window-state.ts`, persist only stable restore data (not runtime window ids). Migrate `window-state.json` → `window-states.json` once, then write only the new format.
- In protocol/OAuth handling, always route to: focused window → last-focused → create overview window if none exist.
- Auth interceptor setup must be **idempotent** per Electron session (avoid duplicate interception if multiple windows share the same session).
- Parse `second-instance --project` robustly (`--project=...` and `--project ...`), fallback to overview on malformed input.
- Rebuild Window menu entries on create/focus/close so the list of open windows stays accurate.
- In renderer locked mode, sanitize `projectId` from URL and show a graceful fallback state if missing/invalid.

## Execution Order (lowest risk)

### Step 1: Multi-window persistence + migration (`window-state.ts`)
- [ ] Add `PersistedWindowState` type extending `WindowState` with `projectId: string | null`
- [ ] Add `loadAllWindowStates(userDataPath)` → `PersistedWindowState[]`
- [ ] Add `saveAllWindowStates(userDataPath, states[])` 
- [ ] One-time migration: if `window-state.json` exists and `window-states.json` doesn't, read old format, wrap in array, write new format
- [ ] Keep old `loadWindowState`/`saveWindowState` working during transition (deprecated)
- [ ] Tests for migration and round-trip

### Step 2: WindowRegistry (new module `window-registry.ts`)
- [ ] `WindowEntry` type: `{ window: BrowserWindow, projectId: string | null, disposeAuth: (() => void) | null }`
- [ ] `WindowRegistry` class with `Map<number, WindowEntry>` (key = BrowserWindow.id)
- [ ] `createWindow(options: { projectId?, savedState? })` — creates BrowserWindow with webPreferences, installs auth interceptor, loads URL with `?projectId=` param
- [ ] `getAll()`, `findByProjectId(id)`, `remove(windowId)`, `getFocused()` (focused → last-focused fallback)
- [ ] `saveAllStates(userDataPath)` — captures bounds from all windows
- [ ] `static loadPersistedWindows(userDataPath)` — reads `window-states.json`
- [ ] Window title updates: `"Kanban — <project name>"` per window
- [ ] On window close: remove from registry, rebuild Window menu
- [ ] On window focus: update last-focused tracking, rebuild Window menu
- [ ] Duplicate prevention: `createWindow` checks if projectId already has a window → focus it instead

### Step 3: `main.ts` singleton removal
- [ ] Replace `let mainWindow: BrowserWindow | null` with `WindowRegistry` instance
- [ ] Replace `createMainWindow()` call with `windowRegistry.createWindow()`
- [ ] Update all ~30 `mainWindow` references to go through `windowRegistry.getFocused()` or iterate
- [ ] `app.on("activate")` — create overview window if zero windows, otherwise focus most recent
- [ ] `app.on("before-quit")` — save all window states via registry
- [ ] `second-instance` — parse `--project <id>` / `--project=<id>`, open in new window or focus existing
- [ ] `handleProtocolUrl()` — route to focused window via registry
- [ ] OAuth relay — use `windowRegistry.getFocused()` 

### Step 4: `connection-manager.ts` decoupling
- [ ] Remove `window: BrowserWindow` from constructor options
- [ ] Remove `updateWindow()` method and single window ref
- [ ] Move `loadURL` calls to `WindowRegistry.createWindow()` (windows load URL on creation)
- [ ] Keep ConnectionManager focused on runtime lifecycle (start/stop/health)
- [ ] Auth interceptor installation moves to WindowRegistry (per-window, idempotent per session)
- [ ] Dialog calls (`showDesktopFailureDialog`, `dialog.showMessageBox`) use `windowRegistry.getFocused()`

### Step 5: Preload IPC + main handler
- [ ] Add to `preload.ts`: `openProjectWindow(projectId: string): void` via `ipcRenderer.send("open-project-window", projectId)`
- [ ] In `main.ts`: `ipcMain.on("open-project-window", (_, projectId) => windowRegistry.createWindow({ projectId }))`
- [ ] Type the preload API on `window.desktop`

### Step 6: Renderer lock mode + context action
- [ ] `web-ui/src/App.tsx`: read `?projectId=` from URL, pass as `requestedWorkspaceId` to `useRuntimeStateStream`
- [ ] When `lockedProjectId` is set: hide sidebar project switcher or make read-only
- [ ] Sanitize/validate projectId, show graceful fallback if invalid
- [ ] `web-ui/src/components/project-navigation-panel.tsx`: add "Open in New Window" right-click context menu item
- [ ] Only show context menu item when `window.desktop` exists (Electron mode)

### Step 7: Polish
- [ ] Window titles: `"Kanban — <project name>"` (update on project load)
- [ ] **File > New Window** menu item (⌘⇧N / Ctrl+Shift+N) — opens overview window
- [ ] **Window** submenu with list of open windows, rebuilt on create/focus/close
- [ ] Diagnostics dialog routing to focused window
- [ ] `attachRendererRecoveryHandlers` per window (called in `WindowRegistry.createWindow()`)
- [ ] Connection menu stays shared (one runtime serves all windows)

## Architecture Notes

- **Single runtime, multiple windows**: The forked runtime child process is shared. Each BrowserWindow connects to the same `http://localhost:<port>` with different `?projectId=` query params.
- **Auth**: One token per app launch. Each window's Electron session gets the auth header injected. If windows share the default session, the interceptor is installed once (idempotent guard).
- **`useRuntimeStateStream`** already accepts `requestedWorkspaceId` — this is the key integration point on the web UI side. No runtime-side changes needed.

## Current Status

- [x] Plan approved
- [x] Worktree created at `/Users/johnchoi1/main/kanban-desktop`  
- [x] Dependencies installed
- [x] Step 1: Multi-window persistence + migration (`window-state.ts`) — implemented with 23 passing tests
- [x] Step 2: WindowRegistry (`window-registry.ts`) — new module
- [x] Step 3: `main.ts` singleton removal — `mainWindow` replaced with `WindowRegistry`
- [x] Step 4: `connection-manager.ts` decoupling — callback-based, no BrowserWindow reference
- [x] Step 5: Preload IPC + main handler — `openProjectWindow` bridge
- [x] Step 6: Renderer lock mode + context action — sidebar hidden when locked, "Open in New Window" context menu
- [x] Step 7: Polish — window titles, File > New Window, Window submenu, diagnostics routing
