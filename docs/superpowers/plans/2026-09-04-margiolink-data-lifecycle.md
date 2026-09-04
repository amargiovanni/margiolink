# MargioLink Data Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bound campaign inputs, suppress identifying low-count aggregates, expire sensitive dimensions, and make missed rollups self-healing.

**Architecture:** Keep the existing raw-click and daily-rollup model. Enforce campaign labels at the request boundary, apply a per-dimension privacy policy during rollup, discover bounded historical gaps before processing today/yesterday, and extend retention to sensitive aggregate rows.

**Tech Stack:** TypeScript, Cloudflare Workers, D1/SQLite, Vitest Workers pool.

**Spec:** `docs/superpowers/specs/2026-09-04-margiolink-production-hardening-design.md`

## Global Constraints

- Keep the single Worker, D1 datastore, React SPA, and existing public URLs.
- Do not add external services or new persistent visitor identifiers.
- Keep legacy `utm_term` and `utm_content` columns nullable but stop writing them.
- Catch-up and cleanup work must be bounded per invocation.
- Every production behavior starts with a failing real-D1 or request-boundary test.

---

### Task 1: Bound campaign labels at ingestion

**Files:**
- Modify: `test/lib/request-context.test.ts`
- Modify: `test/db/clicks.test.ts`
- Modify: `src/lib/request-context.ts`
- Modify: `src/db/clicks.ts`
- Modify: `scripts/demo-data.mjs`
- Modify: `test/demo-seed.test.ts`

**Interfaces:**
- Produces: `normaliseCampaignLabel(value: string | null): string | null`
- Produces: `UtmParams` with only `source`, `medium`, and `campaign`
- Consumes: existing `buildRequestContext(request: Request): RequestContext`

- [x] **Step 1: Write failing boundary tests**

Add literal expectations proving trimmed labels of at most 64 characters survive,
while spaces, `@`, control characters, and 65-character values become `null`.
Change the existing five-parameter expectation to:

```ts
expect(ctx.utm).toEqual({
  source: "newsletter",
  medium: "email",
  campaign: "launch-2026",
});
```

Add a real D1 assertion that `utm_term` and `utm_content` are `NULL` after
`insertClick`, even though the legacy columns still exist.

- [x] **Step 2: Verify RED**

Run: `npm test -- test/lib/request-context.test.ts test/db/clicks.test.ts`

Expected: failures show arbitrary values are still accepted and the old UTM
shape still contains `term` and `content`.

- [x] **Step 3: Implement the minimal boundary**

Use this exact policy in `src/lib/request-context.ts`:

```ts
const CAMPAIGN_LABEL = /^[A-Za-z0-9._~-]{1,64}$/;

export function normaliseCampaignLabel(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  return CAMPAIGN_LABEL.test(trimmed) ? trimmed : null;
}
```

Remove `term` and `content` from `UtmParams`. Apply the helper to the three
retained URL parameters. Keep the two legacy SQL columns in the INSERT but bind
literal `null` values. Remove term/content fields from demo fixtures so generated
sample data exercises the same supported shape.

- [x] **Step 4: Verify GREEN**

Run: `npm test -- test/lib/request-context.test.ts test/db/clicks.test.ts`

Expected: both files pass.

- [x] **Step 5: Record commit boundary**

Intended commit: `fix(analytics): bound campaign input collection`

The managed workspace exposes `.git` read-only, so execution records this
boundary without invoking `git commit`.

---

### Task 2: Suppress low-count sensitive dimensions

**Files:**
- Modify: `test/cron/rollup.test.ts`
- Modify: `src/cron/rollup.ts`
- Modify: `src/db/stats.ts`

**Interfaces:**
- Produces from `src/db/stats.ts`: `SENSITIVE_DIMENSIONS: ReadonlySet<DimensionName>`
- Consumes: `DIMENSION_COLUMNS`
- Preserves: `rollupDay(db: D1Database, day: string): Promise<void>`

- [x] **Step 1: Write the failing aggregate test**

Insert two non-bot clicks with `utm_campaign = 'private-label'` and three with
`utm_campaign = 'shared-label'` for the same link/day. After `rollupDay`, assert
that only this literal row exists:

```ts
expect(rows).toStrictEqual([
  { value: "shared-label", clicks: 3, uniques: 3 },
]);
```

Also assert that a coarse `country` value with one click is still present.

- [x] **Step 2: Verify RED**

Run: `npm test -- test/cron/rollup.test.ts`

Expected: `private-label` is present because rollup has no threshold.

- [x] **Step 3: Add the policy to rollup SQL**

Export the set next to `DIMENSION_COLUMNS` in `src/db/stats.ts` so both rollup
and retention use one policy without a circular import:

```ts
export const SENSITIVE_DIMENSIONS: ReadonlySet<DimensionName> = new Set([
  "city",
  "asn_org",
  "referrer_host",
  "utm_source",
  "utm_medium",
  "utm_campaign",
]);
```

Append `HAVING COUNT(*) >= 3` only for names in that set. Keep parameters bound
and dimension/column names limited to the existing closed TypeScript mapping.

- [x] **Step 4: Verify GREEN**

Run: `npm test -- test/cron/rollup.test.ts`

Expected: rollup tests pass with low-count sensitive rows absent.

- [x] **Step 5: Record commit boundary**

Intended commit: `fix(analytics): suppress identifying aggregate slices`

---

### Task 3: Catch up missed complete days

**Files:**
- Modify: `test/cron/rollup.test.ts`
- Modify: `src/cron/rollup.ts`
- Modify: `src/index.ts`

**Interfaces:**
- Produces: `RollupResult { days: string[]; backlog: boolean }`
- Produces: `findUnaggregatedDays(db, beforeDay, limit): Promise<string[]>`
- Changes: `runRollup(db, now): Promise<RollupResult>`

- [x] **Step 1: Write failing outage and bound tests**

Insert raw clicks for nine complete historical days with no aggregate rows. Run
the hourly job and assert that it processes the seven oldest days plus yesterday
and today, reports `backlog: true`, and leaves exactly two historical gaps for a
later run. Add a second invocation assertion proving the backlog drains.

- [x] **Step 2: Verify RED**

Run: `npm test -- test/cron/rollup.test.ts`

Expected: the result contains only today/yesterday and historical gaps remain.

- [x] **Step 3: Implement bounded discovery and structured logging**

Query distinct `date(ts, 'unixepoch')` values older than yesterday, exclude days
already present in `click_daily`, order ascending, and request eight rows. Process
the first seven; the eighth is the backlog signal. Merge with yesterday/today
through a `Set`, sort, and call `rollupDay` for each.

Change scheduled output to JSON:

```ts
console.log(JSON.stringify({ event: "rollup", ...result }));
if (result.backlog) {
  console.warn(JSON.stringify({ event: "rollup_backlog", days: result.days }));
}
```

- [x] **Step 4: Verify GREEN**

Run: `npm test -- test/cron/rollup.test.ts test/health.test.ts`

Expected: rollup and entrypoint tests pass.

- [x] **Step 5: Record commit boundary**

Intended commit: `fix(cron): catch up missed rollup days`

---

### Task 4: Expire sensitive aggregate rows

**Files:**
- Modify: `test/cron/retention.test.ts`
- Modify: `src/db/stats.ts`
- Modify: `src/cron/retention.ts`

**Interfaces:**
- Produces: `deleteSensitiveDimensionsBefore(db, day, batchSize?, maxBatches?): Promise<{ deleted: number; capped: boolean }>`
- Extends: `RetentionResult` with `dimensions` and `dimensionsCapped`
- Consumes: `SENSITIVE_DIMENSIONS`

- [x] **Step 1: Write the failing retention test**

Insert old and recent rows for both `utm_campaign` and `country`. Assert that one
retention run deletes only the old campaign row, retains the old country row and
recent campaign row, and reports `dimensions: 1`.

- [x] **Step 2: Verify RED**

Run: `npm test -- test/cron/retention.test.ts`

Expected: old sensitive aggregate remains and result has no dimension count.

- [x] **Step 3: Implement bounded aggregate cleanup**

Delete by `rowid` in batches from `click_daily_dim` where `day < ?` and
`dimension` is one of the six literal sensitive names. Reuse the existing
`{deleted, capped}` loop shape from raw click deletion. Convert the Unix cutoff
to a UTC `YYYY-MM-DD` before calling it from retention.

Emit structured JSON warnings for skipped days, raw-click cap, and dimension
cap. Return all counts in `RetentionResult`.

- [x] **Step 4: Verify GREEN**

Run: `npm test -- test/cron/retention.test.ts test/db/stats.test.ts`

Expected: retention and stats DB tests pass.

- [x] **Step 5: Update human-facing data guarantees**

Modify `compliance/data-map.md`, `compliance/legitimate-interest-assessment.md`,
`docs/superpowers/specs/2026-09-01-margiolink-design.md`, and the privacy copy in
`src/routes/public.ts` to state the input policy, three-click threshold,
180-day sensitive-dimension retention, stopped term/content collection, and
bounded catch-up behavior.

- [x] **Step 6: Run the stream gate**

Run: `npm test -- test/lib/request-context.test.ts test/db/clicks.test.ts test/cron/rollup.test.ts test/cron/retention.test.ts test/compliance.test.ts test/routes/public.test.ts`

Run: `npm run typecheck`

Expected: all selected tests and all TypeScript projects pass.

- [x] **Step 7: Record commit boundary**

Intended commit: `fix(retention): expire sensitive analytics dimensions`
