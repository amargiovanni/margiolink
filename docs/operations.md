# Operations

[Back to README](../README.md) · [API reference](api.md) · [Architecture](architecture.md)

Use [Deploying your own](../README.md#deploying-your-own) for a first deployment.
This guide covers an existing instance and local development. Commands assume
the configured database is named `margiolink` and run from the repository root.

## Upgrading a deployment

1. Read the target release's [changelog](../CHANGELOG.md), including operator
   actions, and review changes to configuration and migrations.
2. Record the current source commit and Worker version. Save a D1 recovery
   point or export before a schema change. Keep your deployment's hostname,
   database ID and secrets when integrating upstream changes.
3. Install the lockfile dependencies with `npm ci` on Node 24. Run the
   [development checks](../README.md#development) against the target source.
4. Inspect pending migrations, then migrate and deploy:

   ```bash
   npx wrangler d1 migrations list margiolink --remote
   npm run db:migrate
   npm run deploy
   ```

5. Verify the version receiving traffic, `/_ready`, the public landing and
   dashboard, sign-in, a short-link redirect and its analytics. Check that CSS,
   JavaScript and images load with their correct content types and security
   headers. A successful upload alone does not establish a working deployment.

`npm run deploy -- --dry-run` builds and bundles without publishing the Worker.
It does not apply database migrations or establish production readiness.

## Backups and rollback

Record the active Worker deployment and the current D1 recovery bookmark:

```bash
npx wrangler deployments status
npx wrangler d1 time-travel info margiolink --json
```

An optional SQL export should go to protected storage outside the repository:

```bash
umask 077
ML_BACKUP=$(mktemp -d)
npx wrangler d1 export margiolink --remote --output "$ML_BACKUP/margiolink.sql"
```

Retain the export according to your backup policy. D1's recovery window and
export behaviour are described in its
[Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/) and
[Wrangler command](https://developers.cloudflare.com/d1/wrangler-commands/#d1-export)
documentation. Test recovery on a separate database before relying on it.

**Worker rollback and database rollback are separate actions.** Rolling back
code does not restore deleted data or undo a migration. Confirm that the old
code can use the current schema before selecting an earlier Worker version.

The repository provides `npm run db:rollback:local` and `npm run db:rollback`.
The latter targets production. The script executes the lexicographically last
`.down.sql` file in `rollback/` and removes that migration's tracking entry;
it does not discover which downgrade you intend or restore a backup. Read the
SQL, verify the applied migration and assess data loss before using it.
`npm run db:verify-rollback` tests the newest migration's schema reversibility
in a temporary local database.

## Scheduled jobs

Both triggers are declared in [wrangler.jsonc](../wrangler.jsonc), in UTC.

| Schedule | Job | Behaviour |
| --- | --- | --- |
| `0 * * * *` | Rollup | Rebuilds today and yesterday, plus at most seven oldest complete days missing aggregation. Larger backlogs drain over subsequent runs. |
| `30 3 * * *` | Retention | Deletes expired raw clicks, sensitive dimension aggregates, expired sessions and stale throttle rows in bounded batches. |

Rollup is idempotent: rerunning a day replaces its aggregates. Retention keeps
raw days that have not been aggregated, preserving the source for catch-up.
The nominal retention window is therefore dependent on scheduled jobs completing.

Monitor these structured events in Worker logs:

- `rollup_backlog`: catch-up still has more days to process.
- `retention_unaggregated_days`: old raw data was retained because aggregation is missing.
- `retention_click_cap` / `retention_dimension_cap`: a batch limit was reached;
  check that the backlog decreases over subsequent runs.
- `readiness_failed`: a required configuration, asset or D1 check failed.

For [local scheduled-job testing](https://developers.cloudflare.com/workers/configuration/cron-triggers/#test-cron-triggers-locally),
start the Worker with scheduled testing enabled:

```bash
npm run dev -- --test-scheduled
```

In a second terminal:

```bash
curl --get 'http://localhost:8787/cdn-cgi/local/scheduled' \
  --data-urlencode 'cron=0 * * * *'
curl --get 'http://localhost:8787/cdn-cgi/local/scheduled' \
  --data-urlencode 'cron=30 3 * * *'
```

These calls mutate the local database. Use a disposable dataset.

## Credentials and secrets

Change production values with `npx wrangler secret put NAME`. Local values
belong in `.dev.vars`. Never commit either a secret or a database export.

- Changing `ADMIN_PASSWORD` affects new logins. Existing sessions remain valid
  until expiry or revocation; revoke them from Settings or the sessions API
  when changing credentials after suspected compromise.
- Rotating `HASH_SECRET` changes new visitor and throttle codes and invalidates
  existing protected-link grants. It does not delete historical analytics or
  revoke admin sessions. Avoid unplanned rotation within a reporting period.
- Changing a protected link's password or identity invalidates its grants.
  After upgrading from a pre-1.0.0 grant format, visitors must enter the link
  password again.

## Local development and test data

`npm run dev` serves the built `web/dist` through Wrangler on port 8787.
Rebuild after changes to the frontend. `npm run dev:web` is a separate Vite
server for hot reload; it does not proxy API requests to Wrangler.

The demo seed inserts synthetic history directly into **local** D1. It replaces
links, tags, clicks and aggregates. Its generated content is deterministic for
a fixed timestamp, day count and seed; successive runs use a new current time.
It is not a test of redirect ingestion.

Playwright uses [e2e/seed.ts](../e2e/seed.ts) to create and reset fixtures through
the actual HTTP API. It uses local persistent D1, not an automatically isolated
copy of your current local database. Stop a running dev server and use a
disposable checkout/database for the suite. Test credentials are supplied by
[e2e/playwright.config.ts](../e2e/playwright.config.ts); the suite does not edit
`.dev.vars`. Optional overrides are `E2E_ADMIN_USER`, `E2E_ADMIN_PASSWORD` and
`E2E_HASH_SECRET`.

Useful iteration commands:

```bash
npm run test:watch
npm run e2e:ui
npm run check:fix
```

Visual capture tooling remains available in `scripts/screenshots.mjs`. It
reseeds the local database and writes captures under `docs/screenshots/`.
Landing production artwork is maintained separately in `web/src/assets/`;
regenerating documentation captures does not update those WebP assets.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Missing landing, dashboard or static assets | Run `npm run build:web`; verify the `ASSETS` binding points to `web/dist`. |
| `/_health` succeeds but `/_ready` returns 503 | Check all required variables, secret length, `app.html`, D1 binding and applied schema. Read the `readiness_failed` event. |
| API requests fail on the Vite port | Use the built application through Wrangler for API-backed workflows; the standalone Vite server has no proxy. |
| Copied local links open the public domain | `shortUrl` and QR use `SHORT_DOMAIN`. During local testing navigate to `http://localhost:8787/<slug>`. |
| Longer dashboard periods are unavailable | Both the requested range and its preceding comparison must fit the configured raw retention window. |
| A new click is not immediately visible | Recording is asynchronous. Non-live client queries have a 60-second freshness window; the mounted live feed polls every ten seconds. |
| Browser tests reuse the wrong credentials or data | Stop the existing dev server and rerun against a migrated disposable local database. |
| Old raw rows remain beyond retention | Check cron execution, rollup backlog and retention cap events before changing the retention value. |

For reports, include the source commit or release, the affected route, the
observed result and a minimal reproduction. Send security-sensitive reports
through [SECURITY.md](../SECURITY.md).
