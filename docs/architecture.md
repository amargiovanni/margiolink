# Architecture

[Back to README](../README.md) · [API reference](api.md) · [Operations](operations.md)

MargioLink is a TypeScript application deployed as a Cloudflare Worker, with
D1 for persistent storage and a static-assets binding for the frontend. Hono
routes the backend; React and Vite build the dashboard. No separate application
server, queue or external analytics service is required.

## Routing and page delivery

| Surface | Implementation | Access |
| --- | --- | --- |
| `/` | `web/index.html` → `web/dist/index.html` | Public static landing. |
| `/app`, `/app/*` | `web/app.html` → `web/dist/app.html` | Public shell; the client redirects signed-out users to login. API data is protected server-side. |
| `/:slug` | Worker redirect and password handlers | Public, subject to each link's lifecycle and optional password. |
| `/api/*` | Hono API router | Session required except login. |
| `/privacy`, `/robots.txt`, `/.well-known/security.txt` | Worker-rendered public routes | Public. |
| `/_health`, `/_ready` | Worker health checks | Public. |

Vite emits two HTML documents. Matching static files can be served by
Cloudflare's asset router before the Worker runs. The Worker also serves
`app.html` through `ASSETS.fetch()` for nested dashboard routes. Asset URLs
are rooted at `/assets/`, not `/app/assets/`.

Security headers are defined for both delivery paths:
[src/lib/security-headers.ts](../src/lib/security-headers.ts) covers Worker
responses, and [web/public/_headers](../web/public/_headers) covers static
assets. Keep both consistent. The landing's inline theme bootstrap is allowed
by an exact CSP hash; changing that script requires updating and verifying the
policy as well.

## Redirect path

1. Validate `HASH_SECRET`, normalise the slug and read the link from D1.
2. Reject missing/deleted links and apply inactive/expiry behaviour.
3. Check the protected-link grant when a password is set.
4. Schedule analytics through `ctx.waitUntil(recordClick(...))` and return the
   redirect or corresponding lifecycle response.

**The link lookup is on the response path; the analytics write is not.** D1
read latency therefore affects redirects. Analytics failures are contained by
[recordClick](../src/ingest/record-click.ts), so a failed write does not turn a
valid redirect into an error. This also means analytics are best-effort: an
unavailable database or failed background task can leave a click unrecorded.

Password submissions recheck lifecycle before issuing a grant. Successful
submissions return a same-origin HTML handoff, which starts a fresh navigation
to respect the site's `form-action 'self'` CSP. Grants are bound to the immutable
link ID, current slug and current password credentials, and expire after ten
minutes. Link passwords use salted PBKDF2-SHA256; current hashes use 600,000
iterations, while verification also accepts the supported legacy format.

## Authentication boundary

[The API router](../src/routes/api/index.ts) mounts the login handler before a
shared session guard. All other API routes pass that guard once per request.
Tests enumerate the route table to detect an accidentally public endpoint.
The dashboard shell is not itself a source of private data.

Admin credentials come from Worker secrets. Session cookies contain random
tokens; D1 stores only their SHA-256 digests. Login and protected-link checks
use an atomic attempt reservation with a daily IP-derived key and progressive
lockout. The date boundary also bounds the throttle: a new UTC day produces a
new key.

## Visitor codes

[src/lib/crypto.ts](../src/lib/crypto.ts) implements this construction:

```text
key     = UTF8(HASH_SECRET + ":" + UTC_DATE)
message = UTF8(ip + " " + userAgent + " " + slug)
code    = first 32 hex characters of HMAC-SHA256(key, message)
```

The stored result is a 128-bit pseudonymous code. It changes with the date or
slug, and raw IP/user-agent values are not inserted into the click table.
The base secret is retained, so previous date keys can be re-derived. This
construction does not provide forward secrecy or prove that re-identification
is impossible for someone with the secret and candidate request inputs.

The operational benefit is bounded correlation in normal analytics: there is
no stable code joining the same visitor across links and dates. Counts also
inherit that boundary; see [measurement semantics](api.md#retention-and-unique-counts).

## Data model

Application tables are created by [migrations/](../migrations/), with matching
schema rollback files in [rollback/](../rollback/). D1 maintains additional
internal and migration-tracking tables.

| Table | Contents |
| --- | --- |
| `links` | Slug, destination, metadata, password hash/salt, lifecycle flags and timestamps. |
| `tags`, `link_tags` | Tags and their link assignments. |
| `clicks` | Timestamp, visitor code, request context, bot flag, source and outcome. |
| `click_daily` | Daily per-link click, unique and bot totals. |
| `click_daily_dim` | Daily per-link dimension aggregates. |
| `admin_sessions` | Token digest, expiry, activity timestamps and coarse device label. |
| `login_attempts` | Daily throttle key, attempts, lockout and reservation ID. |

Sensitive aggregate dimensions are `city`, `asn_org`, `referrer_host`,
`utm_source`, `utm_medium` and `utm_campaign`. Their rollup values require at
least three human clicks per link/day and expire with raw-data retention.
That suppression applies to stored rollups, not the authenticated raw-data
queries. Daily totals and other dimensions have no automatic expiry.

The [data map](../compliance/data-map.md) documents the click fields and is
checked against the database schema by tests. [Operations](operations.md#scheduled-jobs)
describes rollup catch-up and retention behaviour.

## Frontend and query cost

The landing has its own static markup and stylesheet, with self-hosted fonts
and WebP assets. Its content and navigation work without JavaScript; the small
enhancement module handles theme interaction and motion. It shares the theme
preference with the dashboard, but has a separate visual design.

The dashboard loads routes separately and defers detailed analytics panels
until they enter view or the user requests them. Lists use 20-row pages; the
backend batches tag hydration within D1 bind limits. Non-live statistics are
fresh for 60 seconds in the client; the mounted live feed polls every ten
seconds. The server's more selective [statistics cache](api.md#retention-and-unique-counts)
is consulted only after authentication.

All statistics queries currently read raw clicks. Rollups preserve aggregates
for future historical access; their existence does not make old ranges
available through the current API.

## Source map

| Directory / file | Responsibility |
| --- | --- |
| `src/index.ts` | Fetch routing and scheduled-job dispatch. |
| `src/routes/` | Redirects, public pages and API handlers. |
| `src/auth/` | Sessions, throttle and protected-link grants. |
| `src/lib/` | Validation, cryptography, request classification, headers and cache policy. |
| `src/db/` | Database access and statistics queries. |
| `src/ingest/` | Click-recording boundary. |
| `src/cron/` | Rollup and retention jobs. |
| `web/index.html`, `web/src/landing.ts`, `web/src/styles/landing.css` | Public landing. |
| `web/src/pages/`, `web/src/components/` | React dashboard. |
| `test/`, `web/src/**/*.test.*`, `e2e/` | Worker/D1, component and real-browser verification. |
| `scripts/` | Local demo data, build budgets, visual capture and migration tooling. |
