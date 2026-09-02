# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Because MargioLink is software other people deploy, entries say what an
operator has to *do*, not only what changed. Anything requiring action on a
running deployment appears under its own heading.

## [Unreleased]

### Added

- **Short links** with generated or custom slugs, expiry dates and an optional
  fallback URL, an active/inactive switch, coloured tags, optional per-link
  passwords behind an interstitial, QR codes as SVG, and soft delete with
  restore.
- **Click analytics** recorded on every redirect: country, region, city, time
  zone, network operator and serving datacenter; device, operating system,
  browser and language; referrer host classified as direct, search, social,
  email or AI; the five UTM parameters; bot detection; and which of five
  outcomes the request produced.
- **Statistics API**: summary with a comparison against the preceding window of
  equal length, time series by hour, day or Monday-start week, breakdowns
  across fifteen dimensions including an hour-by-weekday matrix, a live click
  feed, and zero-filled per-link sparklines.
- **Admin authentication** with a single account from Worker secrets, session
  tokens stored only as their SHA-256, a `__Host-` cookie, and a progressive
  per-IP-hash login throttle.
- **Scheduled jobs**: an hourly idempotent rollup into daily aggregate tables,
  and a daily retention job that deletes raw click rows past their window in
  bounded batches, refusing to delete any day that was never aggregated.
- **Public privacy notice** at `/privacy`, a `robots.txt` that disallows
  everything, and an RFC 9116 `security.txt`.
- **Compliance evidence** in `compliance/`: an Article 6(1)(f) legitimate
  interest assessment with DPIA screening, and a data map classifying every
  `clicks` column, enforced against the live schema by a test.
- **CI** running lint, types and the full suite on every pull request, plus a
  separate job that proves the newest migration is reversible.
- **A dashboard**, served by the same Worker at `/app` — no separate host or
  deploy. An overview with KPI tiles, a time-series chart and a world map;
  the working links list with instant search, filters and a `⌘K` command
  palette to create a link from anywhere; a link detail page ranking every
  collected dimension, an hour-by-weekday heatmap, a live click feed and a
  downloadable QR code; tag management; and a settings page for active
  sessions, session revocation, and a CSV export of every link. Built to WCAG
  2.2 AA — keyboard-operable throughout, no chart conveys information by
  colour alone, and every chart offers a table view alongside its plot. Fonts
  are self-hosted and the map's topology data ships in the build, so opening
  it makes no third-party request either.

### Security

- **No IP address and no raw user-agent is ever stored.** Both are used only as
  input to an HMAC whose key contains the current UTC date, so a visitor's code
  changes at midnight and cannot be linked across days.
- **A missing or weak `HASH_SECRET` fails closed.** The Worker refuses to serve
  rather than falling back to a derivable key, which would have produced
  forgeable link tokens and reproducible visitor hashes while appearing to work
  normally.
- **The link password interstitial is throttled** per IP hash and slug,
  removing both a brute-force oracle and a PBKDF2 CPU amplification vector.
- **Authorization is structural**: public and authenticated routes live on
  separate routers, and a test walks the framework's route table requiring
  `401` from every non-allowlisted route, with the allowlist pinned to its
  exact contents.

### Privacy

- **The full third-party referrer URL is no longer collected.** Earlier
  development stored it — path and query included — for 180 days while no query
  read it. Migration `0002` drops the column. Query strings routinely carry
  search terms and tokens that an operator never intended to collect; the host
  and the traffic channel are retained, which is what the analytics actually
  use.

---

*This project has not had a tagged release yet. The first one will move the
entries above under a version heading.*
