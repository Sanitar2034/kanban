# Desktop Merge Migration Plan

This document outlines how to merge `feature/desktop-app` into `main` **without breaking or changing the behavior of the existing CLI-launched Kanban app**.

## Goal

Merge the desktop app as a **supplemental product surface**, not a replacement for the current Kanban experience.

That means after merging:

- `npx kanban` and `kanban` must continue to work exactly as they do today
- the browser-based workflow must remain the default and stable path
- Electron must remain optional and additive
- desktop-only behavior must never become a hard dependency of the main app

## Non-goals

This migration should **not**:

- replace the CLI/browser entrypoint with Electron
- require Electron to build, run, or test the main Kanban runtime
- fork core runtime behavior for desktop users
- introduce desktop-only assumptions into shared task, git, worktree, session, or runtime codepaths

## Core merge principle

The safest merge strategy is:

1. **preserve existing Kanban behavior as the source of truth**
2. **extract and stabilize shared runtime boundaries first**
3. **treat Electron as an optional consumer of those shared boundaries**
4. **gate desktop-only UX and platform integrations behind explicit runtime checks and package boundaries**

In short:

> Keep Kanban core universal. Keep desktop native behavior optional.

## What must remain unchanged on `main`

The following existing behaviors should be treated as compatibility constraints during the merge:

- launching Kanban from the terminal starts the runtime and opens the web UI in the browser
- existing CLI flags and startup flow continue to behave the same way
- runtime server remains the source of truth for projects, worktrees, sessions, git operations, and live state
- normal web UI usage must not require Electron APIs
- browser users must not see regressions in startup, board behavior, task execution, git workflows, or agent orchestration

These are the guardrails for every migration phase.

## What should be shared vs. desktop-only

### Shared / core responsibilities

These should stay in the root Kanban app and be usable by both CLI/browser and desktop:

- runtime startup APIs
- runtime descriptor helpers and trust evaluation
- auth and API primitives that benefit both surfaces
- runtime server, TRPC, websocket, board state, worktree, git, session, and agent orchestration logic
- web UI functionality that works in both browser and desktop contexts
- remote runtime support as a product capability

### Desktop-only responsibilities

These should remain isolated to `packages/desktop` or Electron-specific UI checks:

- `BrowserWindow` lifecycle
- multi-window management
- project-locked windows
- native app menus
- preload bridges / IPC surface
- protocol registration and OAuth relay
- desktop preflight checks
- renderer crash recovery dialogs
- native window persistence
- desktop packaging, signing, notarization, and distribution workflows

## Realistic gating strategy

Desktop features should be gated in three practical ways.

### 1. Package boundary gating

Electron code should live in `packages/desktop`.

Rules:

- root `src/` must not import Electron runtime APIs
- shared code should not depend on `BrowserWindow`, `ipcMain`, preload globals, or Electron-only modules
- desktop should consume shared Kanban functionality through exported package boundaries

This is the strongest and safest form of gating because it prevents accidental coupling at compile time.

### 2. Runtime capability gating in the UI

Browser-safe behavior should remain the default. Desktop enhancements should only appear when an explicit Electron capability is present.

Examples:

- only show “Open in New Window” when desktop APIs are available
- only use Electron-specific protocol or window APIs when running inside the desktop app
- keep browser-mode fallbacks for all shared screens and workflows

The rule is simple:

> if Electron is unavailable, the feature is hidden or gracefully unavailable — never required.

### 3. Ownership gating

Keep the ownership boundary crisp:

- if a feature changes Kanban’s domain behavior, it probably belongs in shared core
- if a feature changes native shell behavior, it probably belongs in desktop

This prevents platform details from leaking into core product logic.

## Recommended merge order

Do **not** merge this as one giant branch dump. Merge in controlled phases.

## PR-by-PR merge plan

Because this is a large feature with meaningful architectural risk, the ideal path is a sequence of reviewable PRs with narrow goals and explicit compatibility checks.

### PR 1 — Shared runtime entrypoints and package boundaries

**Goal:** make the runtime safely consumable by non-CLI callers without changing current CLI behavior.

Include:

- reusable runtime start entrypoint
- root package exports needed by desktop
- runtime descriptor helpers that are safe to share
- minimal refactors required to stop desktop from importing private parent source paths

Do not include:

- Electron app wiring
- multi-window support
- packaging workflows
- desktop-only UI affordances

Reviewer focus:

- does CLI startup still work exactly the same?
- are package boundaries cleaner after this PR?
- did we accidentally introduce any Electron assumptions into core code?

Acceptance checks:

- existing CLI/browser tests pass
- root package builds cleanly
- desktop can consume exported runtime APIs without deep source imports

### PR 2 — Shared auth, token, and runtime endpoint primitives

**Goal:** land the shared auth/runtime pieces that desktop depends on, without pulling in Electron UX yet.

Include:

- auth middleware improvements
- token generation / auth token command support
- runtime endpoint / descriptor plumbing needed by desktop consumers
- shared API changes required for desktop connectivity later

Do not include:

- BrowserWindow logic
- desktop connection menus
- Electron protocol handling

Reviewer focus:

- are these primitives genuinely shared?
- do browser users retain the current behavior by default?
- are auth and endpoint changes backwards compatible?

Acceptance checks:

- local CLI/browser flow still works unchanged
- endpoint/auth flows remain browser-safe
- no Electron package dependency leaks into root runtime or web UI

### PR 3 — Introduce `packages/desktop` shell only

**Goal:** merge the desktop app as an optional package without landing the full native feature set.

Include:

- Electron package scaffolding
- minimal main/preload/runtime-child boot path
- local runtime launch in Electron
- package/build wiring needed to run the desktop app in development
- minimal auth handshake plumbing for Electron ↔ runtime child communication

Do not include:

- multi-window support
- advanced recovery/diagnostics
- protocol/OAuth integration
- connection persistence / remote switching UX
- WSL launch support
- publish/sign/notarize workflows

Reviewer focus:

- is desktop isolated as an optional package?
- can it launch without modifying the CLI/browser product path?
- does the shared runtime boundary hold up in a real consumer?

Acceptance checks:

- root app still builds/tests unchanged
- desktop app can boot locally
- desktop failures do not break normal root workflows

### PR 4 — Desktop resilience layer

**Goal:** make desktop startup and failure modes diagnosable before adding more product surface.

Include:

- preflight validation
- boot phase tracking
- stale descriptor trust handling
- orphan runtime cleanup
- recovery/failure dialogs
- runtime child lifecycle hardening

Do not include:

- multi-window support
- desktop-only UX expansion unrelated to reliability

Reviewer focus:

- are failure modes more understandable?
- do these changes stay scoped to desktop behavior?
- are we preserving the existing root startup path?

Acceptance checks:

- desktop handles broken/missing runtime resources more predictably
- existing browser startup remains unchanged
- tests cover the new reliability paths

### PR 5 — Desktop connection management UX

**Goal:** make local/remote switching a first-class desktop workflow.

Include:

- connection store
- connection manager
- connection menu / switching UX
- persisted active connection behavior
- auth interceptor/session wiring for remote and local targets
- WSL connection detection/launch if we want connection surfaces consolidated in one PR

Do not include:

- multi-window support
- broad unrelated UI refactors

Reviewer focus:

- is connection state model clear and safe?
- does local fallback behavior work correctly?
- are secrets/tokens handled responsibly?

Acceptance checks:

- desktop can save/switch connections
- invalid persisted connection state falls back safely
- browser mode remains unaffected

### PR 6 — Diagnostics and support tooling

**Goal:** improve supportability before broader rollout.

Include:

- diagnostics snapshot/export
- desktop diagnostic UI hooks if needed
- any tightly related instrumentation that helps debug packaged-app failures

Reviewer focus:

- is the collected data useful and safe?
- does it materially improve support/debugging?

Acceptance checks:

- diagnostics export works
- tests cover snapshot shaping and failure cases

### PR 7 — Multi-window support

**Goal:** add the largest desktop UX change only after the shell is stable.

Include:

- window registry
- window state persistence
- project-locked windows
- new-window flows and duplicate prevention
- renderer changes needed for locked-window mode

Reviewer focus:

- does this stay desktop-only?
- does shared runtime usage remain efficient and single-source-of-truth?
- are project/window semantics intuitive?

Acceptance checks:

- multiple windows work reliably
- all windows share one runtime process
- browser mode behavior remains unchanged

### PR 8 — Protocol/OAuth/native integration polish

**Goal:** land the remaining native integrations after the main shell and window model are stable.

Include:

- `kanban://` protocol handler
- OAuth callback relay
- app activation / second-instance handling improvements
- any remaining native integrations tightly coupled to desktop

Reviewer focus:

- do these integrations behave correctly across platforms?
- are they isolated from browser mode?

Acceptance checks:

- protocol callback path works in desktop
- second-instance behavior is deterministic
- browser/CLI flow remains unchanged

### PR 9 — Packaging, signing, publish workflows, and E2E

**Goal:** land distribution infrastructure only after product/runtime behavior is stable.

Include:

- electron-builder config
- platform packaging scripts
- signing/notarization hooks
- desktop CI/publish workflows
- packaged-app smoke and E2E coverage

Reviewer focus:

- are release workflows isolated from normal root development?
- can CI failures here be understood and maintained?
- are we adding only the minimum distribution complexity needed?

Acceptance checks:

- desktop package builds in CI
- packaged smoke tests pass
- root build/test workflows remain healthy and understandable

### PR 10 — WSL-specific desktop path (optional split)

**Goal:** isolate Windows-only WSL runtime launch support if we want to avoid overloading desktop connection management PRs.

Include:

- `packages/desktop/src/wsl-detect.ts`
- `packages/desktop/src/wsl-launch.ts`
- WSL-related connection store/manager wiring if kept separate
- WSL-specific tests

Reviewer focus:

- is this sufficiently isolated from the standard local desktop runtime path?
- does it only affect Windows/WSL users?
- is the fallback behavior safe when WSL is absent or misconfigured?

Acceptance checks:

- non-Windows platforms remain unaffected
- Windows desktop still works without WSL
- WSL users can launch and connect predictably

## Tactical PR slicing by file group

To keep PRs as consumable and mergeable as possible, each PR should group files by a **single review concern** and avoid mixing foundational refactors with product-surface expansion.

The goal is not just “small PRs,” but **independently understandable PRs**.

### General slicing rules

- one PR = one architectural idea
- avoid mixing shared-core refactors with Electron UX in the same PR
- avoid mixing reliability work with feature expansion when possible
- prefer landing type/export/boundary cleanup before the first consumer that needs it
- if a PR needs a lot of explanation, it is probably still too broad

### PR 1 — Runtime boundary + exports only

**Intent:** prepare `main` to be consumed by desktop without changing behavior.

Likely file groups:

- `src/runtime-start.ts`
- `src/index.ts`
- `src/core/runtime-descriptor.ts`
- any minimal root export/package wiring in `package.json`
- tests that validate exported runtime APIs / descriptor helpers

Keep out:

- any file in `packages/desktop/`
- UI changes
- auth/csrf changes unless strictly required for the new boundary

Why this should stand alone:

- reviewers can reason purely about shared runtime API design
- if this PR is good, it is mergeable even if desktop slips

### PR 2 — Shared server/auth hardening

**Intent:** land browser-safe server improvements that desktop also needs.

Likely file groups:

- `src/server/auth-middleware.ts`
- `src/core/api-contract.ts`
- `src/core/runtime-endpoint.ts`
- `src/commands/token.ts`
- `src/trpc/app-router.ts`
- related auth/csrf/runtime endpoint tests
- token-generation tests

Keep out:

- Electron session/header/cookie interception code
- connection menus/store in desktop
- multi-window code

Why this should stand alone:

- security and API behavior deserve focused review
- it remains useful even without desktop adoption

### PR 3 — Browser-safe remote/runtime UX support

**Intent:** land cross-surface remote/runtime support that belongs to Kanban generally, not specifically Electron.

Likely file groups:

- browser-safe runtime settings / directory-browse API pieces
- `src/trpc/directory-browse-api.ts`
- `web-ui/src/components/runtime-settings-dialog.tsx`
- `web-ui/src/components/server-directory-browser.tsx`
- `web-ui/src/components/reconnection-banner.tsx`
- `web-ui/src/hooks/runtime-disconnected-fallback.tsx`
- `web-ui/src/hooks/use-diagnostics.ts`
- related shared UI/runtime hooks in `web-ui/`
- tests for browser-safe runtime settings or directory browsing

Keep out:

- Electron connection store/menu/main-process code
- packaged-app assumptions

Why this should stand alone:

- it clarifies what is truly a Kanban capability vs what is just desktop shell behavior

### PR 4 — Minimal desktop package boot path

**Intent:** introduce `packages/desktop` with the smallest viable app shell.

Likely file groups:

- `packages/desktop/package.json`
- `packages/desktop/tsconfig*.json`
- `packages/desktop/src/main.ts` (minimal version only)
- `packages/desktop/src/auth.ts`
- `packages/desktop/src/preload.ts`
- `packages/desktop/src/runtime-child.ts`
- `packages/desktop/src/runtime-child-entry.ts`
- `packages/desktop/src/ipc-protocol.ts`
- `packages/desktop/src/kanban.d.ts`
- smallest supporting tests for boot/runtime-child behavior

Keep out:

- connection store/menu
- diagnostics
- multi-window
- protocol handler
- WSL-specific files
- packaging publish workflows

Why this should stand alone:

- it proves desktop can exist as a supplemental package before adding complexity

### PR 5 — Desktop startup resilience

**Intent:** harden the desktop shell before adding more product surface.

Likely file groups:

- `packages/desktop/src/desktop-preflight.ts`
- `packages/desktop/src/desktop-boot-state.ts`
- `packages/desktop/src/desktop-failure.ts`
- `packages/desktop/src/desktop-failure-codes.ts`
- `packages/desktop/src/orphan-cleanup.ts`
- `packages/desktop/src/renderer-recovery.ts`
- descriptor trust plumbing touching root exports only if already prepared by PR 1
- associated tests

Keep out:

- connection switching UX
- multi-window support
- broad menu additions unrelated to recovery

Why this should stand alone:

- reliability concerns are easier to evaluate when separated from feature work

### PR 6 — Desktop connection persistence + switching

**Intent:** add first-class local/remote switching in desktop.

Likely file groups:

- `packages/desktop/src/connection-store.ts`
- `packages/desktop/src/connection-manager.ts`
- `packages/desktop/src/connection-menu.ts`
- `packages/desktop/src/connection-utils.ts`
- `packages/desktop/src/auth.ts` follow-up wiring if not fully landed in PR 4
- associated tests

Keep out:

- multi-window
- diagnostics export
- OAuth/protocol integration unless absolutely required for connection switching

Why this should stand alone:

- state persistence, fallback behavior, and token handling are substantial review topics by themselves

### PR 7 — Desktop diagnostics/support tooling

**Intent:** improve supportability without changing the core desktop interaction model.

Likely file groups:

- `packages/desktop/src/desktop-diagnostics.ts`
- diagnostics export wiring in `packages/desktop/src/main.ts`
- `web-ui/src/components/diagnostics-dialog.tsx`
- `web-ui/src/hooks/use-diagnostics.ts`
- any small UI hook additions required to expose diagnostics
- associated tests

Keep out:

- multi-window
- protocol/OAuth
- distribution workflow files

Why this should stand alone:

- support tooling is valuable but should not bloat core behavior PRs

### PR 8 — Multi-window infrastructure

**Intent:** land the largest desktop UX change only after the app shell is proven.

Likely file groups:

- `packages/desktop/src/window-registry.ts`
- `packages/desktop/src/window-state.ts`
- `packages/desktop/src/main.ts` changes directly required for registry-based windowing
- `packages/desktop/src/preload.ts` additions for opening project windows
- web UI changes required for locked project mode:
  - `web-ui/src/App.tsx`
  - `web-ui/src/components/project-navigation-panel.tsx`
  - `web-ui/src/hooks/use-project-navigation.ts`
  - `web-ui/src/hooks/app-utils.tsx`
- associated tests

Keep out:

- protocol/OAuth
- distribution workflows
- unrelated desktop diagnostics changes

Why this should stand alone:

- it is conceptually large and deserves concentrated review on its own

### PR 9 — Native protocol/OAuth integration

**Intent:** add native integration points after the shell and window model are stable.

Likely file groups:

- `packages/desktop/src/protocol-handler.ts`
- `packages/desktop/src/oauth-relay.ts`
- second-instance / activation handling in `packages/desktop/src/main.ts`
- associated tests

Keep out:

- packaging/release workflow files
- multi-window refactors

Why this should stand alone:

- OS integration and OAuth flows are tricky enough to justify isolated review

### PR 10 — Packaging + CI + release pipeline

**Intent:** add distribution and release machinery last.

Likely file groups:

- `packages/desktop/electron-builder.yml`
- `packages/desktop/scripts/*`
- `.github/workflows/desktop-*.yml`
- `packages/desktop/playwright.config.ts`
- `packages/desktop/e2e/*`
- platform packaging docs/checklists if desired

Keep out:

- runtime logic changes
- product behavior changes not strictly required for distribution

Why this should stand alone:

- release infrastructure is operational complexity, not product behavior
- easier to revert/iterate independently if CI or signing is unstable

### PR 11 — WSL-specific desktop path (optional split)

**Intent:** keep Windows/WSL-specific launch behavior isolated if the team wants the cleanest possible review boundaries.

Likely file groups:

- `packages/desktop/src/wsl-detect.ts`
- `packages/desktop/src/wsl-launch.ts`
- any narrowly related connection wiring
- WSL-specific tests

Keep out:

- generic local desktop runtime flow
- unrelated connection manager refactors
- packaging/release changes

Why this should stand alone:

- WSL is a platform-specific supplement, not part of the core desktop path
- this keeps the main desktop connection PR more understandable

## How to keep each PR independently mergeable

Each PR should satisfy all of the following:

- it leaves `main` in a releasable state
- it does not require the next PR to “fix” broken behavior
- it has a narrow rollback surface if something goes wrong
- it includes its own tests for the behavior it introduces
- it does not partially expose unfinished desktop UX unless clearly hidden or unused

Practical rule:

> if a PR merged alone and the remaining desktop work never landed, `main` should still be healthier or at least not worse.

## Anti-patterns to avoid when slicing

Avoid these PR shapes:

- one huge `main.ts` desktop PR that also adds connection management, diagnostics, and multi-window
- mixing runtime export cleanup with Electron packaging/signing changes
- mixing browser-safe auth changes with Electron-only session interception
- landing half of a desktop capability in shared UI before the capability is safely gated
- adding broad web UI changes without making it obvious whether they affect browser mode

These patterns make review harder and make partial merges risky.

## Suggested review policy

For each PR in this sequence:

- require at least one reviewer focused on **core/runtime safety**
- require at least one reviewer focused on **desktop/package isolation** once `packages/desktop` lands
- explicitly state **what should not change for current `main` users** in the PR description
- include a short **manual verification checklist** for CLI/browser and desktop behavior

Each PR description should answer:

1. what existing `main` behavior is intentionally unchanged?
2. what new surface area is being added?
3. how is this gated from non-desktop users?
4. what tests prove we did not regress the primary CLI/browser flow?

## Suggested PR template fields

For this migration, each PR should include a short structured template:

- **Why this PR exists**
- **What changes for existing `main` users**
- **What is intentionally unchanged**
- **How desktop-only behavior is gated**
- **Files reviewers should focus on first**
- **Manual verification**
- **Follow-up PRs expected**

That will make the sequence easier for multiple devs to review over time.

## Shipping risk assessment by PR

The current branch is mostly additive, but there are a handful of changes that do affect existing shared codepaths. Those should be called out explicitly so reviewers know where regressions are most likely.

### PR 1 — Runtime boundary + exports

**Shipping risk:** Low

Why:

- mostly additive exports and new shared runtime files
- little to no direct behavior change for current CLI/browser users

Reviewer must verify:

- no circular dependency from new exports
- no accidental startup-order change introduced by export wiring

### PR 2 — Shared auth, token, and runtime endpoint primitives

**Shipping risk:** High

Why:

- this is the most sensitive shared-code PR
- it changes request handling on the runtime server
- it changes runtime endpoint resolution behavior used by existing commands

Specific behavior changes to scrutinize:

1. **Auth middleware now runs on every HTTP request**
   
   - `runtime-server.ts` calls `authMiddleware.handleHttpRequest(req, res)` before normal routing
   - this is only safe if `createAuthMiddleware()` is truly a no-op when `authToken` is undefined
   - current implementation appears safe: `if (!authToken) return true` for API requests, while static assets are already exempt and `/api/health` is intentionally intercepted
   - still requires explicit regression coverage for local CLI mode

2. **Directory picker can now be async-compatible**
   
   - lower risk, but existing callers need to continue behaving correctly
   - verify no legacy sync path regressed

3. **Port `0` is now valid in runtime endpoint parsing**
   
   - low risk, but it is a real behavioral change worth documenting

4. **Task/hooks runtime resolution now probes for the runtime before falling back to the descriptor**
   
   - this is a behavior change, not just an internal refactor
   - when the runtime is down, commands may now wait briefly instead of failing immediately
   - this is probably acceptable, but reviewers should decide if the timeout/heuristic is right

Required mitigation:

- tests that prove no-authToken CLI mode still passes through normally
- tests or manual verification for task/hooks latency and fallback behavior when the runtime is absent

### PR 3 — Browser-safe remote/runtime UX support

**Shipping risk:** Medium

Why:

- browser-safe in intent, but it touches visible shared UI and runtime settings flows
- the main risk is accidental browser-mode regressions rather than architecture problems

Specific behavior changes to scrutinize:

- runtime settings / directory browser UX additions should not disrupt the normal local flow
- reconnection/disconnected UI should stay dormant in ordinary local browser usage

Reviewer must verify:

- local browser users see the same default experience
- remote-specific UI only appears when relevant

### PR 4 — Minimal desktop package boot path

**Shipping risk:** Low

Why:

- almost entirely isolated to `packages/desktop`
- the main risk is package/build bleed-through into root workflows

Reviewer must verify:

- root install/build/test is still healthy
- desktop remains optional and isolated

### PR 5 — Desktop startup resilience

**Shipping risk:** Low

Why:

- desktop-scoped and mostly additive hardening
- risk is mostly around overcomplicating the desktop startup path, not impacting `main`

Reviewer must verify:

- root behavior is unchanged
- descriptor trust/orphan cleanup do not leak assumptions back into shared runtime behavior

### PR 6 — Desktop connection persistence + switching

**Shipping risk:** Low to Medium

Why:

- desktop-only surface, but more logic-heavy than earlier desktop PRs
- token persistence, fallback state, and local/remote switching are easy places for edge cases

Reviewer must verify:

- local fallback is always safe
- stored connection/auth state cannot break normal desktop startup

### PR 7 — Desktop diagnostics/support tooling

**Shipping risk:** Low

Why:

- mostly additive support tooling
- little risk to shared behavior if gated correctly

Reviewer must verify:

- diagnostics don’t expose unsafe data unnecessarily
- browser mode does not regress from any shared UI hooks used for diagnostics

### PR 8 — Multi-window support

**Shipping risk:** Medium

Why:

- this is the largest desktop UX PR
- it includes web UI changes that are shared with browser mode even though the behavior is desktop-motivated

Specific behavior changes to scrutinize:

1. **Locked-project mode hides the sidebar**
   
   - safe only if `lockedProjectId` stays `null` in normal browser mode
   - current tests around `parseLockedProjectIdFromSearch("") === null` are important here

2. **Project navigation panel prop changes must not regress browser-mode controls**
   
   - this deserves explicit review because shared UI wiring changed
   - verify that agent/provider settings and feedback entry points are still reachable in browser mode

3. **Desktop menu actions must stay gated behind `window.desktop`**
   
   - browser mode should never surface native-window affordances

Required mitigation:

- browser-mode manual check of project navigation/settings/feedback access
- tests around locked project parsing and desktop-only menu gating

### PR 9 — Native protocol/OAuth integration

**Shipping risk:** Low

Why:

- desktop-isolated native integration work
- little overlap with core CLI/browser behavior

Reviewer must verify:

- no assumptions leak into browser mode
- platform-specific behaviors fail safely

### PR 10 — Packaging + CI + release pipeline

**Shipping risk:** Low for product behavior, Medium for operations

Why:

- low risk to runtime behavior
- medium operational risk because CI/signing/packaging failures can be noisy and expensive to maintain

Reviewer must verify:

- root workflows remain understandable and unaffected
- desktop CI failures are isolated and diagnosable

### PR 11 — WSL-specific desktop path (optional split)

**Shipping risk:** Low

Why:

- platform-specific and optional
- best kept isolated so it does not muddy general desktop review

Reviewer must verify:

- non-Windows users are unaffected
- WSL detection/launch degrades safely when unavailable

## Highest-risk shared-code changes to call out in PR descriptions

The following changes deserve explicit reviewer attention because they touch existing `main` behavior directly:

1. **Auth middleware in `runtime-server.ts`**
   
   - highest-risk shared runtime change
   - must preserve no-token local CLI/browser behavior

2. **Async-compatible directory-picker behavior**
   
   - likely safe, but worth confirming against older call sites

3. **`resolveRuntimeConnection()` probe behavior in task/hooks flows**
   
   - may add noticeable delay when the runtime is absent

4. **Port `0` now accepted in runtime endpoint parsing**
   
   - low risk but real validation behavior change

5. **Shared web UI changes needed for locked-project desktop windows**
   
   - must not regress normal browser-mode navigation/settings/feedback access

### Phase 1: land shared runtime boundaries

Merge only the cross-surface foundations first:

- reusable runtime start entrypoint
- runtime descriptor publishing/cleanup/trust evaluation
- package exports needed by desktop
- auth/runtime API hardening that benefits both surfaces

Success criteria:

- CLI/browser Kanban behavior is unchanged
- tests for existing main flow still pass
- desktop can begin consuming shared runtime APIs without reaching into private source paths

### Phase 2: land remote/runtime connectivity primitives

Merge the parts that improve Kanban generally and support desktop later:

- remote connection abstractions where applicable
- auth middleware improvements
- connection-related API improvements
- any browser-safe UI support for connecting to non-local runtimes

Success criteria:

- remote support works in a browser-first world
- no Electron dependency is introduced into shared startup

### Phase 3: add the desktop package as an optional consumer

Merge `packages/desktop` once the shared boundaries are stable enough.

Rules for this phase:

- desktop must remain isolated as its own package
- desktop must import from the `kanban` package boundary, not root source file paths
- desktop failures must not block normal CLI/browser development workflows
- packaging and release workflows should remain scoped to the desktop package

Success criteria:

- the desktop app builds and runs without changing how CLI/browser Kanban works
- existing users can ignore the desktop package entirely

### Phase 4: merge resilience and supportability features

Land the desktop hardening work that improves reliability without changing core browser behavior:

- preflight validation
- boot phase tracking and failure reporting
- stale descriptor handling
- diagnostics export
- recovery handlers

Success criteria:

- desktop startup failures become diagnosable
- these changes do not alter standard browser startup behavior

### Phase 5: merge desktop UX enhancements

Once the desktop shell is stable, merge higher-level native UX features:

- multi-window support
- project-locked windows
- native menus
- protocol/OAuth flows
- window persistence

Success criteria:

- desktop users get native enhancements
- browser users do not see changed behavior unless the capability is intentionally shared

### Phase 6: merge distribution infrastructure

Finally, merge or enable the desktop distribution path:

- packaging config
- signing/notarization hooks
- publish workflows
- packaged-app smoke tests / E2E coverage

This should come after runtime and product behavior are already stable.

## Compatibility rules during the migration

Every migration PR should preserve these rules:

- the CLI remains the primary entrypoint on `main`
- no required Electron dependency is introduced for root install/build/test flows
- no shared UI path assumes `window.desktop` or Electron-only globals exist
- desktop-only actions degrade to hidden/unavailable in browser mode
- runtime behavior remains unified across CLI/browser and desktop

If any change violates one of those rules, it should be split, gated, or delayed.

## Test strategy

The merge should be validated across four core scenarios:

1. **CLI local**
   
   - `kanban` starts the runtime
   - browser UI loads normally

2. **Browser remote**
   
   - web UI can connect to a non-local runtime where supported

3. **Desktop local**
   
   - Electron launches
   - runtime child starts
   - web UI loads inside Electron

4. **Desktop remote**
   
   - desktop app can switch to and use a saved remote connection

Minimum expectation for each merge phase:

- existing root tests still pass
- any new shared runtime tests pass
- desktop tests pass in their own package scope
- packaged-app smoke tests are additive, not replacements for core runtime coverage

## Rollout recommendation

Even after merge, desktop should be presented as a **preview / optional install path** first.

Recommended rollout:

1. merge foundations and desktop package
2. keep CLI/browser flow as the documented default
3. ship desktop as optional preview
4. gather stability feedback
5. only later decide whether desktop should become a more prominent entrypoint

This reduces risk and avoids forcing a platform shift on current users.

## Practical recommendation

The safest realistic approach is:

- keep the current Kanban app behavior intact
- merge shared runtime infrastructure first
- keep Electron in the same repo as an optional package for now
- gate native desktop behavior through package boundaries and runtime capability checks
- validate compatibility continuously instead of relying on one final integration pass

That approach gives us the benefits of the desktop app **without turning it into a breaking rewrite of Kanban’s current CLI/browser product**.