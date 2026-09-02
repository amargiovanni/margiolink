# MargioLink

A URL shortener with rich click analytics that never stores an IP address.

[![CI](https://github.com/amargiovanni/margiolink/actions/workflows/ci.yml/badge.svg)](https://github.com/amargiovanni/margiolink/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

MargioLink runs as a single Cloudflare Worker with D1 as its only datastore.
It shortens links, redirects visitors in a few milliseconds, and records enough
about each click to answer real questions — which country, which device, which
channel, what time of day — without ever writing down who the visitor was.

> **Status:** the backend and the dashboard are both complete, covered by 640
> tests — 350 inside `workerd` against real D1, 290 in a browser (jsdom)
> environment — plus 22 end-to-end tests in a real Chromium, in CI on every
> pull request. Sign in at `/app`. See [Roadmap](#roadmap).

---

## Contents

- [Why this exists](#why-this-exists)
- [What it does](#what-it-does)
- [How the privacy design works](#how-the-privacy-design-works)
- [Architecture](#architecture)
- [The dashboard](#the-dashboard)
- [Running it locally](#running-it-locally)
- [End-to-end tests](#end-to-end-tests)
- [Deploying your own](#deploying-your-own)
- [Configuration](#configuration)
- [API reference](#api-reference)
- [Data model](#data-model)
- [Scheduled jobs](#scheduled-jobs)
- [Development](#development)
- [Compliance](#compliance)
- [Roadmap](#roadmap)
- [Contributing, security, licence](#contributing-security-licence)

---

## Why this exists

Most link shorteners answer "how many people clicked?" by keeping a row that
identifies the person who clicked. That is a choice, not a requirement. The
interesting analytics — which country, which device, which channel, which hour
— survive perfectly well without an identifier that outlives the day.

MargioLink is built the other way round: the privacy property comes first and
the measurement is fitted to it. The result is a system where "we don't track
you" is a statement about the code rather than about intentions, and where the
[public privacy notice](src/routes/public.ts) says things that a test enforces.

It is also small enough to read. The whole backend is a few thousand lines of
TypeScript with no ORM, no framework beyond a router, and no service you have
to sign up for besides Cloudflare.

## What it does

**Links**

- Short links with generated or custom slugs, from an alphabet with no
  ambiguous characters (`0`/`O`, `1`/`l`/`I` are all absent)
- Expiry dates, with an optional fallback URL to send late arrivals to
- Activate and deactivate without deleting
- Optional per-link password, gated by an interstitial
- Tags, with colours, for organising and filtering
- QR codes as SVG, encoding a marker so scans count separately from clicks
- Soft delete and restore

**Analytics** — recorded on every click

- Country, region, city, time zone, network operator, and the Cloudflare
  datacenter that served the request
- Device type, operating system, browser, preferred language
- Referrer host, classified as direct, search, social, email or AI
- The five UTM parameters
- Whether the visitor was a bot, kept out of every human-facing figure
- Which of five outcomes the request produced: redirected, inactive, expired,
  password required, password failed

**Queries**

- Summary with a comparison against the immediately preceding window of equal
  length, which is what makes a delta meaningful
- Time series bucketed by hour, day or Monday-start week
- Breakdowns across fifteen dimensions, including an hour-by-weekday matrix
- A live feed of recent clicks
- Per-link sparklines, zero-filled so gaps are visible

**Operations**

- Hourly rollup into pre-aggregated daily tables
- Daily retention job that deletes raw click rows past their window
- Reversible migrations, verified in CI

## How the privacy design works

**No IP address is ever written to the database.** Neither is the raw
user-agent string. Both are read into memory on the redirect path, used as
input to one hash, and discarded.

That hash is the whole trick:

```
visitor_hash = HMAC-SHA256(key = HASH_SECRET + ":" + <today's UTC date>,
                           message = ip + user-agent + slug)
```

The date is part of the **key**, not the message. That distinction is the
design: both arrangements produce a different value each day, but only this one
means yesterday's key no longer exists to be applied. A visitor is
distinguishable from another visitor within a UTC day, and indistinguishable
from their own past self across days.

Three consequences follow, and they are stated in the privacy notice because
they are true rather than because they sound good:

- **Unique-visitor counts are honest within a day and deliberately imprecise
  across one.** Summing daily uniques over a month counts a returning visitor
  once per day. This is a real limitation of the design, not a bug, and it is
  documented where a consumer of the API will see it.
- **The hash is per-link.** The same person visiting two of your links produces
  two unrelated values, so nothing accumulates into a profile.
- **Rotating `HASH_SECRET` resets the counts.** Every existing hash becomes
  discontinuous. Rotate it if it leaks; do not rotate it on a schedule.

Beyond visitors, the only IP-derived value stored anywhere is in
`login_attempts`, where the same daily-rotating HMAC throttles brute-force
attempts against the admin password. It is purged daily and exists to protect
the account, not to measure anyone.

Two cookies exist in the entire system: the admin session, and a ten-minute
token proving a visitor entered the right password for a protected link.
Neither is used for measurement, and both are disclosed at `/privacy`.

## Architecture

One Worker, three surfaces:

| Route | What it does | Auth |
| --- | --- | --- |
| `/:slug` | Public redirect — the hot path | none |
| `/api/*` | JSON API, 21 routes | session cookie |
| `/app`, `/app/*` | The dashboard shell (a single-page app; routing past that point is client-side) | session cookie, checked client-side |
| `/privacy`, `/robots.txt`, `/.well-known/security.txt`, `/_health` | Public | none |

**The redirect answers before the database is touched.** It resolves the slug,
checks the link is live, and returns a `302`. The click is recorded inside
`ctx.waitUntil()` — after the response is already on the wire — so D1 latency
can never reach a visitor. `recordClick()` is the single ingestion boundary and
never throws: a failing analytics write cannot harm a redirect.

**Authorization is structural.** Public and authenticated routes live on
separate routers, and a test walks the framework's own route table and requires
`401` from every non-allowlisted route. Mounting a new endpoint on the wrong
router fails the build rather than shipping an open endpoint.

**Analytics are computed twice and reconciled.** Live queries read raw clicks;
the hourly rollup pre-aggregates the same data into daily tables. A test runs
both paths over identical data and compares the results, so the two cannot
drift into showing different numbers for the same day.

```
src/
├── index.ts              Worker entry: fetch + scheduled
├── types.ts              Env bindings
├── lib/                  Pure logic — no database, no bindings
│   ├── slug.ts           generation, shape, reserved names
│   ├── url.ts            destination validation
│   ├── crypto.ts         daily-rotating HMAC, PBKDF2, constant-time compare
│   ├── ua.ts             client hints first, user-agent fallback
│   ├── referrer.ts       host extraction and channel classification
│   └── request-context.ts geography, UTM, QR marker
├── db/                   every SQL statement in the project
│   ├── links.ts  clicks.ts  tags.ts  sessions.ts  stats.ts
├── ingest/record-click.ts  the single ingestion boundary
├── auth/                 sessions, throttle, middleware, link tokens
├── routes/
│   ├── redirect.ts       GET/POST /:slug
│   ├── public.ts         privacy, robots, security.txt
│   └── api/              auth, links, tags, stats
└── cron/                 rollup.ts, retention.ts
```

## The dashboard

A responsive React single-page app, served by the same Worker at `/app` — no
separate host, no separate deploy, and no third-party request: type,
self-hosted fonts and the map's own topology data all ship in the build. It is
built by `npm run build:web` (Vite) into `web/dist`, which the Worker serves
through its `ASSETS` binding; `/app` and `/app/*` both resolve to the app
shell, and the SPA's own router takes it from there.

- **Overview** — the KPI row (clicks, unique visitors, countries reached, bot
  share), each with a sparkline and a delta against the preceding period; the
  time-series chart with adaptive granularity; top links; a world map; device
  breakdown.
- **Links** — the working list, with instant search, status and tag filters, a
  7-day sparkline per row, and one-tap copy. `⌘K` opens a command palette to
  create a link from anywhere in the app.
- **Link detail** — every collected dimension as a ranked, proportional-bar
  list (countries with flags, cities, browsers, operating systems, referrers,
  UTM campaigns, and more), an hour-by-weekday heatmap, a live click feed, the
  QR code (downloadable as SVG or PNG, with scans counted separately from
  clicks), and the outcome breakdown.
- **Tags** and **Settings** — tag management; active sessions with
  revocation; the retention window shown read-only, straight from
  `RAW_RETENTION_DAYS`; and a CSV export that streams straight to the browser.

Built to WCAG 2.2 AA: keyboard-operable throughout, focus always visible, no
chart conveys information by colour alone, and every chart ships a table view
as well as a plot.

## Running it locally

**Requirements:** Node 24 (see `.nvmrc`) and npm. No Cloudflare account needed
to run or test — D1 runs locally under `workerd`.

```bash
git clone https://github.com/amargiovanni/margiolink.git
cd margiolink
npm ci

cp .dev.vars.example .dev.vars
# Edit .dev.vars: pick an ADMIN_USER and ADMIN_PASSWORD, then generate a secret
openssl rand -hex 32   # paste as HASH_SECRET

npm run db:migrate:local
npm run dev
```

The Worker comes up on `http://localhost:8787`, serving the API and whatever
`web/dist` currently holds — run `npm run build:web` once beforehand, or the
dashboard shell has nothing to serve. Open `http://localhost:8787/app` and
sign in with the `ADMIN_USER`/`ADMIN_PASSWORD` from `.dev.vars`; rebuild with
`npm run build:web` after a dashboard change and reload.

`npm run dev:web` runs Vite's own dev server for fast markup/style iteration
with hot reload, on its own port — the API client fetches same-origin
(`credentials: "same-origin"` in `web/src/lib/api.ts`), and nothing proxies
`/api/*` from that port to the Worker, so it is for layout and component work
against stubbed data, not for exercising the real API end to end. `npm run
deploy` runs `build:web` automatically before deploying.

Or drive the API directly:

```bash
# Log in and keep the session cookie
curl -s -X POST localhost:8787/api/auth/login \
  -H 'content-type: application/json' \
  -d '{"username":"YOUR_ADMIN_USER","password":"YOUR_ADMIN_PASSWORD"}' \
  -c /tmp/ml.txt -i | head -3

# Create a link
curl -s -X POST localhost:8787/api/links \
  -H 'content-type: application/json' -b /tmp/ml.txt \
  -d '{"targetUrl":"https://example.com","slug":"hello","title":"Hello"}'

# Follow it
curl -s -i localhost:8787/hello | head -3

# See the click
curl -s -b /tmp/ml.txt "localhost:8787/api/stats/live?limit=5"
```

To run the scheduled jobs by hand:

```bash
curl "localhost:8787/cdn-cgi/local/scheduled?cron=0+*+*+*+*"    # hourly rollup
curl "localhost:8787/cdn-cgi/local/scheduled?cron=30+3+*+*+*"   # daily retention
```

## End-to-end tests

`npm test` runs entirely against stubbed data (`jsdom` has no CSS cascade, no
layout, no real focus model, no canvas and no navigation) — it cannot see a
focus ring that never renders, a redirect that loops, a QR PNG that encodes
the wrong URL, or a colour that fails contrast. `e2e/` covers exactly that
gap, in a real Chromium, against the real Worker and a real (throwaway) D1.
It is not a second pass over what `npm test` already checks.

```bash
npx playwright install chromium   # once
npm run e2e                       # headless
npm run e2e:ui                    # Playwright's UI mode, for writing/debugging
```

`npm run e2e` builds the dashboard and starts `wrangler dev` itself
(`e2e/playwright.config.ts`'s `webServer`), then seeds two links, a tag and
~50 real clicks through the actual API (`e2e/seed.ts`) before any test runs.
It needs the same `npm run db:migrate:local` this section's "Running it
locally" step above already asked for — a fresh clone's local D1 has no
schema yet, and the suite has nothing to log into or click through without
one. It does **not** need or read your `.dev.vars`: it writes its own fixed,
fake `ADMIN_USER`/`ADMIN_PASSWORD`/`HASH_SECRET` via `e2e/fixtures.ts`
(overridable with `E2E_ADMIN_USER`/`E2E_ADMIN_PASSWORD` if your local
`.dev.vars` already uses different values) — the same values CI writes into
its own `.dev.vars`, which does not exist there otherwise.

## Deploying your own

MargioLink is meant to be self-hosted. Everything below happens in your own
Cloudflare account, and the free plan is enough for personal use.

**1. Fork and clone**, then `npm ci`.

**2. Create the database.**

```bash
npx wrangler login
npx wrangler d1 create margiolink
```

Copy the `database_id` it prints into `wrangler.jsonc`.

**3. Point it at your domain.** In `wrangler.jsonc`, replace `link.margio.uk`
in both `vars.SHORT_DOMAIN` and `routes[0]` with your own, and set `zone_name`
to the Cloudflare zone that owns it. The domain must already be on Cloudflare.

If you have no domain yet, delete the `routes` block entirely and deploy to
`<name>.workers.dev`; set `SHORT_DOMAIN` to that hostname. Everything works,
the links are just longer.

**4. Set the secrets.** These are not in `wrangler.jsonc` and must never be
committed:

```bash
npx wrangler secret put ADMIN_USER
npx wrangler secret put ADMIN_PASSWORD
npx wrangler secret put HASH_SECRET     # openssl rand -hex 32
```

`HASH_SECRET` must be at least 32 characters. **The Worker refuses to serve
without it** rather than falling back to a default — a missing secret would
otherwise produce forgeable link tokens and reproducible visitor hashes while
looking completely normal from outside.

**5. Migrate and deploy.**

```bash
npm run db:migrate     # applies migrations to the remote database
npm run deploy
```

**6. Check it.**

```bash
curl -s https://your-domain/_health          # {"ok":true}
curl -s https://your-domain/privacy | head   # your privacy notice
```

**7. Adjust the privacy notice.** `src/routes/public.ts` contains the text
served at `/privacy`. It is accurate for the software as written, but it says
"the operator of this deployment" where a real notice needs your identity and a
contact route. That is your obligation as the data controller, not something a
fork can fill in for you.

### Keeping a fork current

The two cron triggers are declared in `wrangler.jsonc` and start automatically
on deploy. Nothing else runs on a schedule, and there is no telemetry — this
software never contacts anything except the browser in front of it.

## Configuration

**Plain variables** (`wrangler.jsonc` → `vars`, safe to commit):

| Name | Default | What it does |
| --- | --- | --- |
| `SHORT_DOMAIN` | `link.margio.uk` | Used to build short URLs and to reject a destination that points back at the shortener |
| `RAW_RETENTION_DAYS` | `180` | How long individual click rows live. Also interpolated into the published privacy notice, so the page cannot drift from the job |

**Secrets** (`wrangler secret put`, never committed):

| Name | Notes |
| --- | --- |
| `ADMIN_USER` | The single admin username |
| `ADMIN_PASSWORD` | Compared in constant time; use something long |
| `HASH_SECRET` | ≥32 characters of real entropy. See the warning above about rotation |

**`compatibility_date`** is pinned to `2026-08-22`. That is not arbitrary: the
`workerd` build inside the test runner refuses newer dates, and production and
tests deliberately share one config so the suite exercises the same
compatibility surface as the deploy. Raise it once the test runner ships a
newer pinned runtime; the reasoning is repeated in `wrangler.jsonc`.

## API reference

Everything under `/api` requires the session cookie except the login route.
All bodies and responses are JSON.

### Auth

| Method | Path | Notes |
| --- | --- | --- |
| `POST` | `/api/auth/login` | `{username, password}`. Sets a `__Host-` session cookie. Throttled per IP hash |
| `POST` | `/api/auth/logout` | Invalidates the current session |
| `GET` | `/api/auth/sessions` | Active sessions, with a coarse device label |
| `DELETE` | `/api/auth/sessions` | Revoke every session |
| `DELETE` | `/api/auth/sessions/:id` | Revoke one |

### Links

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/api/links` | `?search=&status=&tagId=&limit=&offset=`. Status is `all\|active\|inactive\|expired\|deleted` |
| `POST` | `/api/links` | `{targetUrl, slug?, title?, description?, password?, expiresAt?, expiredUrl?}` |
| `GET` | `/api/links/:id` | One link with its tags |
| `PATCH` | `/api/links/:id` | Same fields, plus `isActive`. `password: null` clears it |
| `DELETE` | `/api/links/:id` | Soft delete |
| `POST` | `/api/links/:id/restore` | Undo a soft delete |
| `PUT` | `/api/links/:id/tags` | `{tagIds: [...]}` — replaces the whole set |
| `GET` | `/api/links/:id/qr.svg` | QR code encoding the link with a scan marker |

A link never returns its password. `hasPassword` is a boolean.

Status codes worth knowing: `409` for a slug already taken, `422` for a slug
that is malformed or reserved and for a rejected destination, `429` when the
creation limit is hit.

### Tags

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/api/tags` | |
| `POST` | `/api/tags` | `{name, color}` — colour must be `#rrggbb` |
| `DELETE` | `/api/tags/:id` | Detaches from links; does not delete them |

### Deployment facts

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/api/meta` | `{retentionDays, shortDomain}` — the Worker's own `RAW_RETENTION_DAYS` and `SHORT_DOMAIN` |

`retentionDays` is a number, not the environment's string. The dashboard's
Settings page states the retention window as a read-only fact and names this as
its source: a figure the client invented would drift silently from the one the
deletion job actually enforces, which for a privacy claim is worse than showing
nothing.

### Statistics

The first four take `from` and `to` as unix seconds, plus an optional `linkId`
that scopes every figure to one link. `top-links` takes the range but no
`linkId` — it ranks *across* links, so scoping it to one would be meaningless,
and the parameter is deliberately absent from its schema rather than accepted
and ignored. `sparklines` takes neither: it is a fixed trailing window.

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/api/stats/summary` | Returns `current` and `previous` — the preceding window of equal length |
| `GET` | `/api/stats/timeseries` | `&granularity=hour\|day\|week` |
| `GET` | `/api/stats/dimension` | `&name=<dimension>&limit=` (max 100) |
| `GET` | `/api/stats/live` | `?limit=` (max 200) — recent clicks |
| `GET` | `/api/stats/top-links` | `&limit=` — links ranked by clicks in the window. Excludes soft-deleted links; ties break on slug so the order is stable between refreshes |
| `GET` | `/api/stats/sparklines` | `?days=` (max 90) — per-link daily counts |

Dimensions: `country`, `city`, `device`, `os`, `browser`, `referrer_type`,
`referrer_host`, `utm_source`, `utm_medium`, `utm_campaign`, `language`,
`asn_org`, `source`, `outcome`, and `dow_hour` for the hour-by-weekday matrix.

Bots are excluded from every figure except the `bots` count in `summary`.

**One caveat the API cannot hide:** these endpoints read raw click rows, so a
range extending past `RAW_RETENTION_DAYS` under-reports rather than failing.
Serving older ranges from the aggregate tables is part of the dashboard work.

### Public

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/:slug` | The redirect. `?s=qr` marks a scan |
| `POST` | `/:slug` | Password submission for a protected link |
| `GET` | `/privacy` | The privacy notice |
| `GET` | `/robots.txt` | Disallows everything |
| `GET` | `/.well-known/security.txt` | RFC 9116 |
| `GET` | `/_health` | `{"ok":true}` |

Reserved slugs, rejected at creation: `app`, `api`, `privacy`, `assets`,
`robots.txt`, `favicon.ico`, `_health`.

## Data model

Eight tables, created by one migration and reversed by one rollback file.

| Table | Holds |
| --- | --- |
| `links` | Slug, destination, title, password hash and salt, expiry, active flag, soft-delete timestamp |
| `tags`, `link_tags` | Tags and their assignment |
| `clicks` | One row per click. Geography, device, referrer, UTM, outcome, and `visitor_hash` — no IP, no raw user-agent |
| `click_daily` | Per-day, per-link totals: clicks, uniques, bots |
| `click_daily_dim` | Per-day, per-link, per-dimension counts. Retains the dimension's value alongside the count |
| `admin_sessions` | SHA-256 of the session token — never the token |
| `login_attempts` | Daily-rotating IP hash, attempt count, lockout |

Aggregate tables are kept indefinitely and raw clicks are not; that asymmetry
is the entire reason the rollup exists.

## Scheduled jobs

**Hourly rollup** (`0 * * * *`) aggregates today and yesterday into the daily
tables. It is idempotent — it deletes a day before reinserting it — so running
it repeatedly converges rather than accumulating, and re-rolling yesterday
catches clicks that arrived just before midnight.

**Daily retention** (`30 3 * * *`) deletes raw click rows past
`RAW_RETENTION_DAYS`, expired sessions, and stale login-attempt rows. It works
in bounded batches so a backlog cannot exceed a statement limit and fail
forever, and **it refuses to delete raw rows for any day that was never rolled
up** — if the rollup has been failing, retention declines and says so rather
than silently eating history.

## Development

```bash
npm test                    # 640 tests: 350 inside workerd against real D1, 290 in jsdom
npm run test:watch
npm run e2e                 # 22 tests in a real Chromium — see "End-to-end tests" above
npm run check               # Biome: lint and format
npm run check:fix
npm run typecheck           # tsc --noEmit (backend, dashboard and e2e/, each their own project)
npm run build:web           # builds the dashboard into web/dist
npm run dev:web             # Vite dev server for the dashboard — see "The dashboard" above
npm run db:verify-rollback  # proves the newest migration is reversible
```

Backend tests never mock the database. They run inside `workerd` with a real
local D1, so every SQL statement is executed by SQLite — a query that would
fail in production fails here. Dashboard tests render each page against a
stubbed API and include a cross-cutting accessibility sweep
(`web/src/a11y.test.tsx`) over every page: one `<h1>`, no skipped heading
level, every image, form control and button named, no positive `tabIndex`,
and every chart inside a named region.

CI runs lint, types and the full suite on every pull request, a separate job
that applies the migrations, rolls the newest one back, and checks the schema
both changed and came back identical (a migration added without a working
down file fails there), and a third that runs the end-to-end suite in a real
Chromium and uploads the HTML report if it fails.

See [CONTRIBUTING.md](CONTRIBUTING.md) for conventions and the review bar.

## Compliance

MargioLink is built in a context where the EU's GDPR and Cyber Resilience Act
apply, and the evidence lives in the repository rather than in a drawer:

- [`compliance/legitimate-interest-assessment.md`](compliance/legitimate-interest-assessment.md)
  — the Article 6(1)(f) balancing test, including a DPIA screening
- [`compliance/data-map.md`](compliance/data-map.md) — every `clicks` column
  classified, what is deliberately not collected, and why
- [`SECURITY.md`](SECURITY.md) — also the coordinated vulnerability disclosure
  policy the CRA's Annex I requires

A test compares the documented column set against the live schema in both
directions, so a column added without documentation fails the build and so does
a documented column that no longer exists. The privacy notice's retention figure
is interpolated from the same variable the cron job reads.

**If you deploy this, you are the data controller.** The documents above
describe the software; they are a starting point for your own record, not a
substitute for it.

## Roadmap

The backend and the dashboard are both done. Two known pieces of work remain,
both already documented where a consumer of the affected figure will see them
rather than only here:

- **Ranges older than `RAW_RETENTION_DAYS` under-report.** The statistics
  endpoints read raw click rows; serving older ranges from the aggregate
  tables (`click_daily`, `click_daily_dim`) instead is not yet built.
- **Summed unique counts across days are deliberately imprecise**, for the
  reason in [How the privacy design works](#how-the-privacy-design-works) — a
  returning visitor is counted once per day, by design, not by omission.

## Contributing, security, licence

- [CONTRIBUTING.md](CONTRIBUTING.md) — how to propose a change
- [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)
- [SECURITY.md](SECURITY.md) — report a vulnerability privately, please
- [MIT](LICENSE)
