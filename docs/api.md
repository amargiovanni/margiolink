# API reference

[Back to README](../README.md) · [Architecture](architecture.md) · [Operations](operations.md)

The API lives under `/api` on the same origin as the dashboard. Every API
route except `POST /api/auth/login` requires the admin session cookie.
There are no API keys or bearer tokens. Request bodies and responses are JSON,
except the QR endpoint, which returns SVG. Timestamps are Unix **seconds**.

## First request

With the local Worker running, use the username and password you configured
in `.dev.vars`. Store this temporary JSON outside the repository and remove
it after login:

```bash
umask 077
ML_TMP=$(mktemp -d)
cat > "$ML_TMP/login.json" <<'JSON'
{"username":"YOUR_ADMIN_USER","password":"YOUR_ADMIN_PASSWORD"}
JSON

curl --fail-with-body http://localhost:8787/api/auth/login \
  -H 'Content-Type: application/json' \
  --data-binary @"$ML_TMP/login.json" \
  -c "$ML_TMP/cookies.txt"
rm "$ML_TMP/login.json"

curl --fail-with-body http://localhost:8787/api/links \
  -H 'Content-Type: application/json' \
  -b "$ML_TMP/cookies.txt" \
  --data '{"targetUrl":"https://example.com","slug":"hello","title":"Hello"}'
```

Login returns `{"ok":true}` and a cookie. Creating a link returns HTTP 201
with a `link` object containing `id`, `slug`, `shortUrl`, `targetUrl`,
`hasPassword`, lifecycle fields and timestamps. On an existing database,
choose an unused slug or omit it to generate one.

Visit `http://localhost:8787/hello`, then retrieve recent events:

```bash
curl --fail-with-body -b "$ML_TMP/cookies.txt" \
  'http://localhost:8787/api/stats/live?limit=5'

curl --fail-with-body -X POST -b "$ML_TMP/cookies.txt" \
  http://localhost:8787/api/auth/logout
rm "$ML_TMP/cookies.txt"
rmdir "$ML_TMP"
```

Analytics recording is asynchronous, so a new event may not appear immediately.
Use HTTPS and your own hostname in production. The session cookie is `Secure`;
for local HTTP use `localhost`, which supports this development workflow.

## Authentication and sessions

| Method | Path | Request / response |
| --- | --- | --- |
| `POST` | `/api/auth/login` | `{username, password}` → `{ok: true}` and session cookie. Each field is 1–200 characters. |
| `POST` | `/api/auth/logout` | Invalidates the current session and clears its cookie. |
| `GET` | `/api/auth/sessions` | `{sessions: [...]}` with IDs, timestamps, coarse device labels and `current`. |
| `DELETE` | `/api/auth/sessions` | Revokes every session, including the current one. |
| `DELETE` | `/api/auth/sessions/:id` | Revokes one session. |

The cookie is `__Host-ml_session`, `HttpOnly`, `Secure`, `SameSite=Lax`, with
path `/` and a 30-day lifetime. D1 stores a SHA-256 digest of the token.
Login throttling returns `429` with `Retry-After`. Login bodies exceeding
16 KiB of actual streamed bytes return `413`, including when `Content-Length`
is absent or inaccurate. This cap is not a general limit on every private API body.

## Links

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/api/links` | `{links, total}`; supports the filters and pagination below. |
| `POST` | `/api/links` | Create a link; returns `{link}` with HTTP 201. |
| `GET` | `/api/links/:id` | `{link}`, including its `tags`. |
| `PATCH` | `/api/links/:id` | Update selected fields; returns `{link}`. |
| `DELETE` | `/api/links/:id` | Soft delete; returns `{ok: true}`. |
| `POST` | `/api/links/:id/restore` | Restore a soft-deleted link. |
| `PUT` | `/api/links/:id/tags` | `{tagIds: [...]}` replaces all assignments; at most 20 IDs. |
| `GET` | `/api/links/:id/qr.svg` | SVG encoding `https://SHORT_DOMAIN/slug?s=qr`. |

Create fields:

| Field | Contract |
| --- | --- |
| `targetUrl` | Required HTTP(S) URL; at most 2,048 characters after trimming; cannot point directly at `SHORT_DOMAIN`. |
| `slug` | Optional; trimmed and lowercased. 1–64 characters matching `[a-z0-9][a-z0-9_-]*`, excluding reserved names. Generated when omitted. |
| `title` | Optional or null, up to 200 characters. |
| `description` | Optional or null, up to 1,000 characters. |
| `password` | Optional or null, 1–200 characters when set. Never returned by the API. |
| `expiresAt` | Optional or null, positive integer Unix seconds. |
| `expiredUrl` | Optional or null, fallback destination validated as an HTTP(S) URL. |

PATCH accepts these fields optionally, plus `isActive` (boolean). Set
`password`, `expiresAt` or `expiredUrl` to `null` to remove the corresponding
setting. Password metadata is exposed only as `hasPassword`.

List query parameters:

| Parameter | Accepted values |
| --- | --- |
| `search` | At most 48 UTF-8 **bytes**, not characters. |
| `status` | `all`, `active`, `inactive`, `expired`, `deleted`. `all` excludes soft-deleted rows. |
| `tagId` | Positive integer. |
| `limit` | 1–200; default 50. The dashboard requests 20-row pages. |
| `offset` | Non-negative integer; default 0. |

Creating links checks a deployment-wide limit of 120 creations in the preceding
hour. A rejected request returns `429` and `Retry-After`. Tag assignment is a
separate request from link creation.

## Tags and deployment metadata

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/api/tags` | `{tags: [...]}`. |
| `POST` | `/api/tags` | `{name, color}` → `{tag}` with HTTP 201. Name: 1–40 characters; colour: `#rrggbb`. |
| `DELETE` | `/api/tags/:id` | Deletes the tag and detaches it from links, preserving the links. |
| `GET` | `/api/meta` | `{retentionDays, shortDomain}` from the running deployment; `retentionDays` is numeric. |

There is no tag-update endpoint. CSV export and PNG QR conversion are dashboard
features; the API exposes paginated link records and SVG QR codes.

## Statistics

All range endpoints use `from` (inclusive) and `to` (exclusive), with
`0 <= from < to`. Summary, time series and dimension accept an optional positive
`linkId`. Top links ranks across links and does not support `linkId`.

| Method | Path | Parameters and result |
| --- | --- | --- |
| `GET` | `/api/stats/summary` | Range → `{current, previous, range, meta}`. Previous is the immediately preceding interval of equal length, clamped to retained history. |
| `GET` | `/api/stats/timeseries` | Range; `granularity=hour\|day\|week` (default `day`) → `{buckets, granularity, meta}`. Weeks start Monday. |
| `GET` | `/api/stats/dimension` | Range; required `name`; `limit=1…168` (default 20) → `{slices, dimension, meta}`. |
| `GET` | `/api/stats/top-links` | Range; `limit=1…100` (default 5) → `{links, meta}`. Soft-deleted links are excluded. |
| `GET` | `/api/stats/live` | Optional `linkId`; `limit=1…200` (default 50) → `{clicks}`. No range parameters. Includes an `isBot` flag. |
| `GET` | `/api/stats/sparklines` | `days=1…90` (default 7) → `{days, series}`, keyed by link ID. No `from`, `to` or `linkId` filter. |

Available dimensions:

```text
country, city, device, os, browser, referrer_type, referrer_host,
utm_source, utm_medium, utm_campaign, language, asn_org, source,
outcome, dow_hour
```

`dow_hour` uses `weekday-hour`, with Sunday `0` and hours `00`–`23` in UTC.
Human statistics exclude detected bots; summary also exposes a separate bot
count. The live feed can include bot events.

### Retention and unique counts

Range responses include `meta.requestedFrom`, `effectiveFrom`,
`retentionCutoff`, `truncated` and
`uniquesDefinition: "daily-rotating-visitor-hash"`. Their queries read raw
`clicks`; older aggregates are not used as a fallback. `truncated` describes
the requested primary range, not a separate completeness flag for the summary's
comparison period. Check whether `from - (to - from)` precedes `retentionCutoff`
when interpreting `previous`.

A visitor code changes each UTC day and for each link. Multi-day or multi-link
unique counts can therefore count a returning person several times. They
should not be labelled as distinct people across the whole period.

Successful summary, time-series, dimension and top-links results for closed,
fully retained ranges can be reused in the Worker cache for up to 60 seconds,
**after session validation**. Summary also requires a fully retained comparison
period. Open, future or truncated ranges, errors, live events and sparklines
bypass that cache. Statistics responses to the browser use
`Cache-Control: private, no-store`.

## Errors

Errors normally use `{"error":"machine_readable_code"}`. Clients should handle
HTTP status as well as the code; do not assume an infrastructure failure is JSON.

| Status | Common causes |
| --- | --- |
| `400` | Invalid JSON body, query, range, dimension, limit or UTF-8 search length. |
| `401` | Missing/expired session, or invalid login credentials. |
| `404` | Missing resource. |
| `409` | Slug or tag name already exists. |
| `413` | Oversized login or public password-submission body. |
| `422` | Rejected destination, fallback URL, malformed or reserved slug. |
| `429` | Login/password throttling or link-creation limit; inspect `Retry-After`. |

## Public routes

| Method | Path | Behaviour |
| --- | --- | --- |
| `GET` | `/` | Static landing page. |
| `GET` | `/app`, `/app/*` | Dashboard shell; private data still requires API authentication. |
| `GET` | `/:slug` | Redirect or lifecycle/password page. `?s=qr` marks QR traffic. |
| `POST` | `/:slug` | Protected-link password submission, capped at 16 KiB. Success returns an HTTP 200 same-origin HTML handoff before a fresh navigation. |
| `GET` | `/privacy` | Privacy notice using the configured retention window. |
| `GET` | `/robots.txt` | Allows the root landing page and disallows short-link crawling. |
| `GET` | `/.well-known/security.txt` | Security contact and disclosure-policy metadata. |
| `GET` | `/_health` | Liveness: `{"ok":true}`. |
| `GET` | `/_ready` | Readiness: `{"ok":true}` or HTTP 503 with `{"ok":false}`. |

Reserved slugs: `app`, `index`, `api`, `privacy`, `assets`, `robots.txt`,
`favicon.ico`, `_health`, `_ready`. Other values must also pass slug-shape
validation.
