# Security and performance review — 2026-09-05

## Scope

This review covered the public redirect and password paths, private API
authentication, D1 link listing and search, and dashboard statistics loading.
The baseline was the repository source before the 1.0.0 release work. Tests
used isolated local D1 databases; the review did not load test production or
measure production latency. The raw click-retention policy, privacy thresholds,
and count semantics were held constant.

## Findings and resolutions

1. **P1 — Protected-link POST bypassed lifecycle checks.** A correct password
   could open an inactive or expired link even though GET returned the
   configured inactive/expired result. GET and POST now share lifecycle
   enforcement before password work or grant issuance. Worker regressions in
   `test/routes/redirect.test.ts` cover inactive, expired, fallback, and deleted
   cases.
2. **P2 — A password grant followed a reused slug or changed password.** The
   old signature covered only slug and expiry. Version 2 grants bind the
   immutable link ID, current slug, password salt, password hash, and expiry in
   an unambiguous signed message; the credential material is not placed in the
   cookie. Password changes, link identity changes, and grants issued before
   version 1.0.0 fail closed. Token and redirect regressions cover each case.
3. **P2 — Public bodies were buffered before any size limit.** Login and
   protected-link password submissions now use a shared 16 KiB byte-counted
   stream reader before parsing. Missing and dishonest `Content-Length`, the
   exact boundary, early 413 responses, absence of PBKDF2 work, and absence of
   throttle/session/click writes are covered in `test/routes/auth.test.ts` and
   `test/routes/redirect.test.ts`.
4. **P2 — Link loading exceeded D1 and API limits.** Tag hydration now binds at
   most 100 link IDs per query. The dashboard accumulates deduplicated fixed
   20-row pages, including offsets beyond 200, while the API preserves its
   per-request limit of 1–200. Worker and React tests cover 120 tagged links,
   225-row navigation, filter reset, failure/retry, and mutation invalidation.
5. **P2 — Long searches produced a D1 error.** Search is validated at 48 UTF-8
   bytes so the two SQL wildcard bytes fit D1's 50-byte pattern limit. The API
   returns 400 beyond the boundary and the dashboard explains byte length while
   retaining the last valid results. ASCII and multibyte boundaries are tested.
6. **P2 — Detailed statistics eagerly repeated raw-click scans.** Overview and
   link detail now load summary and time series immediately, then mount the 15
   detailed dimensions and live panel on viewport entry or keyboard demand.
   The fallback without `IntersectionObserver` loads immediately. The measured
   cold initial aggregate work fell from 17 HTTP requests and 18 raw statistic
   reads to 2 requests and 3 reads when below-viewport observers remain idle.
   A synthetic 100,000-click country query took 35 ms locally during the audit;
   that figure is not a production latency measurement. Request and SQL-count
   regressions are the durable performance evidence.
7. **P2 — Private API authentication ran twice.** The private API branch now
   registers one shared session guard after the public login route. Route-table
   coverage keeps every other API handler private, and an authenticated
   `/api/meta` request asserts exactly one real session query.
8. **Browser integration — CSP blocked the protected-link redirect chain.**
   Linux Chromium showed that `form-action 'self'` applied across the external
   302 after the password POST. A successful POST now returns 200 with the
   grant cookie and a same-origin HTML handoff that starts a fresh top-level
   navigation, with an escaped, visible fallback link. If the protected link
   expires while its form is open, POST uses the same CSP-safe navigation shape
   for the configured expiry fallback without issuing a grant. GET retains its
   302 fallback behavior, and the CSP remains strict.

## Statistics cache boundary

The Workers Cache API is consulted only after successful session validation.
Summary, time series, dimensions, and top links can be stored for at most 60
seconds when the requested range is closed and fully retained; summary also
requires its full comparison range. Truly open or future ranges, truncated
primary or comparison ranges, failures, live clicks, and sparklines bypass the
cache. Dashboard ranges snapped to the current hour generally qualify once
the current time is later than the range end. Cache identity includes the full
request URL, release version, retention configuration, and authenticated
session identity. Responses sent to clients remain private/no-store.

The dashboard's non-live statistics use a 60-second client freshness window.
The live feed keeps its existing 10-second polling and pause behavior. Cache
tests use the real Worker route, D1, and Cache API and preserve raw query
results, including unsuppressed low-count dimensions. Aggregate rollup
suppression is unchanged; these raw endpoints do not use the rollup.

## Validation scope before publication

- Before the final expiry-during-form fix, the complete local unit, Worker/D1,
  and React suite passed: 806 tests in 70
  files. TypeScript, Biome, the production build and asset budgets, targeted
  post-build asset tests, and migration rollback checks also passed.
- Before that final fix, GitHub Actions run
  [`33946940486`](https://github.com/amargiovanni/margiolink/actions/runs/33946940486)
  passed the same 806 tests in 70 files, TypeScript, Biome, production build
  budgets, migration rollback, and all 41 Chromium scenarios. These browser
  scenarios include the protected-link handoff, all three deferred-analytics
  cases, the expanded accessibility sweep, QR artefacts, and the adapted
  deferred-panel layout checks.
- The final fix commit requires its own CI; final counts belong to that gate.
- Deployment, public smoke checks, the tag, and the GitHub release are later
  publication gates and are not claimed here.

## Upgrade impact

Existing per-link password grants are intentionally rejected after upgrading,
so visitors must enter the password again. This release changes no database
schema and requires no migration. It also adds no dependency or persistent
service.
