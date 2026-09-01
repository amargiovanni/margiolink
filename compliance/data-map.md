# Data Map — MargioLink

Every column in the `clicks` table, with its classification and basis. The
test in `test/compliance.test.ts` compares the column names in the first cell
of the `clicks` table below against `PRAGMA table_info(clicks)` on the live D1
schema, as an exact set in both directions: a column added to the schema and
not documented here fails, and so does a column left documented here after the
schema drops it. Only the first cell of each row is read, so a name mentioned
in prose elsewhere in this file cannot pass a column off as documented.

**Controller:** the operator of link.margio.uk
**Retention:** 180 days for every row below (`RAW_RETENTION_DAYS` in
`wrangler.jsonc`), then deletion by `runRetention` in `src/cron/retention.ts`,
which the `30 3 * * *` cron trigger runs once daily. `click_daily` holds a
count of clicks/uniques/bots per link per day. `click_daily_dim` holds a count
grouped by one dimension's **value** — a city name, a referrer host, a browser
name, and so on — retained indefinitely alongside that count. Both remain
non-personal not because the value is absent, but because no individual is
identifiable in either table: the rows are grouped counts with no visitor
identifier and no row-per-person structure.
**Legal basis for all of the below:** Article 6(1)(f) — see
`legitimate-interest-assessment.md`.
**Status:** drafted by Claude against the schema and the code that writes to
it (`migrations/0001_init.sql`, `src/db/clicks.ts`, `src/ingest/record-click.ts`);
pending human sign-off.
**Confirmed by:** _pending_

## `clicks`

| Column | Personal data? | Why it is collected |
| --- | --- | --- |
| `id` | No | Row identifier |
| `link_id` | No | Which link was followed |
| `ts` | Yes, in combination | When the click happened; the measurement itself |
| `visitor_hash` | Yes, pseudonymous | Distinguishes visitors within one UTC day; HMAC key rotates at UTC midnight (`src/lib/crypto.ts`) |
| `source` | No | Whether the click came from a QR scan or an ordinary link (`link` / `qr`) |
| `outcome` | No | Whether the redirect succeeded, the link was inactive or expired, or a password gate was shown or failed (`redirect` / `inactive` / `expired` / `password_required` / `password_failed`, `src/db/clicks.ts`) |
| `is_bot` | No | Excludes crawler traffic from human-facing figures (`src/lib/ua.ts`, via `isbot`) |
| `continent`, `country`, `region`, `city` | Yes, in combination | Geographic reach of a link; city is the finest granularity kept |
| `timezone` | Yes, in combination | Local-time analysis of when links are followed |
| `asn_org` | Yes, in combination | Network operator (`request.cf.asOrganization`), to separate mobile from fixed-line traffic |
| `colo` | No | Cloudflare datacenter that served the request; operational. This is the most arguable "No" in this table — `colo` is a geographic signal, but a coarser one than the `city` and `country` already classified as personal data above: dozens of visitors across a wide catchment area share one datacenter, and it identifies Cloudflare's routing, not the visitor's location |
| `device_type`, `os`, `os_version` | Yes, in combination | Which devices the audience uses |
| `browser`, `browser_version` | Yes, in combination | Which browsers the audience uses |
| `language` | Yes, in combination | Audience language (`Accept-Language`, first value), for content decisions |
| `referrer_host`, `referrer_type` | Yes, in combination | Which channel drove the traffic — the referring host and its classification, never the referring URL (`src/lib/referrer.ts`) |
| `utm_source`, `utm_medium`, `utm_campaign`, `utm_term`, `utm_content` | No | Campaign parameters the controller placed in the link, read back from its own query string |

## Deliberately not collected

| Field | Available from | Why not stored |
| --- | --- | --- |
| IP address | `CF-Connecting-IP` | Directly identifying; used in memory only as HMAC input (`src/lib/request-context.ts`, `src/lib/crypto.ts`) and never persisted or logged |
| Raw user-agent | `User-Agent` | High-entropy fingerprint; only the parsed fields (`device_type`, `os`, `os_version`, `browser`, `browser_version`) are kept |
| Latitude / longitude | `request.cf` | Finer than the purpose requires; `GeoInfo` in `src/lib/request-context.ts` does not read these fields |
| Postal code | `request.cf` | Finer than the purpose requires; not read |
| Full referrer URL | `Referer` | Its path and query string carry unbounded free text from a third-party page — search terms, thread titles, session tokens, and by accident the kind of special-category signal §6 of the LIA records as not processed. No query ever read it. `parseReferrer` returns only the host and the channel; `migrations/0002_drop_referrer_url.sql` dropped the `referrer_url` column that used to store it |

## Other personal data in the system

| Table | Column | Notes |
| --- | --- | --- |
| `login_attempts` | `ip_hash` | HMAC with the same daily-rotating key as `visitor_hash` (`src/lib/crypto.ts`'s `ipHash`); exists solely to throttle brute-force login attempts (`src/auth/rate-limit.ts`); rows are purged once the lockout window closes, by the same daily retention cron (`deleteStaleLoginAttempts`) |
| `admin_sessions` | `ua_summary` | Coarse device label ("Chrome on macOS", `src/auth/session.ts`'s `summariseUserAgent`) shown in the sessions list; relates to the site's administrator, not to visitors, and is deleted with the rest of the session row on expiry or logout |

`admin_sessions.id` and `login_attempts.ip_hash` are not listed as separate
personal-data rows beyond the note above: both are one-way hash outputs (a
SHA-256 of a random session token, and the daily-rotating HMAC respectively)
that do not by themselves identify anyone, mirroring the reasoning applied to
`clicks.visitor_hash`.

## Article 30 record summary

This section, together with the header above, is the record required by
Article 30 GDPR for this processing activity — a separate file was judged
unnecessary while the activity is this small; split it out if a second
processing activity needs its own record.

| Field | Value |
| --- | --- |
| Controller | the operator of link.margio.uk |
| Purpose | Click analytics for the controller's own short links (§1 of the LIA) |
| Categories of data subjects | Visitors who follow a short link |
| Categories of data | Pseudonymous visitor identifier, timestamp, coarse geography, device/browser, referrer, campaign parameters — see the `clicks` table above |
| Categories of recipients | None outside the controller. The database (Cloudflare D1) and the compute (Cloudflare Workers) are processed on Cloudflare's infrastructure as a processor; no analytics data is shared with any other third party |
| International transfers | Processed on Cloudflare's infrastructure; the applicable transfer mechanism is governed by the controller's agreement with Cloudflare and is not re-derived here |
| Retention | 180 days raw, indefinite in aggregate — see the header above |
| Security measures | Pseudonymisation via daily-rotating HMAC (`src/lib/crypto.ts`), no raw IP/user-agent persisted, TLS in transit via the Cloudflare edge, admin access gated by session auth (see `docs/superpowers/specs/2026-09-01-margiolink-design.md` §5) |

## Deliberately not collected — cookies

The password-gate cookie `ml_pw_<slug>` (`src/routes/redirect.ts`) and the
admin session cookie `__Host-ml_session` (`src/auth/session.ts`) are unrelated
to this processing activity: neither is read by the click-analytics code
path, and neither carries a visitor identifier. They are covered by the
public notice at `/privacy`, not by this data map.
