# MargioLink — URL Shortener with Analytics Dashboard

**Date:** 2026-09-01
**Status:** Approved design, ready for implementation planning
**Domain:** `link.margio.uk`

---

## 1. Purpose and scope

A single-tenant URL shortener with a rich analytics dashboard, running entirely
on Cloudflare Workers with D1 as the only datastore.

**In scope:** short link creation and management (custom slug, expiry,
active/inactive, tags, optional password, QR code), public redirect endpoint,
click analytics ingestion and aggregation, an admin dashboard covering desktop,
tablet and mobile.

**Explicitly out of scope:** multi-user accounts and roles, geo/device-based
routing to different destinations, R2 (evaluated and dropped — nothing in this
product needs object storage), API tokens for third-party integrations.

**Non-goals that could look like goals:** this is not a privacy-invasive
analytics product. No IP address is stored, no cross-site tracking cookie is
set, no visitor can be followed across days.

---

## 2. Architecture

One Worker bound to `link.margio.uk`, serving three surfaces:

| Route          | Responsibility                | Auth              |
| -------------- | ----------------------------- | ----------------- |
| `/:slug`       | Public redirect (hot path)    | none              |
| `/api/*`       | JSON API for the dashboard    | session cookie    |
| `/app/*`       | React SPA (static assets)     | page public, data not |
| `/privacy`     | Public privacy notice         | none              |

Reserved slugs, rejected at creation time: `app`, `api`, `privacy`, `assets`,
`robots.txt`, `favicon.ico`, `_health`. Without this, a link could make the
dashboard unreachable.

### 2.1 Redirect path

The only latency-sensitive path.

1. Resolve slug in D1.
2. Reject if soft-deleted, inactive, or expired.
3. Respond `302` immediately.
4. Record the click inside `ctx.waitUntil()` — after the response is already
   on the wire, so database latency never reaches the visitor.

The QR code for a link encodes `https://link.margio.uk/<slug>?s=qr`, which is
how a scan is distinguished from an ordinary click. The parameter is stripped
before redirecting.

Outcomes, all recorded: `redirect`, `inactive`, `expired`, `password_required`,
`password_failed`.

An unknown slug returns 404 and is **not** recorded: there is no link to
attribute the event to, and `clicks.link_id` is `NOT NULL` by design.

Expired links go to the link's fallback URL when set, otherwise to a courtesy
page. Password-protected links serve an interstitial; the password is verified
server-side and grants a signed token cookie scoped to that slug, valid for
10 minutes.

### 2.2 Ingestion boundary

All click recording goes through one function:

```ts
recordClick(env: Env, event: ClickEvent): Promise<void>
```

The D1 implementation sits behind it. If write volume ever demands Cloudflare
Queues, this is the only call site that changes — the dashboard is unaffected.
This is the reason the simple approach is not a dead end.

### 2.3 Scheduled work

- **Hourly cron** — roll raw clicks into daily aggregate tables.
- **Daily cron** — delete raw clicks past the retention window; purge expired
  admin sessions and stale login-attempt rows.

Aggregate tables are kept indefinitely: they hold counts, not personal data.

---

## 3. Data model

### 3.1 Link tables

```sql
links (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  slug          TEXT    NOT NULL UNIQUE,   -- stored lowercase, matched exactly
  target_url    TEXT    NOT NULL,
  title         TEXT,
  description   TEXT,
  password_hash TEXT,                      -- NULL = no password
  password_salt TEXT,
  expires_at    INTEGER,                   -- unix seconds, NULL = never
  expired_url   TEXT,                      -- fallback after expiry
  is_active     INTEGER NOT NULL DEFAULT 1,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  deleted_at    INTEGER                    -- soft delete, restorable
)

tags      (id INTEGER PK, name TEXT NOT NULL UNIQUE, color TEXT NOT NULL)
link_tags (link_id INTEGER, tag_id INTEGER, PRIMARY KEY (link_id, tag_id))
```

### 3.2 Raw events

```sql
clicks (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  link_id        INTEGER NOT NULL REFERENCES links(id) ON DELETE CASCADE,
  ts             INTEGER NOT NULL,          -- unix seconds, UTC
  visitor_hash   TEXT    NOT NULL,          -- see 4.1
  source         TEXT    NOT NULL,          -- 'link' | 'qr'
  outcome        TEXT    NOT NULL,
  is_bot         INTEGER NOT NULL DEFAULT 0,

  continent TEXT, country TEXT, region TEXT, city TEXT, timezone TEXT,
  asn_org   TEXT, colo    TEXT,

  device_type TEXT, os TEXT, os_version TEXT,
  browser TEXT, browser_version TEXT, language TEXT,

  referrer_host TEXT, referrer_url TEXT, referrer_type TEXT,
  utm_source TEXT, utm_medium TEXT, utm_campaign TEXT,
  utm_term TEXT, utm_content TEXT
)
```

Indexes: `(link_id, ts)`, `(ts)`.

Every field above comes from `request.cf` or from request headers. No call to
any third-party service is made; no data leaves Cloudflare.

Device, OS and browser are read from client hints (`Sec-CH-UA`,
`Sec-CH-UA-Platform`, `Sec-CH-UA-Mobile`) when the browser sends them, falling
back to user-agent parsing otherwise. Client hints are both more reliable and
less identifying than a full UA string.

### 3.3 Aggregates

```sql
click_daily (
  day TEXT, link_id INTEGER,
  clicks INTEGER, uniques INTEGER, bots INTEGER,
  PRIMARY KEY (day, link_id)
)

click_daily_dim (
  day TEXT, link_id INTEGER,
  dimension TEXT,   -- 'country' | 'city' | 'device' | 'os' | 'browser'
                    -- | 'referrer_type' | 'referrer_host' | 'utm_source'
                    -- | 'utm_medium' | 'utm_campaign' | 'language'
                    -- | 'asn_org' | 'dow_hour' | 'source' | 'outcome'
  value TEXT,
  clicks INTEGER, uniques INTEGER,
  PRIMARY KEY (day, link_id, dimension, value)
)
```

One generic dimension table rather than a table per dimension: the rollup is a
loop over dimension names, and every dashboard breakdown is the same query with
a different `dimension` value.

`dow_hour` stores `"<weekday>-<hour>"` and feeds the hour-by-weekday heatmap.

### 3.4 A stated limitation on unique counts

Daily `uniques` summed across a range **over-counts** — a visitor returning on
three days contributes three. The dashboard must label multi-day unique figures
honestly, and compute a true `COUNT(DISTINCT visitor_hash)` from raw `clicks`
when the requested range falls inside the retention window.

### 3.5 Auth tables

```sql
admin_sessions (
  id TEXT PRIMARY KEY,            -- SHA-256 of the 256-bit random token
                                  -- held in the cookie; the token itself
                                  -- is never stored
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  ua_summary TEXT                 -- "Safari on macOS", for the sessions list
)

login_attempts (
  ip_hash TEXT PRIMARY KEY,       -- HMAC with the daily key, see 4.1;
                                  -- rows purged daily
  attempts INTEGER NOT NULL,
  first_attempt_at INTEGER NOT NULL,
  locked_until INTEGER
)
```

### 3.6 Migrations

`wrangler d1 migrations` is forward-only, which does not satisfy the project
mandate that migrations be reversible. Convention:

```
migrations/0001_init.sql
migrations/down/0001_init.down.sql
```

plus an `npm run db:rollback` script that applies the down file and rewinds the
`d1_migrations` bookkeeping table. The rollback is executed for real as part of
the completion gate, not assumed to work.

---

## 4. Privacy and legal basis

Decided before the schema exists, as the project mandate requires.

### 4.1 What is not collected

**No IP address is stored, in any form — not raw, not truncated, not hashed
into a stable value. No raw user-agent string is stored.**

One narrow exception, stated rather than buried: the login rate limiter in
`login_attempts` keys on an IP hash. It uses the same daily-rotating HMAC key
below, so it too becomes uncorrelatable after 24 hours, and its rows are purged
by the daily cron as soon as the lockout window closes. It exists to protect
the account, not to measure anyone.

Visitor de-duplication uses:

```
visitor_hash = HMAC-SHA256(secret || YYYY-MM-DD, ip || ua || slug)   [truncated to 128 bits]
```

The date is part of the HMAC key, so the hash for the same visitor changes at
every UTC midnight. **After 24 hours a visitor cannot be linked to their own
earlier activity.** Pseudonymisation here is mechanical, not a policy promise.
The daily key is derived from a Worker secret and the date; nothing is stored.

### 4.2 Legal basis

- **Article 6(1)(f), legitimate interest** — measuring the effectiveness of
  one's own links. Data is pseudonymous, there is no profiling, and no decision
  is taken about any person. A short legitimate-interest assessment is recorded
  in `compliance/`.
- **No Article 9 special-category data** is processed.
- **Cookies:** only the admin session cookie and the link-password token, both
  strictly necessary. No tracking cookie is set on visitors, therefore no
  consent banner is required.

### 4.3 Minimisation and retention

- Raw `clicks` rows: **180 days**, then deleted by the daily cron.
- Aggregates: indefinite (counts only, no personal data).
- City-level geography is the finest granularity kept; latitude/longitude
  available from `request.cf` is deliberately not stored.

A public privacy notice is served at `/privacy`. The data map and Article 30
record are produced with the `gdpr-evidence` skill during implementation.

---

## 5. Security

1. **Login rate limiting** — per-IP-hash counter in D1 with progressive
   backoff and lockout. Without it, a password in an env var is one brute-force
   attempt away from compromise on the open internet.
2. **Session cookie** — `__Host-` prefixed, `HttpOnly`, `Secure`,
   `SameSite=Lax`. Session id hashed at rest; sessions are revocable
   individually or all at once.
3. **Constant-time credential comparison** against `ADMIN_USER` /
   `ADMIN_PASSWORD`, held as Worker secrets (`wrangler secret put`), never
   bundled and never committed.
4. **Destination URL validation** — `http`/`https` only; `javascript:`,
   `data:` and friends rejected; self-referential targets on `link.margio.uk`
   rejected to prevent redirect loops.
5. **Rate limiting on link creation** via the API.
6. **Explicit authorization per route.** Every authenticated route is mounted
   under a session middleware, and a test enumerates the registered routes and
   fails if any non-public route is defined outside that group. This is the
   Workers equivalent of the project's "every authenticated endpoint has a
   Policy" rule.
7. **Link passwords** — PBKDF2-SHA256 via WebCrypto (bcrypt is unavailable on
   Workers), per-link salt, 100k iterations.

---

## 6. Dashboard

One responsive application, not a desktop app with a reduced mobile variant.
Collapsible sidebar on desktop; bottom navigation bar on mobile; tables become
stacked cards below 640px rather than requiring horizontal scroll.

### 6.1 Screens

**Overview** — KPI row (total clicks, unique visitors, countries reached, bot
share), each with a sparkline and a delta against the preceding period of equal
length. Below: the time series area chart, with granularity adapting to the
selected range (24h → hourly, 12 months → weekly); top links; world map;
device breakdown.

**Links** — the working list. Instant search, filters by tag and status, a
7-day sparkline per row, one-tap copy. Creation from anywhere via `⌘K`: paste
URL, slug auto-generated but editable, Enter, short link already on the
clipboard.

**Link detail** — every collected dimension as a ranked list with proportional
bars: countries with flags, cities, browsers, operating systems, devices,
referrers by type, UTM campaigns, languages, network operators. Plus the
hour-by-weekday heatmap, a live click feed polling every 10 seconds, the QR
code downloadable as SVG and PNG with scans counted separately, and the outcome
breakdown (how many hit an expired link or failed a password).

**Settings** — active sessions with revocation; the retention window shown
read-only (it is a Worker environment variable, not editable state, so no
settings table exists); and data export, which streams CSV from an API endpoint
straight to the browser — no object storage involved.

### 6.2 Design and accessibility

Palette and typography defined as tokens in `@theme` (Tailwind 4 — no
`tailwind.config.js`). Light and dark themes both designed, not one derived by
inverting the other. Short transitions that disappear under
`prefers-reduced-motion`.

Target: **WCAG 2.2 level AA**. Fully keyboard operable, focus always visible,
contrast verified in real component states, and no chart conveying information
by colour alone. Building to this level now costs a fraction of retrofitting
it, and the EAA makes it mandatory for public-facing interfaces.

---

## 7. Technology choices

**Worker:** TypeScript, Hono for routing, Zod for input validation, `bowser`
for user-agent fallback parsing, `isbot` for bot detection,
`qrcode-generator` for server-side SVG QR codes.

`ua-parser-js` is deliberately avoided: from v2 it is AGPL-licensed, which is
not a liability worth taking on for an accessory feature. `bowser` is MIT.

**Dashboard:** React 19, React Router 7, TanStack Query 5, Recharts 3, Radix
primitives, `cmdk`, `sonner`, `lucide-react`, React Hook Form + Zod,
`clsx`/`tailwind-merge`, `date-fns`. World map via `d3-geo` +
`topojson-client` + `world-atlas`, lazy-loaded in a separate chunk (~90KB gzip)
only when the map enters the viewport.

**Build and tooling:** Vite 7, Tailwind CSS 4, Wrangler 4, Vitest 3 with
`@cloudflare/vitest-pool-workers`, Biome for lint and format.

Data layer is hand-written SQL behind a repository module rather than an ORM:
roughly half the queries are analytical `GROUP BY`s that an ORM would only
obscure.

### 7.1 Declared deviations from the repository CLAUDE.md

That file describes a Laravel house. This project is TypeScript on Cloudflare
Workers, so:

- **Pest → Vitest** (`@cloudflare/vitest-pool-workers`).
- **Pint → Biome.**
- **Policies → route-level session middleware** plus the route-enumeration test
  described in §5.6.

The underlying mandates are unchanged: every feature ships with a test, every
migration is reversible, and "done" requires shown output.

---

## 8. Testing

Tests run inside workerd against a real D1 database, so analytical queries are
actually executed by SQLite rather than mocked.

Minimum coverage before any completion claim:

- Slug generation, collision handling, reserved-slug rejection.
- Destination URL validation, including `javascript:` and self-referential
  loops.
- All redirect outcomes: ok, inactive, expired with and without fallback,
  password required, password wrong.
- Login success, failure, and rate limit actually triggering.
- The route-enumeration test from §5.6.
- Rollup cron output compared against counts computed from raw rows.
- Salt rotation: the same visitor on two different days produces uncorrelated
  hashes.
- Migration rollback executed end to end.

**Completion gate:** `npm test` green, `biome check` clean,
`wrangler deploy --dry-run` passing, plus at least one real redirect and one
dashboard screenshot, with output shown.

---

## 9. Build order

Each slice stands on its own and is a sensible commit on a `feature/` branch.

1. Project scaffold, schema, migrations with working rollback.
2. Redirect path and click recording.
3. API and authentication.
4. Dashboard shell: link list, creation, overview.
5. Rich analytics and link detail.
6. Rollup, retention, QR codes, and polish.
