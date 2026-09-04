# MargioLink Authentication and Edge Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make credential throttling concurrency-safe, version link-password hashes, and add meaningful readiness and HTTP security policy.

**Architecture:** Reserve every credential attempt with a single D1 upsert tagged by a cryptographic reservation ID. Keep legacy hashes readable while issuing a versioned stronger format, and centralize dynamic/static response hardening with a separate readiness probe.

**Tech Stack:** TypeScript, Cloudflare Workers, Hono, D1/SQLite, Web Crypto, Vitest Workers pool.

**Spec:** `docs/superpowers/specs/2026-09-04-margiolink-production-hardening-design.md`

## Global Constraints

- Keep existing links, sessions, and legacy password hashes valid.
- Block locked requests before credential comparison or PBKDF2.
- Do not expose readiness error details to callers.
- Preserve public route behavior and reversible migrations.
- Every production behavior starts with a failing test.

---

### Task 1: Add reservation identity to the throttle row

**Files:**
- Create: `migrations/0003_rate_limit_reservation.sql`
- Create: `rollback/0003_rate_limit_reservation.down.sql`
- Modify: `test/migration.test.ts`

**Interfaces:**
- Produces: nullable `login_attempts.reservation_id TEXT`

- [x] **Step 1: Write a failing migration assertion**

Extend the live-schema migration test to expect `reservation_id` on
`login_attempts` and include it in the exact column set.

- [x] **Step 2: Verify RED**

Run: `npm test -- test/migration.test.ts`

Expected: the column-set assertion fails because the column is absent.

- [x] **Step 3: Add reversible migration**

Forward SQL:

```sql
ALTER TABLE login_attempts ADD COLUMN reservation_id TEXT;
```

Rollback SQL:

```sql
ALTER TABLE login_attempts DROP COLUMN reservation_id;
```

- [x] **Step 4: Verify GREEN and rollback**

Run: `npm test -- test/migration.test.ts`

Run: `npm run db:verify-rollback`

Expected: schema test passes and rollback changes then restores the schema.

- [x] **Step 5: Record commit boundary**

Intended commit: `feat(auth): add atomic attempt reservation field`

---

### Task 2: Reserve attempts atomically

**Files:**
- Modify: `test/auth/rate-limit.test.ts`
- Modify: `src/auth/rate-limit.ts`
- Modify: `src/routes/api/auth.ts`
- Modify: `src/routes/redirect.ts`
- Modify: `test/routes/auth.test.ts`
- Modify: `test/routes/redirect.test.ts`

**Interfaces:**
- Produces: `reserveLoginAttempt(db: D1Database, key: string, now: number): Promise<RateLimitResult>`
- Preserves: `clearLoginFailures` and `deleteStaleLoginAttempts`
- Removes callers of: `checkLoginAllowed` and `registerLoginFailure`

- [x] **Step 1: Write failing reservation tests**

Replace sequential registration tests with calls to `reserveLoginAttempt`.
Assert attempts 1 through 8 are allowed, the ninth is blocked with positive
`retryAfter`, and `Promise.all` over 16 reservations produces exactly eight
allowed results and stores `attempts = 8` rather than losing increments.

- [x] **Step 2: Verify RED**

Run: `npm test -- test/auth/rate-limit.test.ts`

Expected: import fails because `reserveLoginAttempt` does not exist.

- [x] **Step 3: Implement one-statement reservation**

Generate `crypto.randomUUID()` per request. Use `INSERT ... ON CONFLICT DO
UPDATE ... RETURNING attempts, locked_until, reservation_id`. Preserve all
fields when `locked_until > now`; otherwise reset an expired ordinary window or
increment the existing round, set 15-minute/1-hour/24-hour lock durations at
attempts 8/16/24, and store the new reservation ID.

The caller is allowed only when the returned `reservation_id` equals its own.
For a blocked result calculate `retryAfter` from the returned lock timestamp.

- [x] **Step 4: Route every credential path through reservation**

Call `reserveLoginAttempt` after request-shape validation and before secret
comparison/PBKDF2. Clear on success; do not register again on failure. Add
`.max(200)` to admin credentials. Reject protected-link passwords longer than
200 characters with the existing wrong-password response without derivation.

- [x] **Step 5: Verify GREEN**

Run: `npm test -- test/auth/rate-limit.test.ts test/routes/auth.test.ts test/routes/redirect.test.ts`

Expected: exact concurrent accounting and all route behavior pass.

- [x] **Step 6: Record commit boundary**

Intended commit: `fix(auth): reserve throttle attempts atomically`

---

### Task 3: Version link-password hashes

**Files:**
- Modify: `test/lib/crypto.test.ts`
- Modify: `test/routes/links-api.test.ts`
- Modify: `src/lib/crypto.ts`
- Modify: `scripts/seed-demo.mjs`
- Modify: `test/demo-seed.test.ts`

**Interfaces:**
- Produces: new hashes formatted `pbkdf2-sha256$600000$<64 lowercase hex>`
- Consumes: legacy `<64 lowercase hex>` hashes as PBKDF2-SHA256/100000
- Preserves: `hashPassword(password, saltHex): Promise<string>` and `verifyPassword(...)`

- [x] **Step 1: Write failing format and compatibility tests**

Assert new hash output matches:

```ts
expect(hash).toMatch(/^pbkdf2-sha256\$600000\$[0-9a-f]{64}$/);
```

Use the current implementation once to fix a literal legacy digest fixture,
then assert that digest verifies. Assert malformed encodings return `false`.

- [x] **Step 2: Verify RED**

Run: `npm test -- test/lib/crypto.test.ts test/routes/links-api.test.ts`

Expected: new-format assertion fails on the unprefixed 100,000-iteration hash.

- [x] **Step 3: Implement versioned derivation**

Extract private `derivePassword(password, saltHex, iterations)`. Have
`hashPassword` derive at 600,000 and prefix the algorithm/work factor.
`verifyPassword` accepts the exact new prefix or a 64-character legacy hex
digest, rejects everything else before derivation, and compares fixed-size
digests through `constantTimeEquals`. Make the demo seed's independent WebCrypto
helper emit the identical encoded format so sample links do not create legacy
hashes.

- [x] **Step 4: Verify GREEN and benchmark**

Run: `npm test -- test/lib/crypto.test.ts test/routes/links-api.test.ts test/routes/redirect.test.ts`

Run a local Worker-runtime test timing ten new derivations and record the median
in the execution notes; it must complete without a Worker CPU exception.

Execution note (2026-09-04): ten derivations completed in workerd with a
37.5 ms median and no CPU exception.

- [x] **Step 5: Record commit boundary**

Intended commit: `feat(auth): version link password hashes`

---

### Task 4: Add security headers and readiness

**Files:**
- Create: `src/lib/security-headers.ts`
- Create: `src/lib/readiness.ts`
- Create: `web/public/_headers`
- Modify: `src/index.ts`
- Modify: `src/lib/slug.ts`
- Modify: `test/health.test.ts`
- Modify: `test/lib/slug.test.ts`
- Modify: `test/routes/landing.test.ts`
- Modify: `README.md`

**Interfaces:**
- Produces: `applySecurityHeaders(response: Response): Response`
- Produces: `checkReadiness(env: Env): Promise<boolean>`
- Adds: `GET /_ready`

- [x] **Step 1: Write failing dynamic-header and readiness tests**

Assert `/_health` has `nosniff`, `DENY`, HSTS, referrer, permissions, and CSP
headers. Assert `/_ready` returns 200 against real test bindings and 503 through
`app.request` with an absent hash secret. Assert `_ready` is reserved.

- [x] **Step 2: Verify RED**

Run: `npm test -- test/health.test.ts test/lib/slug.test.ts`

Expected: headers are absent, readiness is 404, and `_ready` is not reserved.

- [x] **Step 3: Implement dynamic policy and readiness**

Use Hono middleware to await `next()` and set the six response headers. Keep
the policy in one exported constant map. `checkReadiness` validates all required
strings, positive numeric retention, `ASSETS.fetch`, and executes
`SELECT 1 AS ok FROM links LIMIT 1`; it catches and logs structured error data.

Add `/_ready` before the API and catch-all redirect routes. Return only
`{"ok":false}` on failure.

- [x] **Step 4: Add static asset policy**

Create `web/public/_headers` with a `/*` rule matching the dynamic policy and an
`/assets/*` rule with:

```text
Cache-Control: public, max-age=31536000, immutable
```

Compute the SHA-256 CSP token for the existing inline theme bootstrap exactly;
do not enable `script-src 'unsafe-inline'`.

- [x] **Step 5: Verify GREEN and built asset behavior**

Run: `npm test -- test/health.test.ts test/lib/slug.test.ts test/routes/landing.test.ts`

Run: `npm run build:web`

Assert `web/dist/_headers` exists and the production build passes.

- [x] **Step 6: Update deployment documentation**

Change the post-deploy probe in `README.md` from `/_health` to `/_ready` and
explain liveness versus readiness in one paragraph.

- [x] **Step 7: Run the stream gate**

Run: `npm test -- test/auth/rate-limit.test.ts test/routes/auth.test.ts test/routes/redirect.test.ts test/lib/crypto.test.ts test/routes/links-api.test.ts test/health.test.ts test/lib/slug.test.ts test/routes/landing.test.ts test/migration.test.ts`

Run: `npm run typecheck`

Run: `npm run db:verify-rollback`

Expected: all selected tests, types, and rollback verification pass.

- [x] **Step 8: Record commit boundary**

Intended commit: `feat(edge): add readiness and response hardening`
