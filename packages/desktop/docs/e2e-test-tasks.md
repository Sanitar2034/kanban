an you ke# Desktop App E2E Test Harness Implementation Plan

This document reframes the desktop E2E work into an **implementable execution plan** for building and rolling out a real Electron test harness for the new Kanban desktop app.

It intentionally focuses on what we can build next in `packages/desktop/` with the current codebase, where the harness needs explicit seams, and how to phase the work so we get useful confidence quickly without introducing a flaky or over-scoped test system.

Related context:

- `packages/desktop/docs/hardening-implementation-plan.md`
- planning docs now live outside the repo under `/Users/johnchoi1/Documents/kanban-desktop-planning/`; do not assume those files are available in CI or to other contributors
- `docs/desktop-app-branch-summary.md`

---

## Objective

Build a Playwright-driven Electron E2E harness that can launch the real desktop app, observe the desktop-managed runtime, and verify the highest-risk claims of the new architecture:

1. the Electron shell launches successfully,
2. it starts and manages its own runtime child,
3. BrowserWindow-authenticated requests succeed while unauthenticated requests fail,
4. local connection persistence and restore behavior work,
5. diagnostics and disconnect UX reflect actual desktop runtime state,
6. the harness is stable enough to run in CI and later extend to packaged smoke coverage.

---

## Constraints from the current implementation

These are the practical constraints the harness must respect.

### 1. Desktop startup is real Electron startup

The app entrypoint is `packages/desktop/src/main.ts`, compiled to `dist/main.js`, and `package.json` already uses:

- `"main": "dist/main.js"`
- `"build:ts"` to compile the main process and bundle the preload script with esbuild into `dist/preload.js`

That means the first harness should launch the compiled app entrypoint, not invent a fake bootstrap path.

### 2. Runtime startup currently happens through `ConnectionManager`

The real local boot path is not in a special E2E-only launcher. It happens through:

- `ConnectionStore`
- `ConnectionManager.initialize()`
- `RuntimeChildManager.start()`
- `BrowserWindow.loadURL(...)`

So the harness should assert against those behaviors indirectly through the loaded window and reachable runtime, not by mocking internals.

### 3. Auth is injected at the BrowserWindow session layer

Desktop auth depends on `installAuthHeaderInterceptor(...)` and BrowserWindow requests going through the Electron session. So tests must distinguish between:

- requests issued from the renderer/browser context,
- requests issued from Playwright's Node-side API client,
- and raw direct HTTP requests made outside the Electron session entirely.

That distinction is essential. In particular, `page.request` does **not** prove BrowserWindow auth interception because it runs from the Node test process rather than the Electron renderer session.

### 4. Some current docs assume seams that do not exist yet

Examples:

- there is no existing `launchDesktopApp()` fixture,
- there is no Playwright config in `packages/desktop/`,
- there is no stable test-only hook for forcing reconnect states,
- diagnostics can be opened via the real `open-diagnostics` IPC event from the app menu/preload path, but the harness needs a clean helper for that,
- the runtime descriptor path is currently global (`~/.cline/kanban/runtime.json`) and not isolated per test run.

So the first task is not “write many specs.” The first task is to create a **credible harness foundation**.

### 5. We should avoid unnecessary production-only test hooks

Per repo guidance, avoid changing product code purely to accommodate tests unless the seam is clearly justified. The harness should prefer:

- real Electron launch,
- real BrowserWindow interactions,
- real userData persistence,
- real runtime child lifecycle,
- and only add narrow seams when a workflow is otherwise impossible or too flaky.

### 6. There are two state-isolation risks, not one

The obvious isolation concern is `app.getPath("userData")`, which controls:

- `connections.json`
- window state persistence

But there is also a second global state surface:

- the runtime descriptor written to `~/.cline/kanban/runtime.json`

A reliable harness should isolate or redirect both, otherwise E2E runs can interfere with a developer's real Kanban runtime discovery state.

### 7. The harness depends on more than the desktop TypeScript build

The desktop app does not run from `packages/desktop` build output alone. The runtime child imports the packaged `kanban` dependency and the runtime serves web UI assets.

So an implementable harness must validate not only:

- desktop `dist/main.js`
- desktop `dist/preload.js`

but also that the underlying `kanban` package/runtime assets expected by the desktop app are actually available.

---

## Recommended rollout strategy

Build the harness in four waves.

### Wave 1 — Harness foundation

Create a minimal but real Electron Playwright harness that can:

- validate desktop build outputs,
- validate that the desktop package's `kanban` dependency is usable,
- launch Electron against `dist/main.js`,
- isolate `userData` per test run,
- isolate runtime descriptor state per test run,
- discover the active runtime URL,
- get the first BrowserWindow page,
- and shut down cleanly.

### Wave 2 — High-value local-mode E2E coverage

Once the harness is stable, add the core local-mode E2E cases:

- smoke launch,
- runtime child lifecycle,
- auth enforcement,
- local connection persistence/restore,
- diagnostics dialog.

### Wave 3 — Harder stateful scenarios

Add scenarios that are real but need more control or more robustness:

- disconnect/reconnect behavior,
- invalid persisted connection fallback,
- remote connection flows,
- restart/resume behavior.

### Wave 4 — CI and packaged smoke

After the dist-based harness is reliable locally/CI, expand to:

- matrix CI execution,
- packaged artifact smoke,
- and platform-specific smoke where native packaging assumptions matter.

---

## Deliverable 1 — Add the Electron Playwright harness

**Priority:** P0  
**Outcome:** A reusable, deterministic harness for launching the desktop app in tests.

### Files to add

- `packages/desktop/playwright.config.ts`
- `packages/desktop/e2e/fixtures.ts`
- `packages/desktop/e2e/smoke.spec.ts`

### Files to update

- `packages/desktop/package.json`
- likely `packages/desktop/src/main.ts` for narrow startup overrides if needed

### Package changes

Add dev dependencies:

- `@playwright/test`

Add scripts:

- `"e2e": "playwright test --config playwright.config.ts"`
- optionally `"e2e:headed": "playwright test --config playwright.config.ts --headed"`

### Important dependency note

`packages/desktop/package.json` uses `esbuild` in `build:ts`, but `esbuild` is not declared in `packages/desktop/devDependencies`. It is likely available via the workspace/root install today.

That means the harness and any future CI workflow should assume the desktop app is built from the full repo/workspace context, not from an isolated `cd packages/desktop && npm install` setup unless dependency declarations are tightened first.

### Playwright config requirements

`packages/desktop/playwright.config.ts` should:

- set `testDir: "./e2e"`
- use a desktop-appropriate timeout such as `60_000`
- run headless by default
- avoid a `webServer` block, because Electron is launching the real app
- keep retries conservative initially (`0` locally, CI may later override)
- avoid adding browser projects we do not need yet
- leave room for future global setup/teardown if process cleanup becomes necessary

### Fixture responsibilities

`packages/desktop/e2e/fixtures.ts` should export a small harness API, for example:

```ts
interface LaunchedDesktopApp {
	electronApp: ElectronApplication;
	page: Page;
	runtimeUrl: string;
	userDataDir: string;
	runtimeDescriptorDir: string;
	cleanup: () => Promise<void>;
}

export async function launchDesktopApp(): Promise<LaunchedDesktopApp>;
```

The fixture should do the following:

1. Ensure the required build outputs exist.
   - Check **both** `dist/main.js` and `dist/preload.js` before deciding the desktop build is usable.
   - If either is missing, run `npm run build:ts` in `packages/desktop`.
   - Do not treat `dist/main.js` alone as a sufficient signal, because `tsc` may have succeeded while the preload esbuild bundle failed.

2. Validate the desktop app's runtime dependency chain.
   - Confirm the packaged `kanban` dependency expected by `packages/desktop` is resolvable/usable.
   - If the desktop app relies on root-built runtime assets or packed tarball contents, document that prerequisite clearly or add a preflight check that fails with an actionable message.

3. Create an isolated temp directory for Electron `userData`.
   - Tests must not reuse a developer's real desktop app state.
   - `--user-data-dir` alone is not enough for this app because the product code explicitly uses `app.getPath("userData")`.
   - The preferred seam is a small startup override in `main.ts`, e.g. honoring an env var like `KANBAN_DESKTOP_USER_DATA` via `app.setPath("userData", ...)` before any `app.getPath("userData")` access.

4. Create an isolated temp directory for runtime descriptor state.
   - The app currently publishes a runtime descriptor to a global user path.
   - The harness should avoid overwriting or deleting a developer's real descriptor.
   - If necessary, add a narrow descriptor-path override seam for tests.

5. Launch Electron through Playwright.

```ts
import { _electron as electron } from "@playwright/test";
```

Launch against the compiled entrypoint:

```ts
const electronApp = await electron.launch({
	args: ["dist/main.js"],
	env: {
		...process.env,
		KANBAN_DESKTOP_USER_DATA: userDataDir,
		KANBAN_DESKTOP_RUNTIME_DESCRIPTOR_DIR: runtimeDescriptorDir,
		NODE_ENV: "development",
	},
});
```

Use `development` unless there is a deliberate reason to test `NODE_ENV=test`. If test mode is chosen later, document exactly which behavior difference we want.

6. Wait for the first real BrowserWindow.

```ts
const page = await electronApp.firstWindow();
```

7. Discover the runtime URL in a deterministic way.

Recommended order:

- first, inspect the current page URL after the app loads,
- if needed, read runtime state from Electron main-process globals via `electronApp.evaluate(...)`,
- if neither is stable enough, add a narrow main-process helper for test introspection.

The preferred approach is to avoid broad test APIs and instead derive the URL from observable app behavior.

8. Wait for runtime readiness.

The fixture should not assume `firstWindow()` means the runtime is ready. Add polling that waits until:

- the page is on the expected runtime origin,
- and a renderer-context request like `fetch('/api/trpc/runtime.getVersion', ...)` succeeds.

9. Return cleanup that always closes Electron and removes temp state.

10. Plan for crash/timeout cleanup.
    - `finally` blocks are not enough for every failure mode.
    - Document a fallback strategy for orphaned Electron/runtime child processes, such as global teardown or PID-based cleanup, if repeated runs show leakage.

### Required helper utilities inside the fixture

The fixture should likely include small internal helpers such as:

- `ensureDesktopBuild()`
- `ensureDesktopRuntimeDependencies()`
- `waitForRuntimeUrl(page, electronApp)`
- `waitForRuntimeReady(page)`
- `createTempUserDataDir()`
- `createTempRuntimeDescriptorDir()`

These should stay in the fixture file until reuse clearly justifies further extraction.

### First spec to add

`packages/desktop/e2e/smoke.spec.ts`

Initial coverage should stay minimal:

```ts
import { expect, test } from "@playwright/test";
import { launchDesktopApp } from "./fixtures";

test("desktop app launches and shows Kanban UI", async () => {
	const { page, cleanup } = await launchDesktopApp();
	try {
		await expect(page).toHaveTitle(/Kanban/, { timeout: 30_000 });
		await expect(page.getByText("Backlog", { exact: true })).toBeVisible();
	} finally {
		await cleanup();
	}
});

test("renderer can reach the runtime after desktop app launch", async () => {
	const { page, cleanup } = await launchDesktopApp();
	try {
		const ok = await page.evaluate(async () => {
			const response = await fetch("/api/trpc/runtime.getVersion", {
				method: "GET",
				credentials: "same-origin",
			});
			return response.ok;
		});
		expect(ok).toBe(true);
	} finally {
		await cleanup();
	}
});
```

Use a renderer-side request here, not `page.request`, because the smoke test should prove the actual desktop-authenticated browser path.

### Implementation note: state isolation

The two isolation targets are:

- `app.getPath("userData")` for `connections.json` and window state
- the runtime descriptor path currently rooted under the user's home directory

If either still points at developer state, the harness is not safe to run repeatedly on contributor machines.

### Verification

```bash
cd /Users/johnchoi1/main/kanban/packages/desktop && npm run e2e
```

---

## Deliverable 2 — Boot lifecycle E2E

**Priority:** P1  
**Depends on:** Deliverable 1

### Goal

Prove that local desktop mode starts the runtime child automatically and tears it down on app exit.

### Tests to add

File: `packages/desktop/e2e/boot-lifecycle.spec.ts`

Add:

1. `desktop app starts runtime child automatically`
   - launch app
   - wait for the main board UI
   - assert the app is not stuck in a disconnected state

2. `closing the desktop app makes the runtime unreachable`
   - launch app
   - capture `runtimeUrl`
   - call harness cleanup
   - poll the URL until it stops responding

### Important harness requirement

The second test should use polling and tolerate normal shutdown latency. Do not make it assume the runtime disappears instantly.

### Claims covered

- Electron desktop app starts and manages its own Kanban runtime child process

---

## Deliverable 3 — Auth enforcement E2E

**Priority:** P1  
**Depends on:** Deliverable 1

### Goal

Prove the desktop auth token model is active and requests are differentiated correctly.

### Tests to add

File: `packages/desktop/e2e/auth.spec.ts`

Add:

1. `authenticated renderer request succeeds`
   - use `page.evaluate(() => fetch(...))` against `/api/trpc/runtime.getVersion`
   - expect success

2. `direct unauthenticated request to runtime is rejected`
   - use `fetch(...)` from the Node test process, not the renderer/browser context
   - expect `401` or `403`

3. optional stronger control test: `node-side request with explicit auth header succeeds`
   - obtain the auth token from the main process only if needed for debugging or a stronger contrast case

### Important implementation note

Do not use `page.request` as the main proof of BrowserWindow auth interception. It runs from the Playwright Node process and bypasses the Electron session interceptor.

### Claims covered

- Desktop auth token model and runtime auth middleware are active

---

## Deliverable 4 — Connection persistence and default local-mode E2E

**Priority:** P1  
**Depends on:** Deliverable 1

### Goal

Prove the desktop app boots into local mode by default and persists connection metadata in isolated userData.

### Tests to add

File: `packages/desktop/e2e/connection-management.spec.ts`

Start with only the scenarios the current app can support cleanly without extra UI-driving seams:

1. `default startup uses local connection`
   - launch app
   - assert the loaded origin is localhost/127.0.0.1

2. `connections.json persists active connection metadata`
   - launch app
   - locate the isolated test `userDataDir`
   - read `connections.json`
   - assert `local` exists and an active connection id is present

3. `persisted local state is reused across relaunch`
   - launch app and close it
   - relaunch using the same isolated userData dir
   - assert startup still resolves to local mode and valid persisted state

### Do not include yet

Do **not** put these in the first implementation wave unless the harness already has stable support:

- menu-driven remote connection creation
- remote/local switching through dialogs
- insecure HTTP warning assertions
- invalid persisted remote fallback through full UI setup

Those are valid follow-ups, but they require more state orchestration and can easily make the first harness flaky.

### Claims covered

- ConnectionStore + ConnectionManager + persisted active connection are wired into desktop app

---

## Deliverable 5 — Diagnostics dialog E2E

**Priority:** P1  
**Depends on:** Deliverable 1

### Goal

Prove that diagnostics shown in the renderer reflect actual desktop runtime state.

### Tests to add

File: `packages/desktop/e2e/diagnostics.spec.ts`

Initial scenario:

1. `diagnostics dialog shows local connected state`
   - launch app
   - trigger the real diagnostics open flow
   - assert the dialog opens
   - assert local/connected/runtime details are present

### Recommended way to open diagnostics

Prefer one of these, in order:

1. trigger the actual menu item if Playwright/Electron control is straightforward,
2. send the real `open-diagnostics` event through `electronApp.evaluate(...)`,
3. only add a dedicated test seam if neither is reliable.

Because `preload.ts` already exposes `onOpenDiagnostics(...)` and `main.ts` already emits `open-diagnostics`, this scenario should be implementable without introducing a new product abstraction.

### Claims covered

- Desktop diagnostics reflect Local/Remote state, runtime version, websocket state, and auth state

---

## Deliverable 6 — Reconnection and disconnect-state E2E

**Priority:** P2  
**Depends on:** Deliverable 1 and stable control hooks

### Goal

Prove local and remote disconnect UX behave differently and correctly.

### Why this is deferred

The current codebase does not obviously expose a stable test seam for forcing reconnect/disconnect states from Playwright. This should not block the first harness.

### Initial target scenario

File: `packages/desktop/e2e/reconnection.spec.ts`

1. `local runtime disconnect shows full-page disconnected fallback`
   - launch app
   - force the local runtime child to die
   - assert the local disconnected fallback is shown

### Later scenarios

- remote disconnect shows reconnection banner instead of full-page fallback
- reconnect success shows recovered state
- repeated reconnect failure shows retry affordance

### Recommendation

Do this only after Wave 2 is green. If needed, add a small test seam that can terminate the runtime child from the main process in a controlled way.

---

## Deliverable 7 — Dist-based CI execution

**Priority:** P2  
**Depends on:** Deliverable 1 being stable

### Goal

Run the Electron harness against built `dist/` output in CI before attempting full packaged artifact smoke.

### Why dist-first

This is the right intermediate step between “works on one developer machine” and “works in packaged artifacts across platforms.” It verifies:

- Electron boot,
- runtime child startup,
- preload wiring,
- auth interception,
- and basic persistence,

without immediately taking on every packaging-specific failure mode.

### Suggested workflow shape

Add a workflow later such as `.github/workflows/desktop-e2e.yml` that:

1. checks out the repo
2. installs full repo/workspace dependencies
3. builds or otherwise validates the root/runtime outputs and packaged `kanban` dependency expected by `packages/desktop`
4. builds desktop TypeScript output
5. installs Playwright browsers/deps
6. runs `packages/desktop` E2E smoke specs

### Initial matrix recommendation

Start with the platform most likely to be used for harness development, then expand. A full cross-platform matrix is a follow-up, not a requirement for the first harness landing.

---

## Deliverable 8 — Packaged artifact smoke

**Priority:** P3  
**Depends on:** Deliverable 7 and packaging hardening

### Goal

Eventually prove packaging assumptions, not just dev/dist assumptions.

### Why this is separate

The hardening plan identifies packaging-specific risks that dist-mode E2E will not fully cover:

- `app.asar` vs `app.asar.unpacked` child entry resolution,
- native addon availability,
- packaged shim layout,
- platform-specific launch behavior.

Those should become packaged smoke checks after the base harness is already trustworthy.

### Packaged-smoke targets

- installed or unpacked app launches
- runtime child entry survives packaging
- preload loads correctly
- auth and runtime reachability still work
- shutdown is clean

---

## Non-Electron work that should proceed in parallel

These do not depend on the Electron harness and should not wait for it.

### 1. CLI bridge integration expansion

Continue/extend integration tests around:

- runtime descriptor write on startup
- runtime descriptor cleanup on shutdown
- descriptor fallback when env vars are absent
- stale descriptor rejection

Relevant shared code:

- `src/core/runtime-descriptor.ts`
- `src/core/runtime-endpoint.ts`

### 2. CLI shim regression tests

Strengthen tests around:

- executable permissions
- script contents
- expected entrypoint targeting
- optional simulated invocation in packaged layout

Relevant files:

- `packages/desktop/build/bin/kanban`
- `packages/desktop/build/bin/kanban-dev`
- `packages/desktop/build/bin/kanban.cmd`

### 3. Connection manager/store gap fill

Continue unit/integration coverage for:

- corrupt `connections.json`
- missing persisted state
- invalid active connection fallback
- local/remote persistence edge cases

Relevant files:

- `packages/desktop/test/connection-store.test.ts`
- `packages/desktop/test/main-connection-integration.test.ts`

Important note: `packages/desktop/test/connection-manager.test.ts` is currently very thin and does not provide substantial `ConnectionManager` behavior coverage today. Treat most deeper connection-manager testing as effectively greenfield.

### 4. Web UI Playwright additions

Extend browser-only coverage for desktop-adjacent UI affordances that do not require Electron.

Relevant files:

- `web-ui/playwright.config.ts`
- `web-ui/tests/`

---

## Recommended implementation order

If we want the fastest path to meaningful confidence, do the work in this order.

### Phase A — build the harness

1. Add `@playwright/test` and desktop Playwright config
2. Add `e2e/fixtures.ts`
3. Add smoke launch/runtime-reachable specs using renderer-side requests
4. Add deterministic `userData` isolation
5. Add deterministic runtime descriptor isolation
6. Add crash/timeout cleanup strategy if process leakage appears

### Phase B — prove the core architecture claims

7. Add boot lifecycle E2E
8. Add auth enforcement E2E
9. Add connection persistence/local default E2E
10. Add diagnostics E2E

### Phase C — expand into failure-state behavior

11. Add disconnect/reconnection scenarios
12. Add remote-switching scenarios
13. Add invalid persisted connection fallback through E2E

### Phase D — automate beyond local development

14. Add dist-based CI run
15. Add packaged smoke checks
16. Expand to platform matrix where justified

---

## Definition of done for the initial harness landing

The first harness milestone should be considered complete when all of the following are true:

1. `packages/desktop` has a runnable Playwright config and `npm run e2e` script.
2. The harness launches the real Electron desktop app from compiled output.
3. Tests run against isolated `app.getPath("userData")`, not developer state.
4. Tests do not overwrite or delete the developer's real runtime descriptor state.
5. At least one smoke spec proves launch and renderer-to-runtime reachability.
6. At least one auth/lifecycle-oriented spec proves behavior unique to Electron desktop mode.
7. Cleanup is reliable enough that repeated local runs do not leave orphaned app instances or stale test state.

That is the correct first milestone. Everything else should layer on top of that foundation.

---

## Open implementation questions to resolve during execution

These should be answered while building the harness, not before starting.

1. **Best runtime URL discovery path**
   - Is `page.url()` sufficient once the window loads?
   - Do we need a main-process introspection helper?

2. **Best proof of authenticated requests**
   - renderer `fetch` is the current preferred proof
   - do we also want an explicit-control Node-side request with copied auth headers?

3. **Best `userData` override seam**
   - the likely seam is `app.setPath("userData", ...)` early in `main.ts`
   - confirm no `app.getPath("userData")` reads happen before that override

4. **Best runtime descriptor override seam**
   - should desktop own a path override directly,
   - or should this consolidate onto the shared descriptor module first?

5. **How much remote-mode coverage belongs in the first harness**
   - likely minimal
   - local-mode confidence is the first milestone

6. **When to connect the harness to packaged artifacts**
   - only after dist-mode runs are stable and hardening work has reduced startup ambiguity

---

## Summary

The next step is not “write all desktop E2E tests.” The next step is to land a **real Electron Playwright harness with deterministic state isolation**, then use it to prove the highest-risk desktop-local behaviors first.

That means fixing the real harness prerequisites up front: checking both desktop build artifacts, validating the broader runtime dependency chain, using renderer-side requests for auth-sensitive assertions, and isolating both `userData` and runtime descriptor state so local developer workflows are not disrupted.
