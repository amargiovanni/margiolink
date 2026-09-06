# MargioLink Production Hardening

**Date:** 2026-09-04
**Status:** Implemented
**Supersedes:** only the affected security, retention, and analytics assumptions in
`docs/superpowers/specs/2026-09-01-margiolink-design.md`

## 1. Goal

Harden the existing single-tenant Cloudflare Workers application without adding
external services or changing its product model. The change must close the
identified privacy and concurrency risks, make retention recoverable after an
outage, make deployment health meaningful, and reduce avoidable browser and D1
work.

The work is delivered as independently reviewable streams, in this order:

1. analytics data safety and lifecycle;
2. authentication and HTTP edge hardening;
3. runtime and frontend efficiency;
4. honest historical-statistics metadata.

Each stream must leave the application deployable and have its own red-green
test cycle. No production deployment is part of this specification.

## 2. Constraints

- Keep the single Worker, D1 datastore, React SPA, and existing public URLs.
- Do not add third-party analytics, identity, CAPTCHA, queue, or logging services.
- Do not store raw IP addresses, raw user-agent strings, or cross-day visitor IDs.
- Keep existing short links, sessions, and legacy link-password hashes valid.
- Preserve reversible migrations and the migration rollback gate.
- Keep `/_health` as a cheap liveness probe; readiness is a separate endpoint.
- Prefer explicit bounds and deletion over claims that arbitrary grouped values
  are automatically anonymous.

## 3. Analytics data safety and lifecycle

### 3.1 Campaign input boundary

Only `utm_source`, `utm_medium`, and `utm_campaign` remain collected. A shared
normalizer trims each value and accepts at most 64 ASCII characters from
`A-Z`, `a-z`, `0-9`, `.`, `_`, `~`, and `-`. Empty or invalid values become
`null`. `utm_term` and `utm_content` remain as legacy nullable database columns
for migration compatibility but are no longer populated.

This is intentionally stricter than generic URL syntax: campaign dimensions
are labels, not arbitrary user content. The rule excludes email addresses,
free-form sentences, control characters, and unbounded values before they reach
D1.

### 3.2 Aggregate privacy threshold

The following high-cardinality or user-influenced dimensions are written to
`click_daily_dim` only when at least three non-bot clicks share the same value
for the same link and UTC day:

- `city`;
- `asn_org`;
- `referrer_host`;
- `utm_source`;
- `utm_medium`;
- `utm_campaign`.

The rollup query applies `HAVING COUNT(*) >= 3`; suppressed values are not
stored as distinct rows. Coarse dimensions and daily totals keep their existing
behavior.

### 3.3 Finite retention for sensitive dimensions

High-cardinality dimension rows use the same 180-day retention configured by
`RAW_RETENTION_DAYS`. Daily totals and coarse dimensions remain indefinitely
available. The retention job deletes historical high-cardinality rows as part
of its bounded daily work and reports how many it removed.

Existing historical rows are covered by the same cleanup, so the fix applies to
data created before deployment as well as new traffic. The data map, privacy
notice, legitimate-interest assessment, and original architecture document
must be updated to state the implemented boundary and retention accurately.

### 3.4 Rollup catch-up

Every hourly rollup processes:

1. at most seven oldest complete UTC days that contain raw clicks but no daily
   aggregate;
2. yesterday;
3. today.

Days are de-duplicated and ordered oldest first. The result reports processed
days and whether a backlog remains. Scheduled logs are structured JSON and a
remaining backlog is emitted at warning severity. The existing retention guard
continues refusing to delete raw clicks for any unaggregated day.

This makes outages self-healing while bounding each invocation. At seven catch-
up days per hour, even a long outage drains predictably without an unbounded cron
run.

## 4. Authentication and HTTP hardening

### 4.1 Atomic attempt reservation

Credential attempts are reserved before password verification with one atomic
D1 upsert. The statement increments or resets the window counter and establishes
the progressive lock when a threshold is reached. Its conflict-update clause
does nothing while an active lock exists; no returned row therefore means the
caller must answer `429` without running PBKDF2 or comparing credentials.

The threshold-crossing request is allowed to complete. A successful credential
check clears the row; a failed one leaves the new count and any lock in place.
Concurrent requests consequently receive distinct reservations and cannot lose
increments through a read-modify-write race.

Both admin login and protected-link submission use this API. Tests cover exact
sequential behavior, active-lock retries, window reset, progressive locks, and a
parallel burst.

### 4.2 Versioned password hashes

New link passwords use the encoded form:

```text
pbkdf2-sha256$600000$<hex digest>
```

Verification accepts both the encoded form and existing unprefixed 100,000-
iteration digests. Existing hashes therefore remain valid; editing a link with
a password writes the new form. A public password submission does not rewrite
the link row.

Admin-login and public link-password inputs are limited to 200 characters.
Oversized public submissions receive the existing generic wrong-password
response without running PBKDF2. The atomic rate limiter runs before any
credential comparison or derivation. Tests cover both hash formats, malformed
encodings, the input bound, and constant-time digest comparison through the
existing verification path.

### 4.3 Security headers

Worker-generated responses receive a shared header policy:

- `Content-Security-Policy` with `default-src 'self'`, `base-uri 'self'`,
  `object-src 'none'`, `frame-ancestors 'none'`, `form-action 'self'`,
  `img-src 'self' data:`, `font-src 'self'`, and `connect-src 'self'`;
- `script-src` permits self-hosted scripts plus the fixed SHA-256 hash of the
  landing page's inline theme bootstrap, without `unsafe-inline`;
- `style-src 'self' 'unsafe-inline'` remains necessary for the landing page's
  current static style attributes and the dashboard's data-driven inline
  presentation styles;
- `X-Content-Type-Options: nosniff`;
- `Referrer-Policy: strict-origin-when-cross-origin`;
- `Permissions-Policy` disabling camera, microphone, geolocation, and payment;
- `X-Frame-Options: DENY` plus CSP `frame-ancestors 'none'`;
- `Strict-Transport-Security: max-age=31536000` for this HTTPS-only host.

An asset `_headers` file applies the equivalent policy to static responses.
Hashed files under `/assets/*` additionally receive
`Cache-Control: public, max-age=31536000, immutable`; HTML remains revalidated.

### 4.4 Readiness

`/_health` remains an unconditional liveness response. New endpoint `/_ready`
returns `200 {"ok":true}` only when:

- required environment strings are present and retention is a positive number;
- the D1 binding can query the required `links` table;
- the static-assets binding exposes `fetch`.

Failures return a generic `503 {"ok":false}` and log a structured server-side
error without exposing configuration or database details. `_ready` becomes a
reserved slug and the deployment documentation uses it for post-deploy checks.

## 5. Runtime and frontend efficiency

### 5.1 Session touch throttling

Reading a valid session updates `last_seen_at` only when its stored value is at
least five minutes old. Requests inside that interval remain read-only and
return the stored timestamp. This removes repeated D1 writes from dashboard
query fan-out without materially changing the session-management display.

### 5.2 Route and font loading

Dashboard pages are loaded through `React.lazy` under one accessible Suspense
fallback. The login route no longer downloads page modules that require an
authenticated session. Route behavior and the existing not-found page remain
unchanged.

Font imports are restricted to the Latin and Latin Extended WOFF2 subsets and
the weights the UI uses. The build must no longer emit Greek, Cyrillic, or
Vietnamese font assets.

A repository script verifies two durable budgets after the production build:

- no emitted JavaScript entry or lazy chunk exceeds 180 KiB gzip;
- no unexpected font subset filename is emitted.

CI runs the budget after `build:web`. The budget applies to code chunks, not
screenshots displayed by the landing page.

## 6. Historical-statistics honesty

The current API continues reading raw events; implementing a hybrid raw plus
aggregate query engine is a separate product feature because it changes unique-
visitor semantics across UTC days.

In this hardening pass, every range-based statistics response gains a `meta`
object containing:

```ts
interface StatsMeta {
  requestedFrom: number;
  effectiveFrom: number;
  retentionCutoff: number;
  truncated: boolean;
  uniquesDefinition: "daily-rotating-visitor-hash";
}
```

`effectiveFrom` is clamped to the retention cutoff. This prevents a caller from
mistaking a partial result for complete history while preserving the existing
numeric payloads. The dashboard may continue preventing out-of-range choices,
but shared TypeScript response types expose the metadata for future UI copy.

## 7. Failure handling and observability

- Client-controlled invalid campaign values are discarded, not reported as
  server errors.
- Readiness returns no secret or SQL error text to callers.
- Scheduled jobs log JSON objects with an event name, processed counts, backlog
  state, and retention skips.
- Authentication answers locked callers before credential work and preserves
  `Retry-After`.
- Cleanup and catch-up are bounded; a later cron invocation continues progress.

## 8. Verification and acceptance

The change is complete only when all of the following hold:

- malicious, oversized, and free-form UTM inputs never reach D1;
- `utm_term` and `utm_content` are no longer written;
- high-cardinality aggregate values with fewer than three clicks are absent;
- high-cardinality aggregates older than the configured retention are deleted;
- an outage longer than 48 hours is recovered over bounded hourly runs;
- a concurrent credential burst produces exact attempt accounting and lockout;
- legacy and versioned link-password hashes both verify;
- dynamic and static responses carry the intended headers;
- readiness fails closed for missing configuration and database schema;
- repeated session reads inside five minutes perform no update;
- production build budgets pass and unused font subsets are absent;
- statistics responses state when their range was truncated;
- lint, all TypeScript projects, unit/integration tests, web build, migration
  rollback verification, Wrangler deploy dry-run, and CI E2E are green.

## 9. Explicitly out of scope

- Deployment or modification of production D1 data in this implementation
  session.
- Turnstile, Durable Objects, Queues, external monitoring, or a second Worker.
- Cross-day stable visitor identifiers.
- A complete hybrid raw/aggregate statistics query engine.
- Visual redesign of the dashboard or landing page.
