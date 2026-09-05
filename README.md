# MargioLink

**Small links. Bigger picture.**

Shorten links on your own domain and understand how they are used, with a
dashboard that keeps raw IP addresses and raw user-agent strings out of its
database. MargioLink runs in your Cloudflare account as one Worker with one D1
database. The landing page, dashboard, API and redirects ship together.

[Website](https://link.margio.uk) ·
[Releases](https://github.com/amargiovanni/margiolink/releases) ·
[CI](https://github.com/amargiovanni/margiolink/actions/workflows/ci.yml) ·
[MIT licence](LICENSE)

## What you can do

| Area | Capabilities |
| --- | --- |
| **Manage links** | Generated or custom slugs, editable destinations, expiry and fallback URLs, password protection, coloured tags, pause, soft delete and restore. |
| **Share anywhere** | Copy short URLs, download QR codes as SVG or PNG, and distinguish QR-marked visits from ordinary clicks. |
| **Understand traffic** | Period comparisons, time series, top links, country map, fifteen breakdown dimensions, hourly heatmap and a recent-click feed. |
| **Work comfortably** | Search and paginated lists, keyboard command palette, light and dark themes, mobile layouts, and table alternatives to charts. |
| **Keep control** | One administrator, revocable sessions, a session-authenticated API, CSV link export and your own database. |

MargioLink suits a personal site, publication, small organisation or campaign
that needs an operator-managed link library. It is not a public signup service:
there are no separate user accounts, workspaces, roles or billing features.

## Start here

- [Run locally](#running-it-locally) — try the product without a Cloudflare account.
- [Deploy your own](#deploying-your-own) — configure your database, domain and secrets.
- [Privacy and measurement](#privacy-and-measurement) — understand what the numbers mean.
- [Development](#development) — build, test and contribute.
- [Documentation](#documentation) — API, architecture and operations guides.

## Running it locally

Use **Node.js 24** (see [.nvmrc](.nvmrc)) and npm. Wrangler runs the Worker and
D1 locally; a Cloudflare account is only needed for deployment.

```bash
git clone https://github.com/amargiovanni/margiolink.git
cd margiolink
npm ci
cp .dev.vars.example .dev.vars
```

Edit `.dev.vars`: choose `ADMIN_USER` and `ADMIN_PASSWORD`, and replace
`HASH_SECRET` with a random value of at least 32 characters. For example,
`openssl rand -hex 32` generates a suitable value. This file is gitignored.

Then build the pages, apply the local schema and start the Worker:

```bash
npm run build:web
npm run db:migrate:local
npm run dev
```

Open **[localhost:8787](http://localhost:8787)** for the landing page or
**[localhost:8787/app](http://localhost:8787/app)** for the dashboard. Sign in
with the credentials from `.dev.vars`, then create your first link.

In local development, open short links as `http://localhost:8787/<slug>`.
The API's `shortUrl` and QR codes use the HTTPS hostname in `SHORT_DOMAIN`,
which defaults to the project's public domain.

### Demo data

To explore a populated dashboard, run this on a disposable local database:

```bash
npm run db:seed:demo
```

**The seed replaces all local links, tags, clicks and rollup data.** It refuses
`--remote`. The default dataset contains sixteen links, six tags and roughly
19,000 clicks over 180 days. It also prints a working password-protected link.

Use `node scripts/seed-demo.mjs --days 30` for a shorter history or `--seed 7`
for a different dataset. See [local development and test data](docs/operations.md#local-development-and-test-data)
for the distinction between demo data and browser-test fixtures.

## Deploying your own

You need a Cloudflare account with Workers and D1. For a custom hostname, its
zone must be active in that account. Hosting usage is billed by Cloudflare;
MargioLink has no subscription fee. Check the platform's
[Workers](https://developers.cloudflare.com/workers/platform/pricing/) and
[D1](https://developers.cloudflare.com/d1/platform/pricing/) plans for your workload.

### 1. Install and create a database

Fork and clone the repository, install dependencies with `npm ci`, then:

```bash
npx wrangler login
npx wrangler d1 create margiolink
```

In [wrangler.jsonc](wrangler.jsonc), replace `d1_databases[0].database_id`
with the ID returned for **your** database. Keep the binding `DB` and database
name `margiolink`; the project's database scripts use that name.

### 2. Configure the hostname

Replace `vars.SHORT_DOMAIN` and the custom-domain route with your hostname,
without a scheme, path or trailing slash. For example:

```jsonc
"vars": {
  "SHORT_DOMAIN": "go.example.com",
  "RAW_RETENTION_DAYS": "180"
},
"routes": [
  { "pattern": "go.example.com", "custom_domain": true }
]
```

These are fields to update in the existing configuration, not a replacement
for the whole file. Keep its database, assets and cron bindings. Cloudflare
provisions DNS and a certificate for a
[Custom Domain](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/).

To use [workers.dev](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/)
instead, remove `routes`, set `workers_dev` to `true`,
and set `SHORT_DOMAIN` to your actual `<worker-name>.<account-subdomain>.workers.dev`
hostname. Keep the hostname and Worker name consistent.

### 3. Set production secrets

```bash
npx wrangler secret put ADMIN_USER
npx wrangler secret put ADMIN_PASSWORD
npx wrangler secret put HASH_SECRET
```

Use production credentials and a freshly generated `HASH_SECRET`, not the
example values. Local `.dev.vars` values are not uploaded by these commands.
Secret-dependent routes fail closed when `HASH_SECRET` is missing or shorter
than 32 characters.

### 4. Migrate, build and deploy

```bash
npm run db:migrate
npm run deploy
```

`db:migrate` changes the remote database. `deploy` builds both pages before
uploading the Worker and assets; it also installs the configured cron triggers.

### 5. Verify and personalise

```bash
curl --fail-with-body https://go.example.com/_ready
```

Expect `{"ok":true}`. Then open `/`, `/app` and `/privacy`, sign in, and create
a test link to check its redirect and analytics. Readiness verifies
configuration, the dashboard asset and D1 access; it does not replace those
browser checks.

Before sharing the deployment, update the public copy in [web/index.html](web/index.html),
the privacy notice and security contact in [src/routes/public.ts](src/routes/public.ts),
and your own policy documents. The bundled text describes the software and
project; it cannot supply your deployment's identity or contact details.

For upgrades, backups, rollback and scheduled jobs, use the
[operations guide](docs/operations.md).

## Configuration

| Setting | Where | Meaning |
| --- | --- | --- |
| `SHORT_DOMAIN` | `wrangler.jsonc` → `vars` | Hostname used in short URLs and QR codes, and to reject direct self-referencing destinations. |
| `RAW_RETENTION_DAYS` | `wrangler.jsonc` → `vars` | Positive integer, default `180`. Drives raw-click retention, sensitive aggregate retention, the privacy notice and dashboard range choices. |
| `ADMIN_USER` | Worker secret / local `.dev.vars` | The deployment's single administrator username. |
| `ADMIN_PASSWORD` | Worker secret / local `.dev.vars` | Administrator password; choose a long, unique value. Login accepts up to 200 characters. |
| `HASH_SECRET` | Worker secret / local `.dev.vars` | Random secret, at least 32 characters, used for visitor hashes, login throttling and protected-link grants. |
| `DB` | D1 binding | Your `margiolink` database, with migrations from `migrations/`. |
| `ASSETS` | Static-assets binding | The generated `web/dist` directory. |

The pinned `compatibility_date` is shared by production and the Worker test
runtime. Change it together with runtime upgrades and verification, not as a
routine deployment step.

<a id="how-the-privacy-design-works"></a>

## Privacy and measurement

MargioLink's application database does not store raw visitor IP addresses, raw
user-agent strings or full incoming referrer URLs. It stores coarse request
context, the referrer hostname and bounded campaign labels. It does not use
analytics cookies or load third-party analytics scripts. Fonts and map data
are served with the application.

For unique counts, it derives a visitor code from the IP address, user-agent,
link slug, a secret and the UTC date. The code changes across days and links.
This is **pseudonymous measurement**, not a guarantee of anonymity: the date
key is derived from a retained secret, not destroyed at midnight.

<a id="roadmap"></a>

Read the figures with these limits in mind:

- **Uniques are daily and per link.** A returning visitor can count again on
  another day or another link; a multi-day total is not a count of distinct people.
- **Bots are separated from human analytics.** The summary reports bot traffic
  separately, and the recent-click feed can include bot events with an `isBot` flag.
- **QR attribution is a marker.** `?s=qr` identifies visits to the QR-encoded URL;
  it does not prove that a camera performed a scan.
- **Detailed history is bounded.** Range-based statistics query raw clicks and
  report when retention truncates a requested range. Older aggregate tables
  are maintained, but the statistics API does not yet use them as a historical fallback.

The admin session and a ten-minute protected-link grant use functional cookies.
Neither is an analytics cookie. Changing a link's password or identity
invalidates its existing grants. Rotating `HASH_SECRET` also invalidates grants
and changes newly generated visitor codes; it does not erase stored history.

Raw clicks default to 180-day retention. Sensitive daily dimensions follow the
same window; daily totals and coarse aggregates have no automatic expiry.
Retention can keep raw data longer if rollup is behind, so operators should
monitor the [scheduled jobs](docs/operations.md#scheduled-jobs).

The [data map](compliance/data-map.md),
[legitimate-interest assessment](compliance/legitimate-interest-assessment.md)
and public `/privacy` page document the design. Review them for your deployment,
including your infrastructure and logging configuration.

## Development

Run these from the repository root after installing dependencies:

```bash
npm run check
npm run typecheck
npm run build:verify
npm run test:build-budget
npm test
npm run db:verify-rollback
```

Build before `npm test`: the landing and SPA Worker tests read `web/dist`.
Backend integration tests use a real local D1 under `workerd`; React component
tests use jsdom with a stubbed API.

For real browser coverage:

```bash
npm run db:migrate:local
npx playwright install chromium
npm run e2e
```

Playwright builds the pages and starts the Worker with test credentials. Use
a disposable local database and stop an existing dev server first. The suite
covers navigation, link lifecycle, QR downloads, CSV export, keyboard access,
responsive layouts and axe checks in both themes. CI runs these checks on
pull requests; the [latest run](https://github.com/amargiovanni/margiolink/actions/workflows/ci.yml)
is the source of current results and test counts.

For UI iteration, `npm run dev:web` starts Vite with hot reload. Its standalone
server has no API proxy: use `npm run build:web` followed by `npm run dev` to
exercise the complete application. See [CONTRIBUTING.md](CONTRIBUTING.md) for
conventions and review expectations.

## Documentation

| Guide | Covers |
| --- | --- |
| [API reference](docs/api.md) | Authentication, request examples, endpoints, limits and statistics semantics. |
| [Architecture](docs/architecture.md) | Routing, redirect processing, security boundaries, data model and source layout. |
| [Operations](docs/operations.md) | Upgrades, backups, rollback, cron jobs, local data and troubleshooting. |
| [Changelog](CHANGELOG.md) | Release changes and operator actions. |
| [Security policy](SECURITY.md) | Private vulnerability reporting and disclosure process. |
| [Data map](compliance/data-map.md) | Recorded fields, exclusions and retention. |

Contributions are welcome through issues and pull requests. Follow the
[Code of Conduct](CODE_OF_CONDUCT.md); report vulnerabilities privately using
[SECURITY.md](SECURITY.md). MargioLink is distributed under the [MIT licence](LICENSE).
