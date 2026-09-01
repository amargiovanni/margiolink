# Legitimate Interest Assessment — click analytics

**Controller:** the operator of link.margio.uk
**Processing:** recording and aggregating clicks on short links
**Legal basis claimed:** Article 6(1)(f) GDPR
**Assessed:** 2026-09-01
**Status:** drafted by Claude against the code as built; pending human
sign-off. Per the `gdpr-evidence` skill's contract, Claude drafts a legal-basis
assessment but never marks a processing activity lawful — a named human
confirms this document before it is relied on.
**Confirmed by:** _pending_

## 1. Purpose test

The interest is measuring how the controller's own short links perform: how
many people follow them, from which countries and devices, and from which
referring sites. The interest is the controller's own and is commercial and
operational, not speculative.

## 2. Necessity test

The purpose cannot be met without recording something about each click. The
processing is limited to what measurement requires:

- No IP address is stored in any form, and no raw user-agent string.
  `src/lib/request-context.ts` reads `CF-Connecting-IP` and `User-Agent` only
  into an in-memory `RequestContext`; `src/ingest/record-click.ts` uses that
  context to derive `visitor_hash` and never writes the IP or the raw
  user-agent string to storage or to logs (its `catch` block is explicit that
  only the error, never `params`, may reach console output, because `params`
  carries both).
- Visitor de-duplication uses an HMAC keyed on a secret plus the current UTC
  date (`src/lib/crypto.ts`, `dailyKey`/`visitorHash`: the key material is
  `` `${secret}:${utcDay(ts)}` ``, and `utcDay` takes the UTC calendar date of
  the click), so the same visitor is uncorrelatable with themselves once the
  UTC date rolls over. In the worst case — a visit just after midnight UTC —
  that is within 24 hours, matching what `/privacy` tells visitors.
- Geography stops at city level; latitude and longitude, available from the
  platform (`request.cf`) at no cost, are deliberately discarded —
  `src/lib/request-context.ts`'s `GeoInfo` only reads `continent`, `country`,
  `region`, `city`, `timezone`, `asOrganization` and `colo` off `request.cf`.
- The referring page is reduced to its host and a channel classification
  (`src/lib/referrer.ts`'s `parseReferrer` returns `host` and `type` only). The
  full `Referer` URL is not stored: an earlier build kept it in a
  `clicks.referrer_url` column, no query ever read it, and its path and query
  string carry unbounded free text from a third-party page — which also fails
  the necessity test on this section's own terms. `migrations/0002_drop_referrer_url.sql`
  dropped the column; the reversal script restores the column but deliberately
  not the data.
- Individual records are deleted after `RAW_RETENTION_DAYS` days (180 in the
  current configuration — `wrangler.jsonc`), enforced by
  `src/cron/retention.ts`'s `runRetention`, which runs daily at 03:30 UTC
  (`triggers.crons` in `wrangler.jsonc`). Only aggregate counts in
  `click_daily` and `click_daily_dim` survive past that point.

No less intrusive alternative meets the purpose: a purely aggregate counter
cannot distinguish a returning visitor from a new one, which is the
measurement.

## 3. Balancing test

Against the controller's interest stands the data subject's interest in not
being tracked. The processing:

- **sets no cookie of its own.** Click recording (`recordClick`) never calls
  `setCookie`; there is nothing in the codebase that sets a cookie for the
  purpose of click measurement or visitor recognition across requests.
  The service does set one cookie elsewhere, for a different purpose:
  `src/routes/redirect.ts` issues `ml_pw_<slug>` after a correct password
  submission on a password-protected link, so the visitor is not asked again
  for ten minutes (`maxAge: 600`, `httpOnly`, `secure`, `sameSite: "Lax"`,
  scoped to that one link's path). That cookie is strictly necessary to
  deliver the password gate the link owner configured — it carries no
  visitor identity, is not read by the analytics pipeline, and is exempt from
  ePrivacy consent under Article 5(3)'s "strictly necessary" carve-out rather
  than because no cookie exists. The public notice at `/privacy` discloses it
  by name;
- produces no profile, since no identifier survives past the current UTC day;
- supports no decision about any individual — `outcome`, `is_bot` and the
  parsed device/geo fields drive aggregate counters only, never a per-person
  branch of logic;
- is disclosed in a public notice at `/privacy`
  (`src/routes/public.ts`), reachable without authentication.

The daily rotation cuts both ways, and the trade is deliberate. The
brute-force throttle in `src/auth/rate-limit.ts` — which protects the admin
login and the link-password interstitial — keys on `ipHash`, the same
daily-rotating HMAC as `visitor_hash`, so a lockout cannot outlive the UTC day
in which it started: its 1-hour and 24-hour escalation steps are reachable only
within one day, and the effective ceiling on any lockout is the next UTC
midnight. Making the throttle stronger would mean keying it on an identifier
that persists across days, which is precisely the persistent identifier this
assessment relies on not existing. The privacy property and the security
property trade against each other here, and the balance is struck in favour of
the privacy property.

A visitor following a short link would not reasonably object to a count being
kept of that click when nothing about them persists beyond a day. The
residual risk is low and the balance favours the controller.

## 4. Article 11 position

Because no identifier persists beyond the current UTC day, the controller
cannot identify a data subject from the stored records and cannot locate the
records of a specific person on request. Article 11 applies: the controller
is not required to acquire additional information solely to enable
identification. This is stated in the public notice.

## 5. Review

Reassess if any of the following changes: a persistent visitor identifier is
introduced, retention is extended, geography becomes finer than city level,
the daily key rotation is weakened or removed, or the click data is combined
with any other dataset (including the password-gate cookie or an admin
session).

## 6. DPIA screening (Article 35)

This is a screening, not an assessment — it decides whether a full DPIA is
required; it does not substitute for one.

| Article 35(3) trigger | Applies? | Why |
| --- | --- | --- |
| Systematic, extensive automated evaluation/profiling with legal or similarly significant effects | No | No profile is built; no field feeds a decision about any individual |
| Large-scale processing of Article 9 special-category or criminal data | No | No special-category data is processed by this feature |
| Systematic monitoring of a publicly accessible area on a large scale | No | Clicks are recorded only on the controller's own links, pseudonymously, and rotate out of correlatability daily; this is measurement of the controller's own service, not surveillance of a public space |

**Outcome: DPIA NOT REQUIRED.** None of the Article 35(3) triggers apply, and
against the wider nine-criteria checklist this processing meets none of them
(no evaluation/scoring, no automated decisions, no systematic monitoring in
the surveillance sense, no special-category or highly personal data, no
dataset matching, no vulnerable-subject targeting, no innovative/novel
technology, and following a link remains fully available regardless of this
processing). Reassess this screening under the same triggers listed in
Section 5.
