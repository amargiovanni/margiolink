# MargioLink Efficiency and Statistics Honesty Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce repeated D1/frontend work and make retained-range limitations explicit in the statistics API.

**Architecture:** Throttle session touches using the row already read, lazy-load page boundaries, restrict font subsets, enforce build artifacts through an executable budget script, and centralize retained-range metadata before DB statistics calls.

**Tech Stack:** TypeScript, Cloudflare Workers/D1, React 19, React Router, Vite, Node.js build scripts, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-04-margiolink-production-hardening-design.md`

## Global Constraints

- Preserve existing routes, numeric payload fields, and dashboard behavior.
- Keep visitor hashes daily rotating; metadata must describe that semantic.
- Test build artifacts by running the build/budget, not by grepping source.
- Every runtime behavior starts with a failing test.

---

### Task 1: Throttle session touches

**Files:**
- Modify: `test/auth/session.test.ts`
- Modify: `src/db/sessions.ts`

**Interfaces:**
- Adds: `SESSION_TOUCH_INTERVAL_SECONDS = 300`
- Preserves: `readSession(db, token, now): Promise<SessionRow | null>`

- [x] **Step 1: Write failing timestamp behavior tests**

Create a session, read it at creation plus 100 seconds, and assert both the
returned and stored `last_seen_at` remain unchanged. Read at plus 301 seconds
and assert both advance to the new timestamp.

- [x] **Step 2: Verify RED**

Run: `npm test -- test/auth/session.test.ts`

Expected: the early read currently updates the timestamp.

- [x] **Step 3: Implement conditional touch**

After the existing SELECT, execute UPDATE only when:

```ts
now - session.last_seen_at >= SESSION_TOUCH_INTERVAL_SECONDS
```

Return the stored row unchanged inside the interval and the updated copy after
an actual touch.

- [x] **Step 4: Verify GREEN**

Run: `npm test -- test/auth/session.test.ts test/routes/auth.test.ts`

Expected: session and route tests pass.

- [x] **Step 5: Record commit boundary**

Intended commit: `perf(auth): throttle session activity writes`

---

### Task 2: Build an executable artifact budget

**Files:**
- Create: `scripts/check-build-budget.mjs`
- Create: `scripts/check-build-budget.test.mjs`
- Modify: `package.json`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Produces: `npm run test:build-budget`
- Produces: `npm run check:build-budget`
- Produces: `npm run build:verify`
- Consumes: completed `web/dist` production build

- [x] **Step 1: Write a failing executable-script test**

Use Node's built-in test runner against a temporary fixture directory containing
a 181 KiB gzip JavaScript file and a `cyrillic` font filename. Assert a non-zero
result and both violations. Run it against small Latin-only fixtures and assert
zero.

- [x] **Step 2: Verify RED**

Run: `node --test scripts/check-build-budget.test.mjs`

Expected: module import fails because the budget script does not exist.

- [x] **Step 3: Implement deterministic artifact checks**

Export a `checkBuildBudget(directory)` function and keep CLI exit handling behind
an entrypoint guard. Recursively inspect files, gzip each `.js` with Node `zlib`,
reject any result above `180 * 1024` bytes, and reject font basenames containing
`cyrillic`, `greek`, or `vietnamese`. Return all violations so the Node test can
assert behavior without mocking filesystem APIs.

Add scripts:

```json
"test:build-budget": "node --test scripts/check-build-budget.test.mjs",
"check:build-budget": "node scripts/check-build-budget.mjs",
"build:verify": "npm run build:web && npm run check:build-budget"
```

Change CI's dashboard build step to `npm run build:verify` and add
`npm run test:build-budget` beside the unit suite.

- [x] **Step 4: Verify the tool GREEN and current build RED**

Run: `npm run test:build-budget`

Run: `npm run build:web`

Run: `npm run check:build-budget`

Expected: script fixtures pass, while the current production build fails on the
212 KiB gzip application entry and unwanted font subsets.

- [x] **Step 5: Record commit boundary**

Intended commit: `ci(web): add executable bundle budgets`

---

### Task 3: Split routes and restrict font artifacts

**Files:**
- Modify: `web/src/App.tsx`
- Modify: `web/src/styles/app.css`
- Modify: `web/src/styles/landing.css`

**Interfaces:**
- Preserves: default `App` component and all route paths
- Adds: one accessible Suspense fallback with `role="status"`
- Consumes: the failing actual-build budget from Task 2

- [x] **Step 1: Implement page-level lazy imports**

Import `lazy` and `Suspense` from React. Replace the six page imports with:

```ts
const Login = lazy(() => import("./pages/Login"));
const Overview = lazy(() => import("./pages/Overview"));
const Links = lazy(() => import("./pages/Links"));
const LinkDetail = lazy(() => import("./pages/LinkDetail"));
const Tags = lazy(() => import("./pages/Tags"));
const Settings = lazy(() => import("./pages/Settings"));
```

Wrap `Routes` once in `Suspense` with an accessible, visually compatible status.

- [x] **Step 2: Restrict font assets**

Use IBM Plex Sans's `latin-*` and `latin-ext-*` CSS entrypoints for weights 400,
500, and 600. Define Fraunces variable `@font-face` rules for only the package's
`fraunces-latin-wght-normal.woff2` and
`fraunces-latin-ext-wght-normal.woff2`, copying the corresponding unicode ranges
from the package CSS and keeping `font-display: swap`.

- [x] **Step 3: Verify existing UI behavior and make the actual budget GREEN**

Run: `npm test -- web/src`

Run: `npm run build:verify`

Expected: component tests pass, page chunks are emitted, and no Greek,
Cyrillic, or Vietnamese font file appears in `web/dist/assets`.

- [x] **Step 4: Record commit boundary**

Intended commit: `perf(web): split dashboard routes and font subsets`

---

### Task 4: Add retained-range metadata

**Files:**
- Modify: `test/routes/stats-api.test.ts`
- Modify: `src/routes/api/stats.ts`
- Modify: `web/src/lib/queries.ts`
- Modify: `web/src/lib/queries.test.tsx`

**Interfaces:**
- Produces: exported `StatsMeta`
- Produces: `normaliseStatsRange(range, now, retentionDays): { range: StatsRange; meta: StatsMeta }`
- Adds: `meta` to summary, timeseries, dimension, and top-links responses

- [x] **Step 1: Write failing API metadata tests**

Freeze time to a literal Unix timestamp. Request a range beginning ten seconds
before the 180-day cutoff and assert:

```ts
expect(body.meta).toStrictEqual({
  requestedFrom: cutoff - 10,
  effectiveFrom: cutoff,
  retentionCutoff: cutoff,
  truncated: true,
  uniquesDefinition: "daily-rotating-visitor-hash",
});
```

Assert an in-window request has `truncated: false` and unchanged
`effectiveFrom`. Verify a click before the cutoff is not counted.

- [x] **Step 2: Verify RED**

Run: `npm test -- test/routes/stats-api.test.ts`

Expected: `meta` is absent and the query is not explicitly clamped.

- [x] **Step 3: Centralize range normalization**

Parse positive `RAW_RETENTION_DAYS`, derive the integer cutoff from `now`, clamp
`from` with `Math.max`, and return the exact `StatsMeta` shape from the spec.
Use the normalized range for every range-based DB call. Preserve original
response fields and append `meta`.

For summary, compute the previous comparison from the requested span while
clamping its lower bound to the same cutoff. Do not claim completeness for a
period older than retained raw data.

- [x] **Step 4: Expose shared web response types**

Export the identical `StatsMeta` interface from `web/src/lib/queries.ts` and add
`meta` to the four React Query response types. Extend the hook test's complete
fake response so it mirrors the real shape.

- [x] **Step 5: Verify GREEN**

Run: `npm test -- test/routes/stats-api.test.ts web/src/lib/queries.test.tsx`

Expected: API clamping and frontend types/tests pass.

- [x] **Step 6: Record commit boundary**

Intended commit: `feat(stats): expose retained range metadata`

---

### Task 5: Full completion gate

**Files:**
- Verify all changed files

**Interfaces:**
- Consumes all prior tasks; produces no new runtime interface.

- [x] **Step 1: Run static and unit/integration gates**

Run: `npm run check`

Run: `npm run typecheck`

Run: `npm test`

Run: `npm run build:verify`

Expected: zero failures.

- [x] **Step 2: Verify database and deploy packaging**

Run: `npm run db:verify-rollback`

Run: `npx wrangler deploy --dry-run`

Expected: rollback returns an identical schema and Wrangler packages all assets
without deploying.

- [x] **Step 3: Run E2E or record the exact environment limit**

Run: `npm run e2e` with writable XDG/Wrangler paths under `/tmp`. If Chromium is
blocked by the managed macOS sandbox before assertions, report that exact
platform error and use same-SHA CI as the browser gate; do not call local E2E
green.

Execution note (2026-09-04): the Worker started and the seed confirmed 48
clicks, but all 36 browser cases stopped before assertions because Chromium
failed `bootstrap_check_in ... MachPortRendezvousServer` with `Permission
denied (1100)` and SIGTRAP in the managed macOS sandbox. Local E2E is not green;
CI remains the browser gate.

- [x] **Step 4: Review the diff and repository state**

Run: `git diff --check`

Run: `git status --short`

Expected: only planned files are modified/untracked and no whitespace errors
exist. `.git` remains read-only, so no commit, push, PR, merge, or deployment is
claimed.
