# margiolink

A privacy-preserving URL shortener on Cloudflare Workers + D1. Redirects short
links, records pseudonymous click analytics, and serves an admin API.

## Requirements

Node 22+, a Cloudflare account with Workers and D1, and `wrangler` (installed as
a dev dependency — run it through `npx`).

## Local development

```bash
npm install
cp .dev.vars.example .dev.vars   # then edit it, see "Secrets" below
npm run db:migrate:local
npm run dev
```

## Secrets

A deploy needs exactly three secrets. None of them belong in `wrangler.jsonc` —
that file is committed. Set each one with:

```bash
npx wrangler secret put ADMIN_USER
npx wrangler secret put ADMIN_PASSWORD
npx wrangler secret put HASH_SECRET
```

| Secret | What it is |
| --- | --- |
| `ADMIN_USER` | Username for the admin login at `POST /api/auth/login`. |
| `ADMIN_PASSWORD` | Password for that login. Compared in constant time; there is one account. |
| `HASH_SECRET` | HMAC key material for the daily visitor hash (`src/lib/crypto.ts`) and for link-password tokens (`src/auth/link-token.ts`). |

`HASH_SECRET` **must be high-entropy** — generate it, never type it:

```bash
openssl rand -hex 32
```

It must be at least 32 characters. `requireHashSecret` in `src/lib/secrets.ts`
is called wherever the secret is consumed (the redirect handler, the click
ingestion path, the login route) and **throws** if it is missing or shorter than
that, so a Worker deployed without it answers 500 rather than serving requests
with the security and privacy controls silently off. That is deliberate: with an
unset secret the HMAC key would be a literal known string, which makes
`ml_pw_` password-gate tokens forgeable and makes every visitor hash
reproducible by anyone — defeating the pseudonymisation that `/privacy` promises
and that `compliance/legitimate-interest-assessment.md` relies on.

**Never rotate `HASH_SECRET` casually.** Rotating it makes every existing
visitor hash discontinuous: rows written before the change cannot be correlated
with rows written after it, so unique-visitor figures break across the boundary
and already-written aggregates cannot be recomputed from the raw rows. Rotate
only in response to a suspected compromise of the secret, and record when it
happened so the analytics discontinuity can be explained. The daily key
derivation (`` `${secret}:${utcDay(ts)}` ``) already gives the intended
rotation, once per UTC day, without touching the secret.

`SHORT_DOMAIN` and `RAW_RETENTION_DAYS` are plain vars in `wrangler.jsonc`, not
secrets.

## Deploy

```bash
npx wrangler secret put ADMIN_USER      # once per environment
npx wrangler secret put ADMIN_PASSWORD
npx wrangler secret put HASH_SECRET
npm run db:migrate                      # applies migrations/ to the remote D1
npm run deploy
```

Two cron triggers are configured in `wrangler.jsonc`: the hourly one runs the
analytics rollup, and `30 3 * * *` runs retention (raw click deletion, expired
sessions, stale login attempts).

## Database migrations

```bash
npm run db:migrate:local     # apply migrations/ locally
npm run db:migrate           # apply migrations/ to remote
npm run db:rollback:local    # run the newest rollback/*.down.sql locally
npm run db:rollback          # ...against remote
```

Every migration in `migrations/` has a matching reverse script in `rollback/`,
and `test/migration.test.ts` proves the reversal. `scripts/rollback.mjs` also
rewinds the `d1_migrations` bookkeeping table so the migration can be re-applied.

## Checks

```bash
npm test          # vitest, in the Workers runtime
npm run check     # biome
npm run typecheck # tsc --noEmit
```
