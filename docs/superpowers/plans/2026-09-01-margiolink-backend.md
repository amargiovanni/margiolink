# MargioLink Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A deployable Cloudflare Worker that shortens URLs, redirects visitors, records privacy-preserving click analytics into D1, and exposes an authenticated JSON API — everything the dashboard will later consume.

**Architecture:** One Worker on `link.margio.uk`. The public redirect at `/:slug` answers with a `302` and records the click in `ctx.waitUntil()` so database latency never reaches the visitor. `/api/*` is a Hono sub-router behind session middleware. Two cron triggers roll raw clicks into daily aggregates and delete raw rows past retention. D1 is the only datastore; hand-written SQL sits behind a repository module.

**Tech Stack:** TypeScript, Hono 4, Zod 4, D1, Wrangler 4, Vitest 3 with `@cloudflare/vitest-pool-workers`, Biome 2. Runtime deps: `bowser` (UA fallback), `isbot`, `qrcode-generator`.

**Spec:** `docs/superpowers/specs/2026-09-01-margiolink-design.md` — read it before Task 1. This plan implements sections 2, 3, 4, 5, 7 and 8. Section 6 (dashboard) is a separate plan.

## Global Constraints

- **Runtime:** Cloudflare Workers, ES modules. No Node built-ins; `nodejs_compat` is deliberately not enabled.
- **Language:** TypeScript strict. Everything in the repo is English — code, identifiers, comments, commit messages.
- **No IP address is ever written to the database in any form** except the daily-rotating HMAC in `login_attempts.ip_hash` (spec §4.1). No raw user-agent string is stored.
- **Every task ends with at least one test.** Tests run inside workerd against real D1 via `@cloudflare/vitest-pool-workers` — never against a mocked database.
- **Every migration is reversible.** Each `migrations/NNNN_name.sql` has a matching `rollback/NNNN_name.down.sql`, and the down file is tested.
- **Secrets never enter the repo.** `ADMIN_USER`, `ADMIN_PASSWORD` and `HASH_SECRET` are Worker secrets locally supplied through `.dev.vars`, which `.gitignore` already excludes.
- **Slug alphabet:** `23456789abcdefghjkmnpqrstuvwxyz` (31 chars, no `0`/`1`/`l`/`i`/`o`), default length 7.
- **Reserved slugs:** `app`, `api`, `privacy`, `assets`, `robots.txt`, `favicon.ico`, `_health`.
- **Retention:** raw `clicks` rows are deleted after `RAW_RETENTION_DAYS` (default `180`).
- **Commit format:** `type(scope): imperative subject`, ≤72 chars, English. One commit per task.
- **Branch:** all work on `feature/ML-1-backend`, branched from `main`.

---

## File Structure

```
wrangler.jsonc            Worker config: D1 binding, vars, cron triggers, route
package.json              scripts and dependencies
tsconfig.json             strict TypeScript, Workers types
biome.json                lint + format
vitest.config.ts          workers pool, test bindings, migration loading
env.d.ts                  ProvidedEnv declaration for cloudflare:test
.dev.vars.example         template for local secrets (the real .dev.vars is ignored)

migrations/0001_init.sql          full schema
rollback/0001_init.down.sql       its reverse
scripts/rollback.mjs              applies the latest down file and rewinds d1_migrations

src/index.ts              Worker entry: fetch + scheduled handlers, route mounting
src/types.ts              Env, ClickEvent, and the shared domain types

src/lib/slug.ts           slug generation, normalisation, reserved-slug check
src/lib/url.ts            destination URL validation
src/lib/crypto.ts         daily HMAC key, visitor hash, PBKDF2, constant-time compare
src/lib/ua.ts             client hints first, bowser fallback
src/lib/referrer.ts       referrer host extraction and classification
src/lib/request-context.ts  pulls geo, UTM and source out of an incoming Request

src/db/links.ts           link CRUD and slug resolution
src/db/clicks.ts          click insertion and raw-range queries
src/db/tags.ts            tag CRUD and link/tag association
src/db/sessions.ts        admin session storage
src/db/stats.ts           aggregate queries backing the dashboard

src/ingest/record-click.ts  the single ingestion boundary (spec §2.2)

src/auth/session.ts       cookie issue/read/clear
src/auth/rate-limit.ts    per-IP-hash login throttle
src/auth/middleware.ts    Hono session middleware

src/routes/redirect.ts    GET /:slug — all five outcomes, plus the password interstitial
src/routes/public.ts      GET /privacy, GET /robots.txt
src/routes/api/index.ts   authenticated router; every authenticated route mounts here
src/routes/api/auth.ts    login, logout, session list, revoke
src/routes/api/links.ts   link CRUD, QR endpoint
src/routes/api/tags.ts    tag CRUD
src/routes/api/stats.ts   summary, timeseries, dimension breakdown, live feed

src/cron/rollup.ts        hourly aggregation into click_daily and click_daily_dim
src/cron/retention.ts     daily deletion of raw rows and stale auth rows

compliance/legitimate-interest-assessment.md   Article 6(1)(f) balancing test
compliance/data-map.md    every clicks column, classified

test/setup.ts             applies migrations before each test file
test/compliance.test.ts   fails when the schema outgrows the data map
test/**                   one test file per source module
```

Files that change together live together: `src/lib/` holds pure functions with no database access (fast to test, no fixtures), `src/db/` holds every SQL statement in the project, and `src/routes/` holds only request/response wiring.

---

## Task 1: Project scaffold and a Worker that answers

**Files:**
- Create: `package.json`, `tsconfig.json`, `biome.json`, `wrangler.jsonc`, `vitest.config.ts`, `env.d.ts`, `.dev.vars.example`, `src/index.ts`, `src/types.ts`, `test/setup.ts`
- Test: `test/health.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `Env` (the binding interface every later task imports from `src/types.ts`), and a Hono app exported as the Worker default export.

- [ ] **Step 1: Create the branch**

```bash
git checkout -b feature/ML-1-backend
```

- [ ] **Step 2: Initialise the package and install dependencies**

The user authorised these packages explicitly. Install nothing beyond this list without asking again.

```bash
npm init -y
npm install hono zod bowser isbot qrcode-generator
npm install -D wrangler typescript vitest @cloudflare/vitest-pool-workers @cloudflare/workers-types @biomejs/biome
```

- [ ] **Step 3: Replace the generated `package.json`**

```json
{
  "name": "margiolink",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "check": "biome check .",
    "check:fix": "biome check --write .",
    "db:migrate:local": "wrangler d1 migrations apply margiolink --local",
    "db:migrate": "wrangler d1 migrations apply margiolink --remote",
    "db:rollback:local": "node scripts/rollback.mjs --local",
    "db:rollback": "node scripts/rollback.mjs --remote"
  }
}
```

Keep the `dependencies` and `devDependencies` blocks that `npm install` wrote — do not retype them by hand.

- [ ] **Step 4: Create the D1 database and capture its id**

```bash
npx wrangler d1 create margiolink
```

The command prints a `database_id` UUID. Paste that exact value into `wrangler.jsonc` in the next step. If the account is not yet authenticated, run `npx wrangler login` first.

- [ ] **Step 5: Write `wrangler.jsonc`**

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "margiolink",
  "main": "src/index.ts",
  "compatibility_date": "2026-09-01",
  "observability": { "enabled": true },
  "vars": {
    "SHORT_DOMAIN": "link.margio.uk",
    "RAW_RETENTION_DAYS": "180"
  },
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "margiolink",
      "database_id": "<paste the UUID printed by wrangler d1 create>",
      "migrations_dir": "migrations"
    }
  ],
  "triggers": {
    "crons": ["0 * * * *", "30 3 * * *"]
  },
  "routes": [
    { "pattern": "link.margio.uk/*", "zone_name": "margio.uk" }
  ]
}
```

- [ ] **Step 6: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "types": ["@cloudflare/workers-types/2023-07-01", "@cloudflare/vitest-pool-workers"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noEmit": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true
  },
  "include": ["src", "test", "scripts", "*.ts", "*.d.ts"]
}
```

- [ ] **Step 7: Write `biome.json`**

```json
{
  "$schema": "https://biomejs.dev/schemas/2.0.0/schema.json",
  "files": { "includes": ["src/**", "test/**", "scripts/**"] },
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 100
  },
  "linter": { "enabled": true, "rules": { "recommended": true } },
  "assist": { "actions": { "source": { "organizeImports": "on" } } }
}
```

- [ ] **Step 8: Write `src/types.ts`**

```ts
export interface Env {
  DB: D1Database;
  ADMIN_USER: string;
  ADMIN_PASSWORD: string;
  HASH_SECRET: string;
  SHORT_DOMAIN: string;
  RAW_RETENTION_DAYS: string;
}
```

- [ ] **Step 9: Write `.dev.vars.example`**

```
ADMIN_USER=admin
ADMIN_PASSWORD=change-me-locally
HASH_SECRET=a-long-random-string-used-for-visitor-hashing
```

Then copy the two admin values out of the existing `.env` into a real `.dev.vars`, and generate `HASH_SECRET` with `openssl rand -hex 32`. `.dev.vars` is already excluded by `.gitignore`.

- [ ] **Step 10: Write `src/index.ts`**

```ts
import { Hono } from "hono";
import type { Env } from "./types";

const app = new Hono<{ Bindings: Env }>();

app.get("/_health", (c) => c.json({ ok: true }));

export default {
  fetch: app.fetch,
} satisfies ExportedHandler<Env>;
```

- [ ] **Step 11: Write `env.d.ts`**

```ts
import type { Env } from "./src/types";

declare module "cloudflare:test" {
  interface ProvidedEnv extends Env {
    TEST_MIGRATIONS: D1Migration[];
  }
}

declare module "*.sql?raw" {
  const contents: string;
  export default contents;
}
```

The second declaration lets Task 2's reversibility test import the rollback file
as a string.

- [ ] **Step 12: Write `vitest.config.ts`**

```ts
import { defineWorkersConfig, readD1Migrations } from "@cloudflare/vitest-pool-workers/config";

const migrations = await readD1Migrations(new URL("./migrations", import.meta.url).pathname);

export default defineWorkersConfig({
  test: {
    setupFiles: ["./test/setup.ts"],
    poolOptions: {
      workers: {
        singleWorker: true,
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            ADMIN_USER: "admin",
            ADMIN_PASSWORD: "correct-horse-battery-staple",
            HASH_SECRET: "test-hash-secret-not-a-real-one",
            SHORT_DOMAIN: "link.test",
            RAW_RETENTION_DAYS: "180",
          },
        },
      },
    },
  },
});
```

- [ ] **Step 13: Write `test/setup.ts`**

```ts
import { applyD1Migrations, env } from "cloudflare:test";
import { beforeAll } from "vitest";

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});
```

- [ ] **Step 14: Create the empty migrations directory**

`readD1Migrations` fails if the directory does not exist, and Task 2 fills it.

```bash
mkdir -p migrations rollback && touch migrations/.gitkeep
```

- [ ] **Step 15: Write the failing test `test/health.test.ts`**

```ts
import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("health endpoint", () => {
  it("answers 200 with ok:true", async () => {
    const res = await SELF.fetch("https://link.test/_health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});
```

- [ ] **Step 16: Run the test**

Run: `npm test`
Expected: PASS. If it fails on binding or migration errors, the config is wrong — fix it here rather than carrying the problem into Task 2.

- [ ] **Step 17: Verify lint and types are clean**

Run: `npm run check && npm run typecheck`
Expected: both exit 0.

- [ ] **Step 18: Commit**

```bash
git add -A
git commit -m "chore(scaffold): add worker, tooling and health endpoint"
```

---

## Task 2: Schema, migration, and a proven rollback

**Files:**
- Create: `migrations/0001_init.sql`, `rollback/0001_init.down.sql`, `scripts/rollback.mjs`
- Delete: `migrations/.gitkeep`
- Test: `test/migration.test.ts`

**Interfaces:**
- Consumes: the `DB` binding from Task 1.
- Produces: the complete schema of spec §3. Every later task's SQL targets these exact table and column names.

- [ ] **Step 1: Write `migrations/0001_init.sql`**

```sql
CREATE TABLE links (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  slug          TEXT    NOT NULL UNIQUE,
  target_url    TEXT    NOT NULL,
  title         TEXT,
  description   TEXT,
  password_hash TEXT,
  password_salt TEXT,
  expires_at    INTEGER,
  expired_url   TEXT,
  is_active     INTEGER NOT NULL DEFAULT 1,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  deleted_at    INTEGER
);

CREATE INDEX idx_links_created_at ON links (created_at DESC);
CREATE INDEX idx_links_deleted_at ON links (deleted_at);

CREATE TABLE tags (
  id    INTEGER PRIMARY KEY AUTOINCREMENT,
  name  TEXT NOT NULL UNIQUE,
  color TEXT NOT NULL
);

CREATE TABLE link_tags (
  link_id INTEGER NOT NULL REFERENCES links (id) ON DELETE CASCADE,
  tag_id  INTEGER NOT NULL REFERENCES tags (id) ON DELETE CASCADE,
  PRIMARY KEY (link_id, tag_id)
);

CREATE INDEX idx_link_tags_tag ON link_tags (tag_id);

CREATE TABLE clicks (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  link_id         INTEGER NOT NULL REFERENCES links (id) ON DELETE CASCADE,
  ts              INTEGER NOT NULL,
  visitor_hash    TEXT    NOT NULL,
  source          TEXT    NOT NULL,
  outcome         TEXT    NOT NULL,
  is_bot          INTEGER NOT NULL DEFAULT 0,
  continent       TEXT,
  country         TEXT,
  region          TEXT,
  city            TEXT,
  timezone        TEXT,
  asn_org         TEXT,
  colo            TEXT,
  device_type     TEXT,
  os              TEXT,
  os_version      TEXT,
  browser         TEXT,
  browser_version TEXT,
  language        TEXT,
  referrer_host   TEXT,
  referrer_url    TEXT,
  referrer_type   TEXT,
  utm_source      TEXT,
  utm_medium      TEXT,
  utm_campaign    TEXT,
  utm_term        TEXT,
  utm_content     TEXT
);

CREATE INDEX idx_clicks_link_ts ON clicks (link_id, ts);
CREATE INDEX idx_clicks_ts ON clicks (ts);
```

> **Superseded during execution.** The final whole-branch review found that
> `referrer_url` — the full third-party URL including path and query — was
> written on every click and read by no query. Migration `0002` drops it; see
> the design spec's §3.2 note. Do not reintroduce it.

```sql

CREATE TABLE click_daily (
  day     TEXT    NOT NULL,
  link_id INTEGER NOT NULL,
  clicks  INTEGER NOT NULL,
  uniques INTEGER NOT NULL,
  bots    INTEGER NOT NULL,
  PRIMARY KEY (day, link_id)
);

CREATE TABLE click_daily_dim (
  day       TEXT    NOT NULL,
  link_id   INTEGER NOT NULL,
  dimension TEXT    NOT NULL,
  value     TEXT    NOT NULL,
  clicks    INTEGER NOT NULL,
  uniques   INTEGER NOT NULL,
  PRIMARY KEY (day, link_id, dimension, value)
);

CREATE INDEX idx_click_daily_dim_lookup ON click_daily_dim (dimension, day, link_id);

CREATE TABLE admin_sessions (
  id           TEXT    PRIMARY KEY,
  created_at   INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL,
  ua_summary   TEXT
);

CREATE INDEX idx_admin_sessions_expires ON admin_sessions (expires_at);

CREATE TABLE login_attempts (
  ip_hash          TEXT    PRIMARY KEY,
  attempts         INTEGER NOT NULL,
  first_attempt_at INTEGER NOT NULL,
  locked_until     INTEGER
);
```

`admin_sessions.id` holds the SHA-256 of the token carried in the cookie; the token itself is never stored. `login_attempts.ip_hash` uses the same daily-rotating HMAC as visitor hashing and is purged daily — this is the one narrow IP-derived value the spec permits, and only to protect the account.

- [ ] **Step 2: Write `rollback/0001_init.down.sql`**

Reverse order, so foreign key targets outlive their referrers.

```sql
DROP TABLE IF EXISTS login_attempts;
DROP TABLE IF EXISTS admin_sessions;
DROP TABLE IF EXISTS click_daily_dim;
DROP TABLE IF EXISTS click_daily;
DROP TABLE IF EXISTS clicks;
DROP TABLE IF EXISTS link_tags;
DROP TABLE IF EXISTS tags;
DROP TABLE IF EXISTS links;
```

- [ ] **Step 3: Write the failing test `test/migration.test.ts`**

This is the reversibility proof: it applies the schema, executes the down file, and asserts nothing of ours survives.

```ts
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import downSql from "../rollback/0001_init.down.sql?raw";

const OUR_TABLES = [
  "links",
  "tags",
  "link_tags",
  "clicks",
  "click_daily",
  "click_daily_dim",
  "admin_sessions",
  "login_attempts",
];

async function tableNames(): Promise<string[]> {
  const { results } = await env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table'",
  ).all<{ name: string }>();
  return results.map((r) => r.name);
}

describe("migration 0001", () => {
  it("creates every table the spec defines", async () => {
    const names = await tableNames();
    for (const table of OUR_TABLES) {
      expect(names).toContain(table);
    }
  });

  it("is fully reversible", async () => {
    const statements = downSql
      .split(";")
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .map((s) => env.DB.prepare(s));
    await env.DB.batch(statements);

    const names = await tableNames();
    for (const table of OUR_TABLES) {
      expect(names).not.toContain(table);
    }
  });
});
```

- [ ] **Step 4: Run the test**

Run: `npm test -- test/migration.test.ts`
Expected: PASS. Test isolation means the dropped tables do not leak into other test files.

- [ ] **Step 5: Write `scripts/rollback.mjs`**

```js
#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";

const DB = "margiolink";
const target = process.argv.includes("--remote") ? "--remote" : "--local";

const files = readdirSync("rollback")
  .filter((f) => f.endsWith(".down.sql"))
  .sort();

const last = files.at(-1);
if (!last) {
  console.error("No rollback files found in rollback/");
  process.exit(1);
}

const migrationName = last.replace(".down.sql", ".sql");

execFileSync("npx", ["wrangler", "d1", "execute", DB, target, "--file", `rollback/${last}`, "--yes"], {
  stdio: "inherit",
});
execFileSync(
  "npx",
  [
    "wrangler",
    "d1",
    "execute",
    DB,
    target,
    "--command",
    `DELETE FROM d1_migrations WHERE name = '${migrationName}'`,
    "--yes",
  ],
  { stdio: "inherit" },
);

console.log(`Rolled back ${migrationName}`);
```

It reverses only the most recent migration, which is the only rollback that is ever safe to automate.

- [ ] **Step 6: Prove the rollback against a real database**

Run, and paste the output into the task's completion note:

```bash
rm -f migrations/.gitkeep
npm run db:migrate:local
npx wrangler d1 execute margiolink --local --command "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name" --yes
npm run db:rollback:local
npx wrangler d1 execute margiolink --local --command "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name" --yes
npm run db:migrate:local
```

Expected: the first listing shows our eight tables, the second shows none of them, the third re-applies cleanly. A rollback that has not been run is not a rollback.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(db): add initial schema with tested rollback"
```

---

## Task 3: Slug generation and reserved slugs

**Files:**
- Create: `src/lib/slug.ts`
- Test: `test/lib/slug.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `generateSlug(length?: number): string`, `normaliseSlug(input: string): string`, `isValidSlugShape(slug: string): boolean`, `isReservedSlug(slug: string): boolean`, `RESERVED_SLUGS: ReadonlySet<string>`.

- [ ] **Step 1: Write the failing test `test/lib/slug.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import {
  generateSlug,
  isReservedSlug,
  isValidSlugShape,
  normaliseSlug,
} from "../../src/lib/slug";

describe("generateSlug", () => {
  it("returns 7 characters by default", () => {
    expect(generateSlug()).toHaveLength(7);
  });

  it("honours a requested length", () => {
    expect(generateSlug(12)).toHaveLength(12);
  });

  it("never emits visually ambiguous characters", () => {
    const sample = Array.from({ length: 200 }, () => generateSlug(16)).join("");
    expect(sample).not.toMatch(/[01lio]/);
  });

  it("does not repeat within a large sample", () => {
    const seen = new Set(Array.from({ length: 2000 }, () => generateSlug()));
    expect(seen.size).toBe(2000);
  });
});

describe("normaliseSlug", () => {
  it("lowercases and trims", () => {
    expect(normaliseSlug("  MyLink  ")).toBe("mylink");
  });
});

describe("isValidSlugShape", () => {
  it.each(["abc", "my-link", "my_link", "a1", "x".repeat(64)])("accepts %s", (slug) => {
    expect(isValidSlugShape(slug)).toBe(true);
  });

  it.each(["", "-leading", "_leading", "has space", "has/slash", "x".repeat(65), "Uppercase"])(
    "rejects %s",
    (slug) => {
      expect(isValidSlugShape(slug)).toBe(false);
    },
  );
});

describe("isReservedSlug", () => {
  it.each(["app", "api", "privacy", "assets", "robots.txt", "favicon.ico", "_health"])(
    "reserves %s",
    (slug) => {
      expect(isReservedSlug(slug)).toBe(true);
    },
  );

  it("is case-insensitive", () => {
    expect(isReservedSlug("APP")).toBe(true);
  });

  it("allows ordinary slugs", () => {
    expect(isReservedSlug("launch")).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm test -- test/lib/slug.test.ts`
Expected: FAIL — cannot resolve `../../src/lib/slug`.

- [ ] **Step 3: Write `src/lib/slug.ts`**

```ts
const ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";
const SLUG_SHAPE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  "app",
  "api",
  "privacy",
  "assets",
  "robots.txt",
  "favicon.ico",
  "_health",
]);

export function generateSlug(length = 7): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const byte of bytes) {
    out += ALPHABET.charAt(byte % ALPHABET.length);
  }
  return out;
}

export function normaliseSlug(input: string): string {
  return input.trim().toLowerCase();
}

export function isValidSlugShape(slug: string): boolean {
  return SLUG_SHAPE.test(slug);
}

export function isReservedSlug(slug: string): boolean {
  return RESERVED_SLUGS.has(normaliseSlug(slug));
}
```

The modulo introduces a negligible bias across 31 symbols in 256 values; at 7 characters the collision surface is roughly 27 billion, and `createLink` retries on the unique constraint anyway.

- [ ] **Step 4: Run the test**

Run: `npm test -- test/lib/slug.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/slug.ts test/lib/slug.test.ts
git commit -m "feat(links): add slug generation and reserved-slug rules"
```

---

## Task 4: Destination URL validation

**Files:**
- Create: `src/lib/url.ts`
- Test: `test/lib/url.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `validateTargetUrl(input: string, shortDomain: string): UrlValidation`, where `type UrlValidation = { ok: true; url: string } | { ok: false; error: "invalid" | "unsupported_protocol" | "self_reference" | "too_long" }`.

- [ ] **Step 1: Write the failing test `test/lib/url.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { validateTargetUrl } from "../../src/lib/url";

const DOMAIN = "link.test";

describe("validateTargetUrl", () => {
  it("accepts an https URL and returns it normalised", () => {
    const result = validateTargetUrl("https://example.com/path?a=1", DOMAIN);
    expect(result).toEqual({ ok: true, url: "https://example.com/path?a=1" });
  });

  it("accepts plain http", () => {
    expect(validateTargetUrl("http://example.com", DOMAIN).ok).toBe(true);
  });

  it.each(["javascript:alert(1)", "data:text/html,<script>", "file:///etc/passwd", "vbscript:x"])(
    "rejects the %s scheme",
    (input) => {
      expect(validateTargetUrl(input, DOMAIN)).toEqual({
        ok: false,
        error: "unsupported_protocol",
      });
    },
  );

  it.each(["", "   ", "not a url", "http://"])("rejects unparseable input %s", (input) => {
    expect(validateTargetUrl(input, DOMAIN)).toEqual({ ok: false, error: "invalid" });
  });

  it("rejects a target on the short domain to prevent redirect loops", () => {
    expect(validateTargetUrl("https://link.test/abc", DOMAIN)).toEqual({
      ok: false,
      error: "self_reference",
    });
  });

  it("rejects the short domain regardless of case", () => {
    expect(validateTargetUrl("https://LINK.TEST/abc", DOMAIN).ok).toBe(false);
  });

  it("rejects URLs longer than 2048 characters", () => {
    const long = `https://example.com/${"a".repeat(2100)}`;
    expect(validateTargetUrl(long, DOMAIN)).toEqual({ ok: false, error: "too_long" });
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm test -- test/lib/url.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/lib/url.ts`**

```ts
export type UrlValidation =
  | { ok: true; url: string }
  | { ok: false; error: "invalid" | "unsupported_protocol" | "self_reference" | "too_long" };

const MAX_LENGTH = 2048;
const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

export function validateTargetUrl(input: string, shortDomain: string): UrlValidation {
  const trimmed = input.trim();

  if (trimmed.length > MAX_LENGTH) {
    return { ok: false, error: "too_long" };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, error: "invalid" };
  }

  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    return { ok: false, error: "unsupported_protocol" };
  }

  if (parsed.hostname === "") {
    return { ok: false, error: "invalid" };
  }

  if (parsed.hostname.toLowerCase() === shortDomain.toLowerCase()) {
    return { ok: false, error: "self_reference" };
  }

  return { ok: true, url: parsed.toString() };
}
```

Order matters: length is checked before parsing, so a hostile megabyte-long string never reaches the URL parser.

- [ ] **Step 4: Run the test**

Run: `npm test -- test/lib/url.test.ts`
Expected: PASS. Note that `new URL("javascript:alert(1)")` parses successfully — the protocol check, not the parser, is what rejects it, which is exactly why that check exists.

- [ ] **Step 5: Commit**

```bash
git add src/lib/url.ts test/lib/url.test.ts
git commit -m "feat(links): validate destination URLs against unsafe schemes and loops"
```

---

## Task 5: Cryptography — daily-rotating hashes, passwords, constant-time comparison

**Files:**
- Create: `src/lib/crypto.ts`
- Test: `test/lib/crypto.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `utcDay(ts: number): string` returning `YYYY-MM-DD`
  - `visitorHash(secret: string, ip: string, ua: string, slug: string, ts: number): Promise<string>` returning 32 hex chars
  - `ipHash(secret: string, ip: string, ts: number): Promise<string>` returning 32 hex chars
  - `sha256Hex(input: string): Promise<string>`
  - `randomToken(): string` returning 64 hex chars
  - `constantTimeEquals(a: string, b: string): Promise<boolean>`
  - `randomSalt(): string` returning 32 hex chars
  - `hashPassword(password: string, saltHex: string): Promise<string>`
  - `verifyPassword(password: string, saltHex: string, expectedHex: string): Promise<boolean>`

- [ ] **Step 1: Write the failing test `test/lib/crypto.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import {
  constantTimeEquals,
  hashPassword,
  ipHash,
  randomSalt,
  randomToken,
  sha256Hex,
  utcDay,
  verifyPassword,
  visitorHash,
} from "../../src/lib/crypto";

const SECRET = "test-secret";
const DAY_ONE = Date.parse("2026-03-10T12:00:00Z") / 1000;
const DAY_ONE_LATER = Date.parse("2026-03-10T23:59:00Z") / 1000;
const DAY_TWO = Date.parse("2026-03-11T00:01:00Z") / 1000;

describe("utcDay", () => {
  it("formats a unix second as a UTC calendar day", () => {
    expect(utcDay(DAY_ONE)).toBe("2026-03-10");
  });

  it("rolls over at UTC midnight, not local midnight", () => {
    expect(utcDay(DAY_TWO)).toBe("2026-03-11");
  });
});

describe("visitorHash", () => {
  it("is stable for the same visitor within one day", async () => {
    const a = await visitorHash(SECRET, "1.2.3.4", "UA/1", "abc", DAY_ONE);
    const b = await visitorHash(SECRET, "1.2.3.4", "UA/1", "abc", DAY_ONE_LATER);
    expect(a).toBe(b);
  });

  it("differs for the same visitor on the next day, so they cannot be followed", async () => {
    const a = await visitorHash(SECRET, "1.2.3.4", "UA/1", "abc", DAY_ONE);
    const b = await visitorHash(SECRET, "1.2.3.4", "UA/1", "abc", DAY_TWO);
    expect(a).not.toBe(b);
  });

  it("differs between two visitors", async () => {
    const a = await visitorHash(SECRET, "1.2.3.4", "UA/1", "abc", DAY_ONE);
    const b = await visitorHash(SECRET, "5.6.7.8", "UA/1", "abc", DAY_ONE);
    expect(a).not.toBe(b);
  });

  it("differs across links for the same visitor", async () => {
    const a = await visitorHash(SECRET, "1.2.3.4", "UA/1", "abc", DAY_ONE);
    const b = await visitorHash(SECRET, "1.2.3.4", "UA/1", "xyz", DAY_ONE);
    expect(a).not.toBe(b);
  });

  it("returns 32 hex characters and never the input", async () => {
    const hash = await visitorHash(SECRET, "1.2.3.4", "UA/1", "abc", DAY_ONE);
    expect(hash).toMatch(/^[0-9a-f]{32}$/);
    expect(hash).not.toContain("1.2.3.4");
  });
});

describe("ipHash", () => {
  it("rotates daily like the visitor hash", async () => {
    const a = await ipHash(SECRET, "1.2.3.4", DAY_ONE);
    const b = await ipHash(SECRET, "1.2.3.4", DAY_TWO);
    expect(a).not.toBe(b);
  });
});

describe("constantTimeEquals", () => {
  it("is true for equal strings", async () => {
    expect(await constantTimeEquals("hunter2", "hunter2")).toBe(true);
  });

  it("is false for different strings of equal length", async () => {
    expect(await constantTimeEquals("hunter2", "hunter3")).toBe(false);
  });

  it("is false for different lengths without throwing", async () => {
    expect(await constantTimeEquals("short", "a much longer value")).toBe(false);
  });
});

describe("randomToken", () => {
  it("returns 64 hex characters", () => {
    expect(randomToken()).toMatch(/^[0-9a-f]{64}$/);
  });

  it("does not repeat", () => {
    const seen = new Set(Array.from({ length: 500 }, () => randomToken()));
    expect(seen.size).toBe(500);
  });
});

describe("sha256Hex", () => {
  it("matches the known digest of the empty string", async () => {
    expect(await sha256Hex("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });
});

describe("password hashing", () => {
  it("verifies the correct password", async () => {
    const salt = randomSalt();
    const hash = await hashPassword("open sesame", salt);
    expect(await verifyPassword("open sesame", salt, hash)).toBe(true);
  });

  it("rejects the wrong password", async () => {
    const salt = randomSalt();
    const hash = await hashPassword("open sesame", salt);
    expect(await verifyPassword("open sesam", salt, hash)).toBe(false);
  });

  it("produces different hashes for the same password under different salts", async () => {
    const a = await hashPassword("same", randomSalt());
    const b = await hashPassword("same", randomSalt());
    expect(a).not.toBe(b);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm test -- test/lib/crypto.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/lib/crypto.ts`**

```ts
const PBKDF2_ITERATIONS = 100_000;
const encoder = new TextEncoder();

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

export function utcDay(ts: number): string {
  return new Date(ts * 1000).toISOString().slice(0, 10);
}

async function dailyKey(secret: string, ts: number): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(`${secret}:${utcDay(ts)}`),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

async function dailyHmac(secret: string, ts: number, message: string): Promise<string> {
  const key = await dailyKey(secret, ts);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return toHex(signature).slice(0, 32);
}

export function visitorHash(
  secret: string,
  ip: string,
  ua: string,
  slug: string,
  ts: number,
): Promise<string> {
  return dailyHmac(secret, ts, `${ip} ${ua} ${slug}`);
}

export function ipHash(secret: string, ip: string, ts: number): Promise<string> {
  return dailyHmac(secret, ts, `login ${ip}`);
}

export async function sha256Hex(input: string): Promise<string> {
  return toHex(await crypto.subtle.digest("SHA-256", encoder.encode(input)));
}

export function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return toHex(bytes.buffer);
}

export function randomSalt(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return toHex(bytes.buffer);
}

export async function constantTimeEquals(a: string, b: string): Promise<boolean> {
  const [digestA, digestB] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(a)),
    crypto.subtle.digest("SHA-256", encoder.encode(b)),
  ]);
  return crypto.subtle.timingSafeEqual(digestA, digestB);
}

export async function hashPassword(password: string, saltHex: string): Promise<string> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: fromHex(saltHex),
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    keyMaterial,
    256,
  );
  return toHex(bits);
}

export async function verifyPassword(
  password: string,
  saltHex: string,
  expectedHex: string,
): Promise<boolean> {
  const actual = await hashPassword(password, saltHex);
  return constantTimeEquals(actual, expectedHex);
}
```

Hashing both sides before `timingSafeEqual` serves two purposes: it satisfies that function's equal-length requirement, and it stops the comparison from leaking the length of the real secret.

- [ ] **Step 4: Run the test**

Run: `npm test -- test/lib/crypto.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/crypto.ts test/lib/crypto.test.ts
git commit -m "feat(privacy): add daily-rotating visitor hashing and password primitives"
```

---

## Task 6: Client detection from hints, with a user-agent fallback

**Files:**
- Create: `src/lib/ua.ts`
- Test: `test/lib/ua.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `parseClient(headers: Headers): ClientInfo` where

```ts
interface ClientInfo {
  deviceType: "desktop" | "mobile" | "tablet" | "bot" | "unknown";
  os: string | null;
  osVersion: string | null;
  browser: string | null;
  browserVersion: string | null;
  language: string | null;
  isBot: boolean;
}
```

- [ ] **Step 1: Write the failing test `test/lib/ua.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { parseClient } from "../../src/lib/ua";

const CHROME_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Mobile/15E148 Safari/604.1";
const IPAD_UA =
  "Mozilla/5.0 (iPad; CPU OS 18_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Mobile/15E148 Safari/604.1";
const GOOGLEBOT_UA =
  "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";

function headers(init: Record<string, string>): Headers {
  return new Headers(init);
}

describe("parseClient with client hints", () => {
  it("prefers the specific brand over Chromium and the placeholder brand", () => {
    const result = parseClient(
      headers({
        "sec-ch-ua": '"Chromium";v="140", "Not?A_Brand";v="24", "Google Chrome";v="140"',
        "sec-ch-ua-platform": '"macOS"',
        "sec-ch-ua-mobile": "?0",
        "user-agent": CHROME_UA,
      }),
    );
    expect(result.browser).toBe("Google Chrome");
    expect(result.browserVersion).toBe("140");
    expect(result.os).toBe("macOS");
    expect(result.deviceType).toBe("desktop");
  });

  it("reads mobile from the hint", () => {
    const result = parseClient(
      headers({
        "sec-ch-ua": '"Chromium";v="140", "Not?A_Brand";v="24"',
        "sec-ch-ua-platform": '"Android"',
        "sec-ch-ua-mobile": "?1",
        "user-agent": CHROME_UA,
      }),
    );
    expect(result.deviceType).toBe("mobile");
    expect(result.os).toBe("Android");
  });
});

describe("parseClient falling back to the user-agent", () => {
  it("identifies desktop Chrome", () => {
    const result = parseClient(headers({ "user-agent": CHROME_UA }));
    expect(result.browser).toBe("Chrome");
    expect(result.deviceType).toBe("desktop");
    expect(result.os).not.toBeNull();
  });

  it("identifies an iPhone as mobile", () => {
    const result = parseClient(headers({ "user-agent": IPHONE_UA }));
    expect(result.deviceType).toBe("mobile");
  });

  it("identifies an iPad as tablet, which client hints alone cannot do", () => {
    const result = parseClient(headers({ "user-agent": IPAD_UA }));
    expect(result.deviceType).toBe("tablet");
  });
});

describe("parseClient edge cases", () => {
  it("flags a known bot", () => {
    const result = parseClient(headers({ "user-agent": GOOGLEBOT_UA }));
    expect(result.isBot).toBe(true);
    expect(result.deviceType).toBe("bot");
  });

  it("returns unknown when there is no user-agent at all", () => {
    const result = parseClient(headers({}));
    expect(result.deviceType).toBe("unknown");
    expect(result.browser).toBeNull();
  });

  it("takes the first language tag from Accept-Language", () => {
    const result = parseClient(
      headers({ "user-agent": CHROME_UA, "accept-language": "it-IT,it;q=0.9,en;q=0.8" }),
    );
    expect(result.language).toBe("it-IT");
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm test -- test/lib/ua.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/lib/ua.ts`**

```ts
import Bowser from "bowser";
import { isbot } from "isbot";

export interface ClientInfo {
  deviceType: "desktop" | "mobile" | "tablet" | "bot" | "unknown";
  os: string | null;
  osVersion: string | null;
  browser: string | null;
  browserVersion: string | null;
  language: string | null;
  isBot: boolean;
}

const PLACEHOLDER_BRAND = /not[^a-z0-9]*a[^a-z0-9]*brand/i;

interface Brand {
  brand: string;
  version: string;
}

function parseBrandList(header: string): Brand[] {
  const brands: Brand[] = [];
  const pattern = /"([^"]+)"\s*;\s*v\s*=\s*"([^"]+)"/g;
  let match = pattern.exec(header);
  while (match !== null) {
    brands.push({ brand: match[1] as string, version: match[2] as string });
    match = pattern.exec(header);
  }
  return brands;
}

function pickBrand(brands: Brand[]): Brand | null {
  const real = brands.filter((b) => !PLACEHOLDER_BRAND.test(b.brand));
  if (real.length === 0) return null;
  return real.find((b) => b.brand !== "Chromium") ?? (real[0] as Brand);
}

function unquote(value: string): string {
  return value.replace(/^"|"$/g, "");
}

function firstLanguage(header: string | null): string | null {
  if (!header) return null;
  const first = header.split(",")[0]?.split(";")[0]?.trim();
  return first && first.length > 0 ? first : null;
}

export function parseClient(headers: Headers): ClientInfo {
  const ua = headers.get("user-agent");
  const language = firstLanguage(headers.get("accept-language"));

  if (!ua) {
    return {
      deviceType: "unknown",
      os: null,
      osVersion: null,
      browser: null,
      browserVersion: null,
      language,
      isBot: false,
    };
  }

  if (isbot(ua)) {
    return {
      deviceType: "bot",
      os: null,
      osVersion: null,
      browser: null,
      browserVersion: null,
      language,
      isBot: true,
    };
  }

  const parsed = Bowser.parse(ua);
  const platformType = parsed.platform.type;
  let deviceType: ClientInfo["deviceType"] =
    platformType === "mobile" || platformType === "tablet" || platformType === "desktop"
      ? platformType
      : "unknown";

  if (headers.get("sec-ch-ua-mobile") === "?1" && deviceType !== "tablet") {
    deviceType = "mobile";
  }

  const brandHeader = headers.get("sec-ch-ua");
  const brand = brandHeader ? pickBrand(parseBrandList(brandHeader)) : null;
  const platformHint = headers.get("sec-ch-ua-platform");

  return {
    deviceType,
    os: platformHint ? unquote(platformHint) : (parsed.os.name ?? null),
    osVersion: parsed.os.version ?? null,
    browser: brand ? brand.brand : (parsed.browser.name ?? null),
    browserVersion: brand ? brand.version : (parsed.browser.version ?? null),
    language,
    isBot: false,
  };
}
```

Client hints supply browser and platform because they are structured and reliable; device type still comes from the user-agent, since the hints cannot distinguish a tablet from a desktop.

- [ ] **Step 4: Run the test**

Run: `npm test -- test/lib/ua.test.ts`
Expected: PASS. If `Bowser.parse` reports a browser or OS name in different wording than an assertion expects, correct the assertion to what the library actually returns — do not reshape the library output to satisfy a guess.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ua.ts test/lib/ua.test.ts
git commit -m "feat(analytics): detect client from hints with user-agent fallback"
```

---

## Task 7: Referrer extraction and classification

**Files:**
- Create: `src/lib/referrer.ts`
- Test: `test/lib/referrer.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `parseReferrer(raw: string | null): ReferrerInfo` where

```ts
type ReferrerType = "direct" | "search" | "social" | "email" | "ai" | "other";
interface ReferrerInfo {
  host: string | null;
  url: string | null;
  type: ReferrerType;
}
```

- [ ] **Step 1: Write the failing test `test/lib/referrer.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { parseReferrer } from "../../src/lib/referrer";

describe("parseReferrer", () => {
  it("treats a missing referrer as direct", () => {
    expect(parseReferrer(null)).toEqual({ host: null, url: null, type: "direct" });
  });

  it("treats an unparseable referrer as direct", () => {
    expect(parseReferrer("not a url")).toEqual({ host: null, url: null, type: "direct" });
  });

  it("strips the www prefix from the host", () => {
    expect(parseReferrer("https://www.example.com/page").host).toBe("example.com");
  });

  it.each([
    ["https://www.google.com/search?q=x", "search"],
    ["https://duckduckgo.com/?q=x", "search"],
    ["https://www.bing.com/search?q=x", "search"],
    ["https://t.co/abc", "social"],
    ["https://x.com/someone/status/1", "social"],
    ["https://www.linkedin.com/feed/", "social"],
    ["https://www.reddit.com/r/x", "social"],
    ["https://t.me/channel", "social"],
    ["https://mail.google.com/mail/u/0", "email"],
    ["https://outlook.live.com/mail/0", "email"],
    ["https://chatgpt.com/c/abc", "ai"],
    ["https://claude.ai/chat/abc", "ai"],
    ["https://www.perplexity.ai/search", "ai"],
    ["https://someblog.dev/post", "other"],
  ])("classifies %s as %s", (url, expected) => {
    expect(parseReferrer(url).type).toBe(expected);
  });

  it("matches subdomains of a known host", () => {
    expect(parseReferrer("https://news.google.com/foo").type).toBe("search");
  });

  it("keeps the full referrer URL", () => {
    expect(parseReferrer("https://example.com/a?b=1").url).toBe("https://example.com/a?b=1");
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm test -- test/lib/referrer.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/lib/referrer.ts`**

The order of the classification list is load-bearing: `mail.google.com` also matches the `google.com` suffix rule, so `email` must be tested before `search`. The test asserting `mail.google.com` is email and `news.google.com` is search exists to keep that ordering honest.

```ts
export type ReferrerType = "direct" | "search" | "social" | "email" | "ai" | "other";

export interface ReferrerInfo {
  host: string | null;
  url: string | null;
  type: ReferrerType;
}

const CLASSIFICATION: ReadonlyArray<readonly [ReferrerType, readonly string[]]> = [
  [
    "email",
    [
      "mail.google.com",
      "outlook.live.com",
      "outlook.office.com",
      "outlook.office365.com",
      "mail.yahoo.com",
      "mail.proton.me",
    ],
  ],
  [
    "ai",
    [
      "chatgpt.com",
      "chat.openai.com",
      "claude.ai",
      "perplexity.ai",
      "gemini.google.com",
      "copilot.microsoft.com",
    ],
  ],
  [
    "search",
    [
      "google.com",
      "google.it",
      "bing.com",
      "duckduckgo.com",
      "ecosia.org",
      "yandex.com",
      "baidu.com",
      "search.brave.com",
      "startpage.com",
      "qwant.com",
    ],
  ],
  [
    "social",
    [
      "facebook.com",
      "instagram.com",
      "twitter.com",
      "x.com",
      "t.co",
      "linkedin.com",
      "lnkd.in",
      "reddit.com",
      "pinterest.com",
      "tiktok.com",
      "youtube.com",
      "t.me",
      "whatsapp.com",
      "threads.net",
      "bsky.app",
      "mastodon.social",
    ],
  ],
];

function stripWww(hostname: string): string {
  return hostname.replace(/^www\./, "");
}

function matches(host: string, candidate: string): boolean {
  return host === candidate || host.endsWith(`.${candidate}`);
}

export function parseReferrer(raw: string | null): ReferrerInfo {
  if (!raw) {
    return { host: null, url: null, type: "direct" };
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { host: null, url: null, type: "direct" };
  }

  const host = stripWww(parsed.hostname.toLowerCase());

  for (const [type, hosts] of CLASSIFICATION) {
    if (hosts.some((candidate) => matches(host, candidate))) {
      return { host, url: raw, type };
    }
  }

  return { host, url: raw, type: "other" };
}
```

- [ ] **Step 4: Run the test**

Run: `npm test -- test/lib/referrer.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/referrer.ts test/lib/referrer.test.ts
git commit -m "feat(analytics): classify referrers by traffic source"
```

---

## Task 8: Request context — geography, UTM, source

**Files:**
- Create: `src/lib/request-context.ts`
- Test: `test/lib/request-context.test.ts`

**Interfaces:**
- Consumes: `parseClient` (Task 6), `parseReferrer` (Task 7).
- Produces: `buildRequestContext(request: Request): RequestContext` where

```ts
interface GeoInfo {
  continent: string | null;
  country: string | null;
  region: string | null;
  city: string | null;
  timezone: string | null;
  asnOrg: string | null;
  colo: string | null;
}
interface UtmParams {
  source: string | null;
  medium: string | null;
  campaign: string | null;
  term: string | null;
  content: string | null;
}
interface RequestContext {
  ip: string;
  userAgent: string;
  geo: GeoInfo;
  client: ClientInfo;
  referrer: ReferrerInfo;
  utm: UtmParams;
  source: "link" | "qr";
}
```

- [ ] **Step 1: Write the failing test `test/lib/request-context.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { buildRequestContext } from "../../src/lib/request-context";

function request(url: string, init: RequestInit & { cf?: Record<string, unknown> } = {}): Request {
  const { cf, ...rest } = init;
  const req = new Request(url, rest);
  if (cf) {
    Object.defineProperty(req, "cf", { value: cf, configurable: true });
  }
  return req;
}

describe("buildRequestContext", () => {
  it("extracts geography from request.cf", () => {
    const ctx = buildRequestContext(
      request("https://link.test/abc", {
        cf: {
          continent: "EU",
          country: "IT",
          region: "Lombardy",
          city: "Milan",
          timezone: "Europe/Rome",
          asOrganization: "Vodafone Italia",
          colo: "MXP",
        },
      }),
    );
    expect(ctx.geo).toEqual({
      continent: "EU",
      country: "IT",
      region: "Lombardy",
      city: "Milan",
      timezone: "Europe/Rome",
      asnOrg: "Vodafone Italia",
      colo: "MXP",
    });
  });

  it("returns nulls when cf is absent", () => {
    const ctx = buildRequestContext(request("https://link.test/abc"));
    expect(ctx.geo.country).toBeNull();
    expect(ctx.geo.colo).toBeNull();
  });

  it("reads the client IP from CF-Connecting-IP", () => {
    const ctx = buildRequestContext(
      request("https://link.test/abc", { headers: { "cf-connecting-ip": "203.0.113.9" } }),
    );
    expect(ctx.ip).toBe("203.0.113.9");
  });

  it("falls back to an empty string when no IP header is present", () => {
    expect(buildRequestContext(request("https://link.test/abc")).ip).toBe("");
  });

  it("collects all five UTM parameters", () => {
    const ctx = buildRequestContext(
      request(
        "https://link.test/abc?utm_source=newsletter&utm_medium=email&utm_campaign=launch&utm_term=spring&utm_content=header",
      ),
    );
    expect(ctx.utm).toEqual({
      source: "newsletter",
      medium: "email",
      campaign: "launch",
      term: "spring",
      content: "header",
    });
  });

  it("marks a QR scan when s=qr is present", () => {
    expect(buildRequestContext(request("https://link.test/abc?s=qr")).source).toBe("qr");
  });

  it("defaults to a link click", () => {
    expect(buildRequestContext(request("https://link.test/abc")).source).toBe("link");
  });

  it("passes the referrer through the classifier", () => {
    const ctx = buildRequestContext(
      request("https://link.test/abc", { headers: { referer: "https://x.com/post/1" } }),
    );
    expect(ctx.referrer.type).toBe("social");
    expect(ctx.referrer.host).toBe("x.com");
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm test -- test/lib/request-context.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/lib/request-context.ts`**

```ts
import { type ReferrerInfo, parseReferrer } from "./referrer";
import { type ClientInfo, parseClient } from "./ua";

export interface GeoInfo {
  continent: string | null;
  country: string | null;
  region: string | null;
  city: string | null;
  timezone: string | null;
  asnOrg: string | null;
  colo: string | null;
}

export interface UtmParams {
  source: string | null;
  medium: string | null;
  campaign: string | null;
  term: string | null;
  content: string | null;
}

export interface RequestContext {
  ip: string;
  userAgent: string;
  geo: GeoInfo;
  client: ClientInfo;
  referrer: ReferrerInfo;
  utm: UtmParams;
  source: "link" | "qr";
}

function cfString(cf: Record<string, unknown> | undefined, key: string): string | null {
  const value = cf?.[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function buildRequestContext(request: Request): RequestContext {
  const cf = request.cf as unknown as Record<string, unknown> | undefined;
  const params = new URL(request.url).searchParams;

  return {
    ip: request.headers.get("cf-connecting-ip") ?? "",
    userAgent: request.headers.get("user-agent") ?? "",
    geo: {
      continent: cfString(cf, "continent"),
      country: cfString(cf, "country"),
      region: cfString(cf, "region"),
      city: cfString(cf, "city"),
      timezone: cfString(cf, "timezone"),
      asnOrg: cfString(cf, "asOrganization"),
      colo: cfString(cf, "colo"),
    },
    client: parseClient(request.headers),
    referrer: parseReferrer(request.headers.get("referer")),
    utm: {
      source: params.get("utm_source"),
      medium: params.get("utm_medium"),
      campaign: params.get("utm_campaign"),
      term: params.get("utm_term"),
      content: params.get("utm_content"),
    },
    source: params.get("s") === "qr" ? "qr" : "link",
  };
}
```

`ip` and `userAgent` are carried in memory only, as inputs to the visitor hash. Nothing downstream may write them to the database.

- [ ] **Step 4: Run the test**

Run: `npm test -- test/lib/request-context.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/request-context.ts test/lib/request-context.test.ts
git commit -m "feat(analytics): build click context from geography and parameters"
```

---

## Task 9: Link repository

**Files:**
- Create: `src/db/links.ts`
- Test: `test/db/links.test.ts`

**Interfaces:**
- Consumes: `generateSlug` (Task 3).
- Produces:

```ts
interface LinkRow {
  id: number;
  slug: string;
  target_url: string;
  title: string | null;
  description: string | null;
  password_hash: string | null;
  password_salt: string | null;
  expires_at: number | null;
  expired_url: string | null;
  is_active: number;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}
interface CreateLinkInput {
  slug?: string;
  targetUrl: string;
  title?: string | null;
  description?: string | null;
  passwordHash?: string | null;
  passwordSalt?: string | null;
  expiresAt?: number | null;
  expiredUrl?: string | null;
}
interface ListLinksOptions {
  search?: string;
  status?: "all" | "active" | "inactive" | "expired" | "deleted";
  tagId?: number;
  limit?: number;
  offset?: number;
}
```

- `findBySlug(db: D1Database, slug: string): Promise<LinkRow | null>`
- `findById(db: D1Database, id: number): Promise<LinkRow | null>`
- `createLink(db: D1Database, input: CreateLinkInput, now: number): Promise<LinkRow>`
- `updateLink(db: D1Database, id: number, patch: Partial<CreateLinkInput> & { isActive?: boolean }, now: number): Promise<LinkRow | null>`
- `softDeleteLink(db: D1Database, id: number, now: number): Promise<boolean>`
- `restoreLink(db: D1Database, id: number, now: number): Promise<boolean>`
- `listLinks(db: D1Database, options: ListLinksOptions, now: number): Promise<{ items: LinkRow[]; total: number }>`
- `SlugTakenError` — thrown by `createLink` when an explicitly requested slug already exists.

- [ ] **Step 1: Write the failing test `test/db/links.test.ts`**

```ts
import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import {
  SlugTakenError,
  createLink,
  findById,
  findBySlug,
  listLinks,
  restoreLink,
  softDeleteLink,
  updateLink,
} from "../../src/db/links";

const NOW = 1_772_000_000;

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM links").run();
});

describe("createLink", () => {
  it("generates a slug when none is given", async () => {
    const link = await createLink(env.DB, { targetUrl: "https://example.com" }, NOW);
    expect(link.slug).toHaveLength(7);
    expect(link.target_url).toBe("https://example.com");
    expect(link.is_active).toBe(1);
    expect(link.created_at).toBe(NOW);
  });

  it("uses an explicit slug", async () => {
    const link = await createLink(env.DB, { slug: "launch", targetUrl: "https://example.com" }, NOW);
    expect(link.slug).toBe("launch");
  });

  it("throws SlugTakenError when an explicit slug is already used", async () => {
    await createLink(env.DB, { slug: "launch", targetUrl: "https://example.com" }, NOW);
    await expect(
      createLink(env.DB, { slug: "launch", targetUrl: "https://other.com" }, NOW),
    ).rejects.toBeInstanceOf(SlugTakenError);
  });

  it("stores optional fields", async () => {
    const link = await createLink(
      env.DB,
      {
        targetUrl: "https://example.com",
        title: "Launch",
        description: "Spring campaign",
        expiresAt: NOW + 3600,
        expiredUrl: "https://example.com/over",
        passwordHash: "deadbeef",
        passwordSalt: "cafe",
      },
      NOW,
    );
    expect(link.title).toBe("Launch");
    expect(link.expires_at).toBe(NOW + 3600);
    expect(link.expired_url).toBe("https://example.com/over");
    expect(link.password_hash).toBe("deadbeef");
  });
});

describe("findBySlug", () => {
  it("finds a link", async () => {
    await createLink(env.DB, { slug: "found", targetUrl: "https://example.com" }, NOW);
    expect((await findBySlug(env.DB, "found"))?.slug).toBe("found");
  });

  it("returns null for an unknown slug", async () => {
    expect(await findBySlug(env.DB, "nothing")).toBeNull();
  });

  it("still returns soft-deleted links so the caller decides", async () => {
    const link = await createLink(env.DB, { slug: "gone", targetUrl: "https://example.com" }, NOW);
    await softDeleteLink(env.DB, link.id, NOW);
    expect((await findBySlug(env.DB, "gone"))?.deleted_at).toBe(NOW);
  });
});

describe("updateLink", () => {
  it("patches only the given fields and bumps updated_at", async () => {
    const link = await createLink(
      env.DB,
      { slug: "patch", targetUrl: "https://example.com", title: "Before" },
      NOW,
    );
    const updated = await updateLink(
      env.DB,
      link.id,
      { targetUrl: "https://changed.com" },
      NOW + 60,
    );
    expect(updated?.target_url).toBe("https://changed.com");
    expect(updated?.title).toBe("Before");
    expect(updated?.updated_at).toBe(NOW + 60);
  });

  it("toggles active state", async () => {
    const link = await createLink(env.DB, { targetUrl: "https://example.com" }, NOW);
    const updated = await updateLink(env.DB, link.id, { isActive: false }, NOW);
    expect(updated?.is_active).toBe(0);
  });

  it("returns null for an unknown id", async () => {
    expect(await updateLink(env.DB, 9999, { title: "x" }, NOW)).toBeNull();
  });
});

describe("soft delete and restore", () => {
  it("round-trips", async () => {
    const link = await createLink(env.DB, { targetUrl: "https://example.com" }, NOW);
    expect(await softDeleteLink(env.DB, link.id, NOW)).toBe(true);
    expect((await findById(env.DB, link.id))?.deleted_at).toBe(NOW);
    expect(await restoreLink(env.DB, link.id, NOW + 1)).toBe(true);
    expect((await findById(env.DB, link.id))?.deleted_at).toBeNull();
  });
});

describe("listLinks", () => {
  beforeEach(async () => {
    await createLink(env.DB, { slug: "alpha", targetUrl: "https://a.com", title: "Alpha" }, NOW);
    await createLink(env.DB, { slug: "beta", targetUrl: "https://b.com", title: "Beta" }, NOW + 1);
    const gamma = await createLink(env.DB, { slug: "gamma", targetUrl: "https://c.com" }, NOW + 2);
    await updateLink(env.DB, gamma.id, { isActive: false }, NOW + 2);
    const deleted = await createLink(env.DB, { slug: "delta", targetUrl: "https://d.com" }, NOW + 3);
    await softDeleteLink(env.DB, deleted.id, NOW + 3);
  });

  it("excludes deleted links by default and sorts newest first", async () => {
    const { items, total } = await listLinks(env.DB, {}, NOW + 10);
    expect(items.map((l) => l.slug)).toEqual(["gamma", "beta", "alpha"]);
    expect(total).toBe(3);
  });

  it("filters to active links", async () => {
    const { items } = await listLinks(env.DB, { status: "active" }, NOW + 10);
    expect(items.map((l) => l.slug)).toEqual(["beta", "alpha"]);
  });

  it("filters to inactive links", async () => {
    const { items } = await listLinks(env.DB, { status: "inactive" }, NOW + 10);
    expect(items.map((l) => l.slug)).toEqual(["gamma"]);
  });

  it("lists deleted links on request", async () => {
    const { items } = await listLinks(env.DB, { status: "deleted" }, NOW + 10);
    expect(items.map((l) => l.slug)).toEqual(["delta"]);
  });

  it("searches slug and title", async () => {
    expect((await listLinks(env.DB, { search: "alph" }, NOW + 10)).items).toHaveLength(1);
    expect((await listLinks(env.DB, { search: "Beta" }, NOW + 10)).items).toHaveLength(1);
  });

  it("paginates while reporting the full total", async () => {
    const page = await listLinks(env.DB, { limit: 2, offset: 1 }, NOW + 10);
    expect(page.items.map((l) => l.slug)).toEqual(["beta", "alpha"]);
    expect(page.total).toBe(3);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm test -- test/db/links.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/db/links.ts`**

```ts
import { generateSlug } from "../lib/slug";

export interface LinkRow {
  id: number;
  slug: string;
  target_url: string;
  title: string | null;
  description: string | null;
  password_hash: string | null;
  password_salt: string | null;
  expires_at: number | null;
  expired_url: string | null;
  is_active: number;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

export interface CreateLinkInput {
  slug?: string;
  targetUrl: string;
  title?: string | null;
  description?: string | null;
  passwordHash?: string | null;
  passwordSalt?: string | null;
  expiresAt?: number | null;
  expiredUrl?: string | null;
}

export interface ListLinksOptions {
  search?: string;
  status?: "all" | "active" | "inactive" | "expired" | "deleted";
  tagId?: number;
  limit?: number;
  offset?: number;
}

export class SlugTakenError extends Error {
  constructor(slug: string) {
    super(`Slug already in use: ${slug}`);
    this.name = "SlugTakenError";
  }
}

const SELECT = "SELECT * FROM links";
const MAX_SLUG_ATTEMPTS = 5;

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Error && /UNIQUE constraint failed/i.test(error.message);
}

export async function findBySlug(db: D1Database, slug: string): Promise<LinkRow | null> {
  return db.prepare(`${SELECT} WHERE slug = ?`).bind(slug).first<LinkRow>();
}

export async function findById(db: D1Database, id: number): Promise<LinkRow | null> {
  return db.prepare(`${SELECT} WHERE id = ?`).bind(id).first<LinkRow>();
}

async function insert(db: D1Database, slug: string, input: CreateLinkInput, now: number) {
  return db
    .prepare(
      `INSERT INTO links
        (slug, target_url, title, description, password_hash, password_salt,
         expires_at, expired_url, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
       RETURNING *`,
    )
    .bind(
      slug,
      input.targetUrl,
      input.title ?? null,
      input.description ?? null,
      input.passwordHash ?? null,
      input.passwordSalt ?? null,
      input.expiresAt ?? null,
      input.expiredUrl ?? null,
      now,
      now,
    )
    .first<LinkRow>();
}

export async function createLink(
  db: D1Database,
  input: CreateLinkInput,
  now: number,
): Promise<LinkRow> {
  if (input.slug) {
    try {
      const row = await insert(db, input.slug, input, now);
      if (!row) throw new Error("Insert returned no row");
      return row;
    } catch (error) {
      if (isUniqueViolation(error)) throw new SlugTakenError(input.slug);
      throw error;
    }
  }

  for (let attempt = 0; attempt < MAX_SLUG_ATTEMPTS; attempt++) {
    try {
      const row = await insert(db, generateSlug(), input, now);
      if (!row) throw new Error("Insert returned no row");
      return row;
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
    }
  }

  throw new Error("Could not allocate a free slug after repeated attempts");
}

export async function updateLink(
  db: D1Database,
  id: number,
  patch: Partial<CreateLinkInput> & { isActive?: boolean },
  now: number,
): Promise<LinkRow | null> {
  const assignments: string[] = [];
  const values: (string | number | null)[] = [];

  const columns: ReadonlyArray<[keyof typeof patch, string]> = [
    ["targetUrl", "target_url"],
    ["title", "title"],
    ["description", "description"],
    ["passwordHash", "password_hash"],
    ["passwordSalt", "password_salt"],
    ["expiresAt", "expires_at"],
    ["expiredUrl", "expired_url"],
    ["slug", "slug"],
  ];

  for (const [key, column] of columns) {
    if (patch[key] !== undefined) {
      assignments.push(`${column} = ?`);
      values.push(patch[key] as string | number | null);
    }
  }

  if (patch.isActive !== undefined) {
    assignments.push("is_active = ?");
    values.push(patch.isActive ? 1 : 0);
  }

  if (assignments.length === 0) {
    return findById(db, id);
  }

  assignments.push("updated_at = ?");
  values.push(now, id);

  try {
    return await db
      .prepare(`UPDATE links SET ${assignments.join(", ")} WHERE id = ? RETURNING *`)
      .bind(...values)
      .first<LinkRow>();
  } catch (error) {
    if (isUniqueViolation(error) && patch.slug) throw new SlugTakenError(patch.slug);
    throw error;
  }
}

export async function softDeleteLink(db: D1Database, id: number, now: number): Promise<boolean> {
  const result = await db
    .prepare("UPDATE links SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL")
    .bind(now, now, id)
    .run();
  return (result.meta.changes ?? 0) > 0;
}

export async function restoreLink(db: D1Database, id: number, now: number): Promise<boolean> {
  const result = await db
    .prepare(
      "UPDATE links SET deleted_at = NULL, updated_at = ? WHERE id = ? AND deleted_at IS NOT NULL",
    )
    .bind(now, id)
    .run();
  return (result.meta.changes ?? 0) > 0;
}

export async function listLinks(
  db: D1Database,
  options: ListLinksOptions,
  now: number,
): Promise<{ items: LinkRow[]; total: number }> {
  const where: string[] = [];
  const values: (string | number)[] = [];
  const status = options.status ?? "all";

  if (status === "deleted") {
    where.push("l.deleted_at IS NOT NULL");
  } else {
    where.push("l.deleted_at IS NULL");
  }

  if (status === "active") {
    where.push("l.is_active = 1 AND (l.expires_at IS NULL OR l.expires_at > ?)");
    values.push(now);
  } else if (status === "inactive") {
    where.push("l.is_active = 0");
  } else if (status === "expired") {
    where.push("l.expires_at IS NOT NULL AND l.expires_at <= ?");
    values.push(now);
  }

  if (options.search) {
    where.push("(l.slug LIKE ? OR l.title LIKE ? OR l.target_url LIKE ?)");
    const pattern = `%${options.search}%`;
    values.push(pattern, pattern, pattern);
  }

  const join = options.tagId ? "JOIN link_tags lt ON lt.link_id = l.id" : "";
  if (options.tagId) {
    where.push("lt.tag_id = ?");
    values.push(options.tagId);
  }

  const clause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";

  const totalRow = await db
    .prepare(`SELECT COUNT(*) AS total FROM links l ${join} ${clause}`)
    .bind(...values)
    .first<{ total: number }>();

  const limit = options.limit ?? 50;
  const offset = options.offset ?? 0;

  const { results } = await db
    .prepare(`SELECT l.* FROM links l ${join} ${clause} ORDER BY l.created_at DESC LIMIT ? OFFSET ?`)
    .bind(...values, limit, offset)
    .all<LinkRow>();

  return { items: results, total: totalRow?.total ?? 0 };
}
```

- [ ] **Step 4: Run the test**

Run: `npm test -- test/db/links.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/db/links.ts test/db/links.test.ts
git commit -m "feat(db): add link repository with soft delete and filtering"
```

---

## Task 10: Click storage and the ingestion boundary

**Files:**
- Create: `src/db/clicks.ts`, `src/ingest/record-click.ts`
- Test: `test/ingest/record-click.test.ts`

**Interfaces:**
- Consumes: `RequestContext` (Task 8), `visitorHash` (Task 5), `Env` (Task 1).
- Produces:

```ts
type Outcome = "redirect" | "inactive" | "expired" | "password_required" | "password_failed";
interface ClickInsert {
  linkId: number;
  ts: number;
  visitorHash: string;
  source: "link" | "qr";
  outcome: Outcome;
  isBot: boolean;
  geo: GeoInfo;
  client: ClientInfo;
  referrer: ReferrerInfo;
  utm: UtmParams;
}
```

- `insertClick(db: D1Database, click: ClickInsert): Promise<void>`
- `deleteClicksBefore(db: D1Database, ts: number): Promise<number>`
- `recentClicks(db: D1Database, limit: number): Promise<ClickFeedRow[]>` where `ClickFeedRow = { id: number; link_id: number; slug: string; ts: number; country: string | null; city: string | null; device_type: string | null; browser: string | null; referrer_type: string | null; source: string; outcome: string; is_bot: number }`
- `recordClick(env: Env, params: { linkId: number; slug: string; outcome: Outcome; context: RequestContext; now: number }): Promise<void>` — the single ingestion boundary of spec §2.2. It never throws.

- [ ] **Step 1: Write the failing test `test/ingest/record-click.test.ts`**

```ts
import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { createLink } from "../../src/db/links";
import { recentClicks } from "../../src/db/clicks";
import { buildRequestContext } from "../../src/lib/request-context";
import { recordClick } from "../../src/ingest/record-click";

const NOW = 1_772_000_000;

function contextFor(url: string, headers: Record<string, string> = {}) {
  const req = new Request(url, { headers });
  Object.defineProperty(req, "cf", {
    value: { country: "IT", city: "Milan", continent: "EU", colo: "MXP" },
    configurable: true,
  });
  return buildRequestContext(req);
}

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM clicks").run();
  await env.DB.prepare("DELETE FROM links").run();
});

describe("recordClick", () => {
  it("writes a row carrying geography, client and referrer", async () => {
    const link = await createLink(env.DB, { slug: "abc", targetUrl: "https://example.com" }, NOW);
    await recordClick(env, {
      linkId: link.id,
      slug: "abc",
      outcome: "redirect",
      context: contextFor("https://link.test/abc?utm_source=news", {
        "cf-connecting-ip": "203.0.113.9",
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
        referer: "https://x.com/post/1",
      }),
      now: NOW,
    });

    const row = await env.DB.prepare("SELECT * FROM clicks").first<Record<string, unknown>>();
    expect(row?.country).toBe("IT");
    expect(row?.city).toBe("Milan");
    expect(row?.referrer_type).toBe("social");
    expect(row?.utm_source).toBe("news");
    expect(row?.outcome).toBe("redirect");
    expect(row?.source).toBe("link");
    expect(row?.is_bot).toBe(0);
    expect(row?.link_id).toBe(link.id);
  });

  it("never stores the IP address or the raw user-agent", async () => {
    const link = await createLink(env.DB, { slug: "abc", targetUrl: "https://example.com" }, NOW);
    const ua = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/140.0.0.0 Safari/537.36";
    await recordClick(env, {
      linkId: link.id,
      slug: "abc",
      outcome: "redirect",
      context: contextFor("https://link.test/abc", {
        "cf-connecting-ip": "203.0.113.9",
        "user-agent": ua,
      }),
      now: NOW,
    });

    const row = await env.DB.prepare("SELECT * FROM clicks").first<Record<string, unknown>>();
    const serialised = JSON.stringify(row);
    expect(serialised).not.toContain("203.0.113.9");
    expect(serialised).not.toContain("AppleWebKit");
    expect(row?.visitor_hash).toMatch(/^[0-9a-f]{32}$/);
  });

  it("gives the same visitor the same hash twice on the same day", async () => {
    const link = await createLink(env.DB, { slug: "abc", targetUrl: "https://example.com" }, NOW);
    const context = contextFor("https://link.test/abc", {
      "cf-connecting-ip": "203.0.113.9",
      "user-agent": "UA/1",
    });
    await recordClick(env, { linkId: link.id, slug: "abc", outcome: "redirect", context, now: NOW });
    await recordClick(env, {
      linkId: link.id,
      slug: "abc",
      outcome: "redirect",
      context,
      now: NOW + 120,
    });

    const { results } = await env.DB.prepare("SELECT DISTINCT visitor_hash FROM clicks").all();
    expect(results).toHaveLength(1);
  });

  it("marks a QR scan as such", async () => {
    const link = await createLink(env.DB, { slug: "abc", targetUrl: "https://example.com" }, NOW);
    await recordClick(env, {
      linkId: link.id,
      slug: "abc",
      outcome: "redirect",
      context: contextFor("https://link.test/abc?s=qr"),
      now: NOW,
    });
    const row = await env.DB.prepare("SELECT source FROM clicks").first<{ source: string }>();
    expect(row?.source).toBe("qr");
  });

  it("swallows database errors so a redirect is never affected", async () => {
    await expect(
      recordClick(env, {
        linkId: 999_999,
        slug: "missing",
        outcome: "redirect",
        context: contextFor("https://link.test/missing"),
        now: NOW,
      }),
    ).resolves.toBeUndefined();
  });
});

describe("recentClicks", () => {
  it("returns the newest clicks with their slug", async () => {
    const link = await createLink(env.DB, { slug: "feed", targetUrl: "https://example.com" }, NOW);
    for (let i = 0; i < 3; i++) {
      await recordClick(env, {
        linkId: link.id,
        slug: "feed",
        outcome: "redirect",
        context: contextFor("https://link.test/feed", { "cf-connecting-ip": `1.1.1.${i}` }),
        now: NOW + i,
      });
    }
    const feed = await recentClicks(env.DB, 2);
    expect(feed).toHaveLength(2);
    expect(feed[0]?.ts).toBe(NOW + 2);
    expect(feed[0]?.slug).toBe("feed");
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm test -- test/ingest/record-click.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write `src/db/clicks.ts`**

```ts
import type { GeoInfo, UtmParams } from "../lib/request-context";
import type { ReferrerInfo } from "../lib/referrer";
import type { ClientInfo } from "../lib/ua";

export type Outcome =
  | "redirect"
  | "inactive"
  | "expired"
  | "password_required"
  | "password_failed";

export interface ClickInsert {
  linkId: number;
  ts: number;
  visitorHash: string;
  source: "link" | "qr";
  outcome: Outcome;
  isBot: boolean;
  geo: GeoInfo;
  client: ClientInfo;
  referrer: ReferrerInfo;
  utm: UtmParams;
}

export interface ClickFeedRow {
  id: number;
  link_id: number;
  slug: string;
  ts: number;
  country: string | null;
  city: string | null;
  device_type: string | null;
  browser: string | null;
  referrer_type: string | null;
  source: string;
  outcome: string;
  is_bot: number;
}

export async function insertClick(db: D1Database, click: ClickInsert): Promise<void> {
  await db
    .prepare(
      `INSERT INTO clicks (
        link_id, ts, visitor_hash, source, outcome, is_bot,
        continent, country, region, city, timezone, asn_org, colo,
        device_type, os, os_version, browser, browser_version, language,
        referrer_host, referrer_url, referrer_type,
        utm_source, utm_medium, utm_campaign, utm_term, utm_content
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      click.linkId,
      click.ts,
      click.visitorHash,
      click.source,
      click.outcome,
      click.isBot ? 1 : 0,
      click.geo.continent,
      click.geo.country,
      click.geo.region,
      click.geo.city,
      click.geo.timezone,
      click.geo.asnOrg,
      click.geo.colo,
      click.client.deviceType,
      click.client.os,
      click.client.osVersion,
      click.client.browser,
      click.client.browserVersion,
      click.client.language,
      click.referrer.host,
      click.referrer.url,
      click.referrer.type,
      click.utm.source,
      click.utm.medium,
      click.utm.campaign,
      click.utm.term,
      click.utm.content,
    )
    .run();
}

export async function deleteClicksBefore(db: D1Database, ts: number): Promise<number> {
  const result = await db.prepare("DELETE FROM clicks WHERE ts < ?").bind(ts).run();
  return result.meta.changes ?? 0;
}

export async function recentClicks(db: D1Database, limit: number): Promise<ClickFeedRow[]> {
  const { results } = await db
    .prepare(
      `SELECT c.id, c.link_id, l.slug, c.ts, c.country, c.city, c.device_type,
              c.browser, c.referrer_type, c.source, c.outcome, c.is_bot
       FROM clicks c
       JOIN links l ON l.id = c.link_id
       ORDER BY c.ts DESC, c.id DESC
       LIMIT ?`,
    )
    .bind(limit)
    .all<ClickFeedRow>();
  return results;
}
```

- [ ] **Step 4: Write `src/ingest/record-click.ts`**

```ts
import { type Outcome, insertClick } from "../db/clicks";
import { visitorHash } from "../lib/crypto";
import type { RequestContext } from "../lib/request-context";
import type { Env } from "../types";

export interface RecordClickParams {
  linkId: number;
  slug: string;
  outcome: Outcome;
  context: RequestContext;
  now: number;
}

export async function recordClick(env: Env, params: RecordClickParams): Promise<void> {
  try {
    const hash = await visitorHash(
      env.HASH_SECRET,
      params.context.ip,
      params.context.userAgent,
      params.slug,
      params.now,
    );

    await insertClick(env.DB, {
      linkId: params.linkId,
      ts: params.now,
      visitorHash: hash,
      source: params.context.source,
      outcome: params.outcome,
      isBot: params.context.client.isBot,
      geo: params.context.geo,
      client: params.context.client,
      referrer: params.context.referrer,
      utm: params.context.utm,
    });
  } catch (error) {
    console.error("recordClick failed", error);
  }
}
```

Swallowing the error is deliberate and is the reason the redirect can never be harmed by analytics. It is logged, so a persistent failure is visible in Workers observability rather than silent.

- [ ] **Step 5: Run the test**

Run: `npm test -- test/ingest/record-click.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/db/clicks.ts src/ingest/record-click.ts test/ingest/record-click.test.ts
git commit -m "feat(analytics): add click storage behind a single ingestion boundary"
```

---

## Task 11: The redirect endpoint

**Files:**
- Create: `src/routes/redirect.ts`, `src/auth/link-token.ts`
- Modify: `src/index.ts`
- Test: `test/routes/redirect.test.ts`

**Interfaces:**
- Consumes: `findBySlug` (Task 9), `recordClick` (Task 10), `buildRequestContext` (Task 8), `normaliseSlug` (Task 3), crypto helpers (Task 5).
- Produces:
  - `registerRedirect(app: Hono<{ Bindings: Env }>): void` — mounts `GET /:slug` and `POST /:slug`.
  - `issueLinkToken(secret: string, slug: string, now: number): Promise<string>`
  - `verifyLinkToken(secret: string, slug: string, token: string, now: number): Promise<boolean>`

- [ ] **Step 1: Write the failing test `test/routes/redirect.test.ts`**

```ts
import { SELF, env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { hashPassword, randomSalt } from "../../src/lib/crypto";
import { createLink, updateLink } from "../../src/db/links";

const NOW_SECONDS = () => Math.floor(Date.now() / 1000);

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM clicks").run();
  await env.DB.prepare("DELETE FROM links").run();
});

async function clickRows() {
  const { results } = await env.DB.prepare("SELECT * FROM clicks ORDER BY id").all<
    Record<string, unknown>
  >();
  return results;
}

describe("GET /:slug", () => {
  it("redirects an active link and records the click", async () => {
    await createLink(env.DB, { slug: "go", targetUrl: "https://example.com/dest" }, NOW_SECONDS());

    const res = await SELF.fetch("https://link.test/go", { redirect: "manual" });

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://example.com/dest");

    const rows = await clickRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.outcome).toBe("redirect");
  });

  it("returns 404 for an unknown slug and records nothing", async () => {
    const res = await SELF.fetch("https://link.test/nope", { redirect: "manual" });
    expect(res.status).toBe(404);
    expect(await clickRows()).toHaveLength(0);
  });

  it("returns 404 for a soft-deleted link", async () => {
    const link = await createLink(env.DB, { slug: "gone", targetUrl: "https://e.com" }, NOW_SECONDS());
    await env.DB.prepare("UPDATE links SET deleted_at = ? WHERE id = ?")
      .bind(NOW_SECONDS(), link.id)
      .run();

    const res = await SELF.fetch("https://link.test/gone", { redirect: "manual" });
    expect(res.status).toBe(404);
    expect(await clickRows()).toHaveLength(0);
  });

  it("returns 410 for a deactivated link and records the outcome", async () => {
    const link = await createLink(env.DB, { slug: "off", targetUrl: "https://e.com" }, NOW_SECONDS());
    await updateLink(env.DB, link.id, { isActive: false }, NOW_SECONDS());

    const res = await SELF.fetch("https://link.test/off", { redirect: "manual" });

    expect(res.status).toBe(410);
    expect((await clickRows())[0]?.outcome).toBe("inactive");
  });

  it("redirects an expired link to its fallback URL", async () => {
    await createLink(
      env.DB,
      {
        slug: "old",
        targetUrl: "https://e.com",
        expiresAt: NOW_SECONDS() - 10,
        expiredUrl: "https://e.com/expired",
      },
      NOW_SECONDS(),
    );

    const res = await SELF.fetch("https://link.test/old", { redirect: "manual" });

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://e.com/expired");
    expect((await clickRows())[0]?.outcome).toBe("expired");
  });

  it("returns 410 for an expired link with no fallback", async () => {
    await createLink(
      env.DB,
      { slug: "old2", targetUrl: "https://e.com", expiresAt: NOW_SECONDS() - 10 },
      NOW_SECONDS(),
    );

    const res = await SELF.fetch("https://link.test/old2", { redirect: "manual" });
    expect(res.status).toBe(410);
    expect((await clickRows())[0]?.outcome).toBe("expired");
  });

  it("is case-insensitive on the slug", async () => {
    await createLink(env.DB, { slug: "case", targetUrl: "https://e.com" }, NOW_SECONDS());
    const res = await SELF.fetch("https://link.test/CASE", { redirect: "manual" });
    expect(res.status).toBe(302);
  });

  it("does not shadow the health endpoint", async () => {
    const res = await SELF.fetch("https://link.test/_health");
    expect(res.status).toBe(200);
  });
});

describe("password-protected links", () => {
  async function createProtected(password: string) {
    const salt = randomSalt();
    return createLink(
      env.DB,
      {
        slug: "secret",
        targetUrl: "https://example.com/private",
        passwordSalt: salt,
        passwordHash: await hashPassword(password, salt),
      },
      NOW_SECONDS(),
    );
  }

  it("shows the interstitial instead of redirecting", async () => {
    await createProtected("hunter2");

    const res = await SELF.fetch("https://link.test/secret", { redirect: "manual" });

    expect(res.status).toBe(401);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(await res.text()).toContain("<form");
    expect((await clickRows())[0]?.outcome).toBe("password_required");
  });

  it("rejects a wrong password and records the failure", async () => {
    await createProtected("hunter2");

    const res = await SELF.fetch("https://link.test/secret", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "password=wrong",
      redirect: "manual",
    });

    expect(res.status).toBe(401);
    const rows = await clickRows();
    expect(rows.at(-1)?.outcome).toBe("password_failed");
  });

  it("redirects on the correct password and sets an access cookie", async () => {
    await createProtected("hunter2");

    const res = await SELF.fetch("https://link.test/secret", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "password=hunter2",
      redirect: "manual",
    });

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://example.com/private");
    expect(res.headers.get("set-cookie")).toContain("ml_pw_secret=");
    expect((await clickRows()).at(-1)?.outcome).toBe("redirect");
  });

  it("lets a holder of a valid cookie through without asking again", async () => {
    await createProtected("hunter2");

    const first = await SELF.fetch("https://link.test/secret", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "password=hunter2",
      redirect: "manual",
    });
    const cookie = (first.headers.get("set-cookie") ?? "").split(";")[0] as string;

    const second = await SELF.fetch("https://link.test/secret", {
      headers: { cookie },
      redirect: "manual",
    });

    expect(second.status).toBe(302);
    expect(second.headers.get("location")).toBe("https://example.com/private");
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm test -- test/routes/redirect.test.ts`
Expected: FAIL — no redirect route registered.

- [ ] **Step 3: Write `src/auth/link-token.ts`**

```ts
const encoder = new TextEncoder();
const TTL_SECONDS = 600;

async function sign(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function issueLinkToken(secret: string, slug: string, now: number): Promise<string> {
  const expiry = now + TTL_SECONDS;
  return `${expiry}.${await sign(secret, `${slug}:${expiry}`)}`;
}

export async function verifyLinkToken(
  secret: string,
  slug: string,
  token: string,
  now: number,
): Promise<boolean> {
  const [expiryPart, signature] = token.split(".");
  if (!expiryPart || !signature) return false;

  const expiry = Number.parseInt(expiryPart, 10);
  if (!Number.isFinite(expiry) || expiry <= now) return false;

  const expected = await sign(secret, `${slug}:${expiry}`);
  if (expected.length !== signature.length) return false;

  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return diff === 0;
}
```

- [ ] **Step 4: Write `src/routes/redirect.ts`**

```ts
import type { Hono } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { issueLinkToken, verifyLinkToken } from "../auth/link-token";
import { type LinkRow, findBySlug } from "../db/links";
import { recordClick } from "../ingest/record-click";
import { verifyPassword } from "../lib/crypto";
import { buildRequestContext } from "../lib/request-context";
import { normaliseSlug } from "../lib/slug";
import type { Env } from "../types";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(title)}</title>
<style>
:root { color-scheme: light dark; --bg: #fbfbfd; --fg: #16161a; --muted: #6b6b76; --card: #fff; --border: #e3e3e8; --accent: #4338ca; }
@media (prefers-color-scheme: dark) {
  :root { --bg: #0d0d11; --fg: #f2f2f5; --muted: #9a9aa5; --card: #17171d; --border: #2a2a33; --accent: #a5b4fc; }
}
* { box-sizing: border-box; }
body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px;
  background: var(--bg); color: var(--fg);
  font: 16px/1.55 system-ui, -apple-system, "Segoe UI", sans-serif; }
main { width: 100%; max-width: 26rem; background: var(--card); border: 1px solid var(--border);
  border-radius: 14px; padding: 28px; }
h1 { margin: 0 0 8px; font-size: 1.25rem; }
p { margin: 0 0 20px; color: var(--muted); }
label { display: block; font-weight: 600; margin-bottom: 6px; font-size: .9rem; }
input { width: 100%; padding: 11px 13px; font-size: 1rem; border-radius: 9px;
  border: 1px solid var(--border); background: var(--bg); color: var(--fg); }
input:focus-visible, button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
button { width: 100%; margin-top: 16px; padding: 11px; font-size: 1rem; font-weight: 600;
  border: 0; border-radius: 9px; background: var(--accent); color: #fff; cursor: pointer; }
.error { color: #b91c1c; font-weight: 600; margin: 0 0 14px; }
@media (prefers-color-scheme: dark) { .error { color: #fca5a5; } }
</style>
</head>
<body><main>${body}</main></body>
</html>`;
}

function passwordPage(slug: string, error: boolean): string {
  return page(
    "Password required",
    `<h1>This link is protected</h1>
     <p>Enter the password to continue.</p>
     ${error ? '<p class="error" role="alert">Wrong password. Try again.</p>' : ""}
     <form method="post" action="/${escapeHtml(slug)}">
       <label for="password">Password</label>
       <input id="password" name="password" type="password" autocomplete="current-password"
              autofocus required>
       <button type="submit">Continue</button>
     </form>`,
  );
}

function noticePage(title: string, message: string): string {
  return page(title, `<h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p>`);
}

function isExpired(link: LinkRow, now: number): boolean {
  return link.expires_at !== null && link.expires_at <= now;
}

function cookieName(slug: string): string {
  return `ml_pw_${slug}`;
}

export function registerRedirect(app: Hono<{ Bindings: Env }>): void {
  app.get("/:slug", async (c) => {
    const slug = normaliseSlug(c.req.param("slug"));
    const link = await findBySlug(c.env.DB, slug);

    if (!link || link.deleted_at !== null) {
      return c.text("Not found", 404);
    }

    const now = Math.floor(Date.now() / 1000);
    const context = buildRequestContext(c.req.raw);
    const record = (outcome: Parameters<typeof recordClick>[1]["outcome"]) =>
      c.executionCtx.waitUntil(
        recordClick(c.env, { linkId: link.id, slug, outcome, context, now }),
      );

    if (link.is_active === 0) {
      record("inactive");
      return c.html(noticePage("Link disabled", "This link is no longer active."), 410);
    }

    if (isExpired(link, now)) {
      record("expired");
      return link.expired_url
        ? c.redirect(link.expired_url, 302)
        : c.html(noticePage("Link expired", "This link is no longer available."), 410);
    }

    if (link.password_hash) {
      const token = getCookie(c, cookieName(slug));
      const allowed = token
        ? await verifyLinkToken(c.env.HASH_SECRET, slug, token, now)
        : false;
      if (!allowed) {
        record("password_required");
        return c.html(passwordPage(slug, false), 401);
      }
    }

    record("redirect");
    return c.redirect(link.target_url, 302);
  });

  app.post("/:slug", async (c) => {
    const slug = normaliseSlug(c.req.param("slug"));
    const link = await findBySlug(c.env.DB, slug);

    if (!link || link.deleted_at !== null || !link.password_hash || !link.password_salt) {
      return c.text("Not found", 404);
    }

    const now = Math.floor(Date.now() / 1000);
    const context = buildRequestContext(c.req.raw);
    const body = await c.req.parseBody();
    const submitted = typeof body.password === "string" ? body.password : "";

    const correct = await verifyPassword(submitted, link.password_salt, link.password_hash);

    if (!correct) {
      c.executionCtx.waitUntil(
        recordClick(c.env, { linkId: link.id, slug, outcome: "password_failed", context, now }),
      );
      return c.html(passwordPage(slug, true), 401);
    }

    setCookie(c, cookieName(slug), await issueLinkToken(c.env.HASH_SECRET, slug, now), {
      path: `/${slug}`,
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
      maxAge: 600,
    });

    c.executionCtx.waitUntil(
      recordClick(c.env, { linkId: link.id, slug, outcome: "redirect", context, now }),
    );
    return c.redirect(link.target_url, 302);
  });
}
```

- [ ] **Step 5: Mount it in `src/index.ts`**

The redirect route is registered last so that every fixed path defined before it wins the match.

```ts
import { Hono } from "hono";
import { registerRedirect } from "./routes/redirect";
import type { Env } from "./types";

const app = new Hono<{ Bindings: Env }>();

app.get("/_health", (c) => c.json({ ok: true }));

registerRedirect(app);

export default {
  fetch: app.fetch,
} satisfies ExportedHandler<Env>;
```

- [ ] **Step 6: Run the test**

Run: `npm test -- test/routes/redirect.test.ts`
Expected: PASS.

- [ ] **Step 7: Run the whole suite and the linter**

Run: `npm test && npm run check && npm run typecheck`
Expected: all green.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(redirect): serve short links with expiry, toggle and passwords"
```

---

## Task 12: Admin sessions and login throttling

**Files:**
- Create: `src/db/sessions.ts`, `src/auth/session.ts`, `src/auth/rate-limit.ts`, `src/auth/middleware.ts`
- Test: `test/auth/session.test.ts`, `test/auth/rate-limit.test.ts`

**Interfaces:**
- Consumes: `randomToken`, `sha256Hex`, `ipHash` (Task 5).
- Produces:
  - `SESSION_COOKIE = "__Host-ml_session"`
  - `createSession(db: D1Database, uaSummary: string | null, now: number): Promise<string>` returning the raw token
  - `readSession(db: D1Database, token: string, now: number): Promise<SessionRow | null>` where `SessionRow = { id: string; created_at: number; last_seen_at: number; expires_at: number; ua_summary: string | null }`
  - `destroySession(db: D1Database, token: string): Promise<void>`
  - `destroySessionById(db: D1Database, id: string): Promise<boolean>`
  - `destroyAllSessions(db: D1Database): Promise<void>`
  - `listSessions(db: D1Database, now: number): Promise<SessionRow[]>`
  - `deleteExpiredSessions(db: D1Database, now: number): Promise<number>`
  - `checkLoginAllowed(db: D1Database, key: string, now: number): Promise<{ allowed: boolean; retryAfter: number }>`
  - `registerLoginFailure(db: D1Database, key: string, now: number): Promise<void>`
  - `clearLoginFailures(db: D1Database, key: string): Promise<void>`
  - `deleteStaleLoginAttempts(db: D1Database, now: number): Promise<number>`
  - `requireSession` — a Hono middleware setting `c.set("sessionId", id)`

- [ ] **Step 1: Write the failing test `test/auth/session.test.ts`**

```ts
import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import {
  createSession,
  deleteExpiredSessions,
  destroyAllSessions,
  destroySession,
  listSessions,
  readSession,
} from "../../src/db/sessions";

const NOW = 1_772_000_000;
const THIRTY_DAYS = 30 * 24 * 3600;

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM admin_sessions").run();
});

describe("sessions", () => {
  it("issues a token that is not what gets stored", async () => {
    const token = await createSession(env.DB, "Safari on macOS", NOW);
    expect(token).toMatch(/^[0-9a-f]{64}$/);

    const stored = await env.DB.prepare("SELECT id FROM admin_sessions").first<{ id: string }>();
    expect(stored?.id).not.toBe(token);
  });

  it("reads back a valid session and refreshes last_seen_at", async () => {
    const token = await createSession(env.DB, null, NOW);
    const session = await readSession(env.DB, token, NOW + 100);
    expect(session).not.toBeNull();
    expect(session?.last_seen_at).toBe(NOW + 100);
  });

  it("returns null for an unknown token", async () => {
    expect(await readSession(env.DB, "0".repeat(64), NOW)).toBeNull();
  });

  it("returns null for an expired session", async () => {
    const token = await createSession(env.DB, null, NOW);
    expect(await readSession(env.DB, token, NOW + THIRTY_DAYS + 1)).toBeNull();
  });

  it("destroys a single session", async () => {
    const token = await createSession(env.DB, null, NOW);
    await destroySession(env.DB, token);
    expect(await readSession(env.DB, token, NOW)).toBeNull();
  });

  it("destroys every session at once", async () => {
    await createSession(env.DB, null, NOW);
    await createSession(env.DB, null, NOW);
    await destroyAllSessions(env.DB);
    expect(await listSessions(env.DB, NOW)).toHaveLength(0);
  });

  it("deletes expired sessions in bulk", async () => {
    await createSession(env.DB, null, NOW);
    expect(await deleteExpiredSessions(env.DB, NOW + THIRTY_DAYS + 1)).toBe(1);
  });
});
```

- [ ] **Step 2: Write the failing test `test/auth/rate-limit.test.ts`**

```ts
import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import {
  checkLoginAllowed,
  clearLoginFailures,
  deleteStaleLoginAttempts,
  registerLoginFailure,
} from "../../src/auth/rate-limit";

const NOW = 1_772_000_000;
const KEY = "abcdef0123456789abcdef0123456789";

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM login_attempts").run();
});

describe("login rate limiting", () => {
  it("allows a first attempt", async () => {
    expect((await checkLoginAllowed(env.DB, KEY, NOW)).allowed).toBe(true);
  });

  it("allows up to seven failures then locks on the eighth", async () => {
    for (let i = 0; i < 7; i++) {
      await registerLoginFailure(env.DB, KEY, NOW);
      expect((await checkLoginAllowed(env.DB, KEY, NOW)).allowed).toBe(true);
    }
    await registerLoginFailure(env.DB, KEY, NOW);
    const result = await checkLoginAllowed(env.DB, KEY, NOW);
    expect(result.allowed).toBe(false);
    expect(result.retryAfter).toBeGreaterThan(0);
  });

  it("allows again once the lock has elapsed", async () => {
    for (let i = 0; i < 8; i++) {
      await registerLoginFailure(env.DB, KEY, NOW);
    }
    expect((await checkLoginAllowed(env.DB, KEY, NOW + 901)).allowed).toBe(true);
  });

  it("locks for longer after repeated rounds of failures", async () => {
    for (let i = 0; i < 16; i++) {
      await registerLoginFailure(env.DB, KEY, NOW);
    }
    const result = await checkLoginAllowed(env.DB, KEY, NOW);
    expect(result.retryAfter).toBeGreaterThan(900);
  });

  it("clears the counter on a successful login", async () => {
    for (let i = 0; i < 8; i++) {
      await registerLoginFailure(env.DB, KEY, NOW);
    }
    await clearLoginFailures(env.DB, KEY);
    expect((await checkLoginAllowed(env.DB, KEY, NOW)).allowed).toBe(true);
  });

  it("purges rows whose window and lock have both passed", async () => {
    await registerLoginFailure(env.DB, KEY, NOW);
    expect(await deleteStaleLoginAttempts(env.DB, NOW + 100_000)).toBe(1);
  });

  it("isolates different keys", async () => {
    for (let i = 0; i < 8; i++) {
      await registerLoginFailure(env.DB, KEY, NOW);
    }
    expect((await checkLoginAllowed(env.DB, "f".repeat(32), NOW)).allowed).toBe(true);
  });
});
```

- [ ] **Step 3: Run both to confirm they fail**

Run: `npm test -- test/auth`
Expected: FAIL — modules not found.

- [ ] **Step 4: Write `src/db/sessions.ts`**

```ts
import { randomToken, sha256Hex } from "../lib/crypto";

export interface SessionRow {
  id: string;
  created_at: number;
  last_seen_at: number;
  expires_at: number;
  ua_summary: string | null;
}

const TTL_SECONDS = 30 * 24 * 3600;

export async function createSession(
  db: D1Database,
  uaSummary: string | null,
  now: number,
): Promise<string> {
  const token = randomToken();
  const id = await sha256Hex(token);
  await db
    .prepare(
      `INSERT INTO admin_sessions (id, created_at, last_seen_at, expires_at, ua_summary)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(id, now, now, now + TTL_SECONDS, uaSummary)
    .run();
  return token;
}

export async function readSession(
  db: D1Database,
  token: string,
  now: number,
): Promise<SessionRow | null> {
  const id = await sha256Hex(token);
  const session = await db
    .prepare("SELECT * FROM admin_sessions WHERE id = ? AND expires_at > ?")
    .bind(id, now)
    .first<SessionRow>();

  if (!session) return null;

  await db
    .prepare("UPDATE admin_sessions SET last_seen_at = ? WHERE id = ?")
    .bind(now, id)
    .run();

  return { ...session, last_seen_at: now };
}

export async function destroySession(db: D1Database, token: string): Promise<void> {
  await db.prepare("DELETE FROM admin_sessions WHERE id = ?").bind(await sha256Hex(token)).run();
}

export async function destroySessionById(db: D1Database, id: string): Promise<boolean> {
  const result = await db.prepare("DELETE FROM admin_sessions WHERE id = ?").bind(id).run();
  return (result.meta.changes ?? 0) > 0;
}

export async function destroyAllSessions(db: D1Database): Promise<void> {
  await db.prepare("DELETE FROM admin_sessions").run();
}

export async function listSessions(db: D1Database, now: number): Promise<SessionRow[]> {
  const { results } = await db
    .prepare("SELECT * FROM admin_sessions WHERE expires_at > ? ORDER BY last_seen_at DESC")
    .bind(now)
    .all<SessionRow>();
  return results;
}

export async function deleteExpiredSessions(db: D1Database, now: number): Promise<number> {
  const result = await db.prepare("DELETE FROM admin_sessions WHERE expires_at <= ?").bind(now).run();
  return result.meta.changes ?? 0;
}
```

- [ ] **Step 5: Write `src/auth/rate-limit.ts`**

```ts
const MAX_ATTEMPTS = 8;
const WINDOW_SECONDS = 900;
const LOCK_STEPS = [900, 3600, 86_400];

interface AttemptRow {
  ip_hash: string;
  attempts: number;
  first_attempt_at: number;
  locked_until: number | null;
}

export interface RateLimitResult {
  allowed: boolean;
  retryAfter: number;
}

function lockDuration(attempts: number): number {
  const round = Math.floor(attempts / MAX_ATTEMPTS) - 1;
  const index = Math.min(Math.max(round, 0), LOCK_STEPS.length - 1);
  return LOCK_STEPS[index] as number;
}

export async function checkLoginAllowed(
  db: D1Database,
  key: string,
  now: number,
): Promise<RateLimitResult> {
  const row = await db
    .prepare("SELECT * FROM login_attempts WHERE ip_hash = ?")
    .bind(key)
    .first<AttemptRow>();

  if (!row) return { allowed: true, retryAfter: 0 };

  if (row.locked_until !== null && row.locked_until > now) {
    return { allowed: false, retryAfter: row.locked_until - now };
  }

  return { allowed: true, retryAfter: 0 };
}

export async function registerLoginFailure(
  db: D1Database,
  key: string,
  now: number,
): Promise<void> {
  const row = await db
    .prepare("SELECT * FROM login_attempts WHERE ip_hash = ?")
    .bind(key)
    .first<AttemptRow>();

  if (!row || now - row.first_attempt_at > WINDOW_SECONDS) {
    await db
      .prepare(
        `INSERT INTO login_attempts (ip_hash, attempts, first_attempt_at, locked_until)
         VALUES (?, 1, ?, NULL)
         ON CONFLICT (ip_hash) DO UPDATE
           SET attempts = 1, first_attempt_at = excluded.first_attempt_at, locked_until = NULL`,
      )
      .bind(key, now)
      .run();
    return;
  }

  const attempts = row.attempts + 1;
  const lockedUntil = attempts % MAX_ATTEMPTS === 0 ? now + lockDuration(attempts) : row.locked_until;

  await db
    .prepare("UPDATE login_attempts SET attempts = ?, locked_until = ? WHERE ip_hash = ?")
    .bind(attempts, lockedUntil, key)
    .run();
}

export async function clearLoginFailures(db: D1Database, key: string): Promise<void> {
  await db.prepare("DELETE FROM login_attempts WHERE ip_hash = ?").bind(key).run();
}

export async function deleteStaleLoginAttempts(db: D1Database, now: number): Promise<number> {
  const result = await db
    .prepare(
      `DELETE FROM login_attempts
       WHERE (locked_until IS NULL OR locked_until <= ?)
         AND first_attempt_at < ?`,
    )
    .bind(now, now - WINDOW_SECONDS)
    .run();
  return result.meta.changes ?? 0;
}
```

The window resets on the first failure after 15 quiet minutes, so an honest typo today does not count toward a lockout next week.

- [ ] **Step 6: Write `src/auth/session.ts`**

```ts
export const SESSION_COOKIE = "__Host-ml_session";
export const SESSION_MAX_AGE = 30 * 24 * 3600;

export function summariseUserAgent(browser: string | null, os: string | null): string | null {
  if (!browser && !os) return null;
  if (browser && os) return `${browser} on ${os}`;
  return browser ?? os;
}
```

- [ ] **Step 7: Write `src/auth/middleware.ts`**

```ts
import type { MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import { readSession } from "../db/sessions";
import type { Env } from "../types";
import { SESSION_COOKIE } from "./session";

export type AuthedVariables = { sessionId: string };

export const requireSession: MiddlewareHandler<{
  Bindings: Env;
  Variables: AuthedVariables;
}> = async (c, next) => {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) {
    return c.json({ error: "unauthenticated" }, 401);
  }

  const session = await readSession(c.env.DB, token, Math.floor(Date.now() / 1000));
  if (!session) {
    return c.json({ error: "unauthenticated" }, 401);
  }

  c.set("sessionId", session.id);
  await next();
};
```

- [ ] **Step 8: Run the tests**

Run: `npm test -- test/auth`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/db/sessions.ts src/auth test/auth
git commit -m "feat(auth): add admin sessions and login rate limiting"
```

---

## Task 13: API router, login, and the route-authorization guard

**Files:**
- Create: `src/routes/api/index.ts`, `src/routes/api/auth.ts`
- Modify: `src/index.ts`
- Test: `test/routes/auth.test.ts`, `test/routes/route-guard.test.ts`

**Interfaces:**
- Consumes: session and rate-limit modules (Task 12), `constantTimeEquals`, `ipHash` (Task 5), `parseClient` (Task 6).
- Produces:
  - `createApiRouter(): Hono<{ Bindings: Env; Variables: AuthedVariables }>` mounted at `/api`.
  - `PUBLIC_API_ROUTES: ReadonlySet<string>` — the allowlist of `"METHOD /api/path"` entries that intentionally need no session. The guard test asserts every other API route rejects an anonymous caller.

- [ ] **Step 1: Write the failing test `test/routes/auth.test.ts`**

```ts
import { SELF, env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

const CREDENTIALS = { username: "admin", password: "correct-horse-battery-staple" };

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM admin_sessions").run();
  await env.DB.prepare("DELETE FROM login_attempts").run();
});

async function login(body: unknown, headers: Record<string, string> = {}) {
  return SELF.fetch("https://link.test/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function sessionCookie(res: Response): string {
  return (res.headers.get("set-cookie") ?? "").split(";")[0] as string;
}

describe("POST /api/auth/login", () => {
  it("accepts the configured credentials and sets a hardened cookie", async () => {
    const res = await login(CREDENTIALS);

    expect(res.status).toBe(200);
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("__Host-ml_session=");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Path=/");
    expect(cookie).not.toContain("Domain=");
  });

  it("rejects a wrong password without revealing which field was wrong", async () => {
    const res = await login({ username: "admin", password: "nope" });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "invalid_credentials" });
  });

  it("rejects a wrong username with the same response", async () => {
    const res = await login({ username: "root", password: CREDENTIALS.password });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "invalid_credentials" });
  });

  it("rejects a malformed body with 400", async () => {
    const res = await login({ username: "admin" });
    expect(res.status).toBe(400);
  });

  it("locks out after eight failures and answers 429 with Retry-After", async () => {
    const headers = { "cf-connecting-ip": "198.51.100.7" };
    for (let i = 0; i < 8; i++) {
      await login({ username: "admin", password: "nope" }, headers);
    }
    const res = await login(CREDENTIALS, headers);
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  it("clears the failure counter after a successful login", async () => {
    const headers = { "cf-connecting-ip": "198.51.100.8" };
    for (let i = 0; i < 3; i++) {
      await login({ username: "admin", password: "nope" }, headers);
    }
    await login(CREDENTIALS, headers);
    const { results } = await env.DB.prepare("SELECT * FROM login_attempts").all();
    expect(results).toHaveLength(0);
  });
});

describe("session lifecycle", () => {
  it("reaches an authenticated route with the cookie", async () => {
    const cookie = sessionCookie(await login(CREDENTIALS));
    const res = await SELF.fetch("https://link.test/api/auth/sessions", { headers: { cookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { sessions: unknown[] };
    expect(body.sessions).toHaveLength(1);
  });

  it("logs out and invalidates the cookie", async () => {
    const cookie = sessionCookie(await login(CREDENTIALS));

    const logout = await SELF.fetch("https://link.test/api/auth/logout", {
      method: "POST",
      headers: { cookie },
    });
    expect(logout.status).toBe(200);

    const after = await SELF.fetch("https://link.test/api/auth/sessions", { headers: { cookie } });
    expect(after.status).toBe(401);
  });

  it("revokes every session at once", async () => {
    const first = sessionCookie(await login(CREDENTIALS));
    const second = sessionCookie(await login(CREDENTIALS));

    const res = await SELF.fetch("https://link.test/api/auth/sessions", {
      method: "DELETE",
      headers: { cookie: second },
    });
    expect(res.status).toBe(200);

    const check = await SELF.fetch("https://link.test/api/auth/sessions", {
      headers: { cookie: first },
    });
    expect(check.status).toBe(401);
  });

  it("rejects a forged cookie", async () => {
    const res = await SELF.fetch("https://link.test/api/auth/sessions", {
      headers: { cookie: `__Host-ml_session=${"a".repeat(64)}` },
    });
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: Write the failing test `test/routes/route-guard.test.ts`**

This is the project's replacement for "every authenticated endpoint has a Policy". It walks the registered routes rather than a hand-maintained list, so a new endpoint added outside the session middleware fails the build.

```ts
import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { app } from "../../src/index";
import { PUBLIC_API_ROUTES } from "../../src/routes/api";

function concreteUrl(path: string): string {
  return `https://link.test${path.replace(/:[A-Za-z_]+/g, "1")}`;
}

describe("API authorization coverage", () => {
  const apiRoutes = app.routes.filter(
    (route) => route.path.startsWith("/api") && route.method !== "ALL",
  );

  it("registers API routes at all, so this test cannot pass vacuously", () => {
    expect(apiRoutes.length).toBeGreaterThanOrEqual(5);
  });

  it.each(apiRoutes.map((route) => [route.method, route.path] as const))(
    "%s %s requires a session unless explicitly public",
    async (method, path) => {
      const key = `${method} ${path}`;
      if (PUBLIC_API_ROUTES.has(key)) return;

      const res = await SELF.fetch(concreteUrl(path), {
        method,
        headers: { "content-type": "application/json" },
        body: method === "GET" || method === "HEAD" ? undefined : "{}",
      });

      expect(res.status, `${key} answered ${res.status} to an anonymous caller`).toBe(401);
    },
  );
});
```

- [ ] **Step 3: Run both to confirm they fail**

Run: `npm test -- test/routes/auth.test.ts test/routes/route-guard.test.ts`
Expected: FAIL — no API router exists.

- [ ] **Step 4: Write `src/routes/api/auth.ts`**

```ts
import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { z } from "zod";
import { requireSession } from "../../auth/middleware";
import {
  checkLoginAllowed,
  clearLoginFailures,
  registerLoginFailure,
} from "../../auth/rate-limit";
import { SESSION_COOKIE, SESSION_MAX_AGE, summariseUserAgent } from "../../auth/session";
import {
  createSession,
  destroyAllSessions,
  destroySession,
  destroySessionById,
  listSessions,
} from "../../db/sessions";
import { constantTimeEquals, ipHash } from "../../lib/crypto";
import { parseClient } from "../../lib/ua";
import type { Env } from "../../types";

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

export const publicAuth = new Hono<{ Bindings: Env }>();

publicAuth.post("/auth/login", async (c) => {
  const parsed = loginSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: "invalid_body" }, 400);
  }

  const now = Math.floor(Date.now() / 1000);
  const key = await ipHash(c.env.HASH_SECRET, c.req.header("cf-connecting-ip") ?? "", now);

  const limit = await checkLoginAllowed(c.env.DB, key, now);
  if (!limit.allowed) {
    return c.json({ error: "too_many_attempts" }, 429, {
      "retry-after": String(limit.retryAfter),
    });
  }

  const [userOk, passwordOk] = await Promise.all([
    constantTimeEquals(parsed.data.username, c.env.ADMIN_USER),
    constantTimeEquals(parsed.data.password, c.env.ADMIN_PASSWORD),
  ]);

  if (!userOk || !passwordOk) {
    await registerLoginFailure(c.env.DB, key, now);
    return c.json({ error: "invalid_credentials" }, 401);
  }

  await clearLoginFailures(c.env.DB, key);

  const client = parseClient(c.req.raw.headers);
  const token = await createSession(
    c.env.DB,
    summariseUserAgent(client.browser, client.os),
    now,
  );

  setCookie(c, SESSION_COOKIE, token, {
    path: "/",
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    maxAge: SESSION_MAX_AGE,
  });

  return c.json({ ok: true });
});

export const privateAuth = new Hono<{ Bindings: Env; Variables: { sessionId: string } }>();

privateAuth.use("*", requireSession);

privateAuth.post("/auth/logout", async (c) => {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) {
    await destroySession(c.env.DB, token);
  }
  deleteCookie(c, SESSION_COOKIE, { path: "/", secure: true });
  return c.json({ ok: true });
});

privateAuth.get("/auth/sessions", async (c) => {
  const sessions = await listSessions(c.env.DB, Math.floor(Date.now() / 1000));
  const current = c.get("sessionId");
  return c.json({
    sessions: sessions.map((s) => ({
      id: s.id,
      createdAt: s.created_at,
      lastSeenAt: s.last_seen_at,
      expiresAt: s.expires_at,
      device: s.ua_summary,
      current: s.id === current,
    })),
  });
});

privateAuth.delete("/auth/sessions", async (c) => {
  await destroyAllSessions(c.env.DB);
  deleteCookie(c, SESSION_COOKIE, { path: "/", secure: true });
  return c.json({ ok: true });
});

privateAuth.delete("/auth/sessions/:id", async (c) => {
  const removed = await destroySessionById(c.env.DB, c.req.param("id"));
  return removed ? c.json({ ok: true }) : c.json({ error: "not_found" }, 404);
});
```

Both credential comparisons always run — `Promise.all`, not `&&` — so a wrong username costs the same time as a wrong password.

- [ ] **Step 5: Write `src/routes/api/index.ts`**

```ts
import { Hono } from "hono";
import type { AuthedVariables } from "../../auth/middleware";
import type { Env } from "../../types";
import { privateAuth, publicAuth } from "./auth";

export const PUBLIC_API_ROUTES: ReadonlySet<string> = new Set(["POST /api/auth/login"]);

export function createApiRouter(): Hono<{ Bindings: Env; Variables: AuthedVariables }> {
  const api = new Hono<{ Bindings: Env; Variables: AuthedVariables }>();

  api.route("/", publicAuth);
  api.route("/", privateAuth);

  api.notFound((c) => c.json({ error: "not_found" }, 404));

  return api;
}
```

Public and authenticated routers are separate objects rather than one router with ordered middleware: the separation is what makes the guard test meaningful, since forgetting to mount a route on `privateAuth` is exactly the mistake being tested for.

- [ ] **Step 6: Update `src/index.ts`**

```ts
import { Hono } from "hono";
import { createApiRouter } from "./routes/api";
import { registerRedirect } from "./routes/redirect";
import type { Env } from "./types";

export const app = new Hono<{ Bindings: Env }>();

app.get("/_health", (c) => c.json({ ok: true }));
app.route("/api", createApiRouter());

registerRedirect(app);

export default {
  fetch: app.fetch,
} satisfies ExportedHandler<Env>;
```

The named `app` export is what the guard test walks for `app.routes`. It stays named through the rest of the plan, so no later task has to rewrite the test's import.

- [ ] **Step 7: Run the tests**

Run: `npm test -- test/routes`
Expected: PASS, including every generated case in the guard test.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(auth): add login API with per-route authorization guard"
```

---

## Task 14: Link management API

**Files:**
- Create: `src/routes/api/links.ts`
- Modify: `src/routes/api/index.ts`
- Test: `test/routes/links-api.test.ts`

**Interfaces:**
- Consumes: link repository (Task 9), `validateTargetUrl` (Task 4), slug helpers (Task 3), password hashing (Task 5).
- Produces: routes `GET /api/links`, `POST /api/links`, `GET /api/links/:id`, `PATCH /api/links/:id`, `DELETE /api/links/:id`, `POST /api/links/:id/restore`, `GET /api/links/:id/qr.svg`, and the serialiser `serialiseLink(link: LinkRow, shortDomain: string)` returning

```ts
{
  id: number; slug: string; shortUrl: string; targetUrl: string;
  title: string | null; description: string | null;
  hasPassword: boolean; expiresAt: number | null; expiredUrl: string | null;
  isActive: boolean; createdAt: number; updatedAt: number; deletedAt: number | null;
}
```

- [ ] **Step 1: Write the failing test `test/routes/links-api.test.ts`**

```ts
import { SELF, env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

const CREDENTIALS = { username: "admin", password: "correct-horse-battery-staple" };
let cookie = "";

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM clicks").run();
  await env.DB.prepare("DELETE FROM links").run();
  await env.DB.prepare("DELETE FROM admin_sessions").run();

  const res = await SELF.fetch("https://link.test/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(CREDENTIALS),
  });
  cookie = (res.headers.get("set-cookie") ?? "").split(";")[0] as string;
});

function api(path: string, init: RequestInit = {}) {
  return SELF.fetch(`https://link.test${path}`, {
    ...init,
    headers: { "content-type": "application/json", cookie, ...(init.headers ?? {}) },
  });
}

describe("POST /api/links", () => {
  it("creates a link and returns its short URL", async () => {
    const res = await api("/api/links", {
      method: "POST",
      body: JSON.stringify({ targetUrl: "https://example.com", title: "Example" }),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as { link: Record<string, unknown> };
    expect(body.link.shortUrl).toBe(`https://link.test/${body.link.slug}`);
    expect(body.link.hasPassword).toBe(false);
  });

  it("accepts a custom slug", async () => {
    const res = await api("/api/links", {
      method: "POST",
      body: JSON.stringify({ targetUrl: "https://example.com", slug: "Launch-2026" }),
    });
    const body = (await res.json()) as { link: { slug: string } };
    expect(body.link.slug).toBe("launch-2026");
  });

  it("rejects a duplicate slug with 409", async () => {
    await api("/api/links", {
      method: "POST",
      body: JSON.stringify({ targetUrl: "https://example.com", slug: "dup" }),
    });
    const res = await api("/api/links", {
      method: "POST",
      body: JSON.stringify({ targetUrl: "https://other.com", slug: "dup" }),
    });
    expect(res.status).toBe(409);
  });

  it("rejects a reserved slug", async () => {
    const res = await api("/api/links", {
      method: "POST",
      body: JSON.stringify({ targetUrl: "https://example.com", slug: "api" }),
    });
    expect(res.status).toBe(422);
    expect((await res.json()) as unknown).toMatchObject({ error: "reserved_slug" });
  });

  it("rejects a malformed slug", async () => {
    const res = await api("/api/links", {
      method: "POST",
      body: JSON.stringify({ targetUrl: "https://example.com", slug: "has space" }),
    });
    expect(res.status).toBe(422);
  });

  it.each([
    ["javascript:alert(1)", "unsupported_protocol"],
    ["https://link.test/loop", "self_reference"],
    ["nonsense", "invalid"],
  ])("rejects the destination %s", async (targetUrl, reason) => {
    const res = await api("/api/links", { method: "POST", body: JSON.stringify({ targetUrl }) });
    expect(res.status).toBe(422);
    expect((await res.json()) as unknown).toMatchObject({ error: reason });
  });

  it("stores a password as a hash and never returns it", async () => {
    const res = await api("/api/links", {
      method: "POST",
      body: JSON.stringify({ targetUrl: "https://example.com", password: "hunter2" }),
    });
    const body = (await res.json()) as { link: { id: number; hasPassword: boolean } };
    expect(body.link.hasPassword).toBe(true);
    expect(JSON.stringify(body)).not.toContain("hunter2");

    const row = await env.DB.prepare("SELECT password_hash FROM links WHERE id = ?")
      .bind(body.link.id)
      .first<{ password_hash: string }>();
    expect(row?.password_hash).not.toBe("hunter2");
  });
});

describe("GET /api/links", () => {
  it("lists links newest first with a total", async () => {
    for (const slug of ["one", "two", "three"]) {
      await api("/api/links", {
        method: "POST",
        body: JSON.stringify({ targetUrl: `https://example.com/${slug}`, slug }),
      });
    }
    const res = await api("/api/links");
    const body = (await res.json()) as { links: { slug: string }[]; total: number };
    expect(body.links.map((l) => l.slug)).toEqual(["three", "two", "one"]);
    expect(body.total).toBe(3);
  });

  it("filters by search term", async () => {
    await api("/api/links", {
      method: "POST",
      body: JSON.stringify({ targetUrl: "https://example.com", slug: "findme" }),
    });
    const res = await api("/api/links?search=findm");
    const body = (await res.json()) as { links: unknown[] };
    expect(body.links).toHaveLength(1);
  });
});

describe("PATCH and DELETE", () => {
  async function createOne() {
    const res = await api("/api/links", {
      method: "POST",
      body: JSON.stringify({ targetUrl: "https://example.com", slug: "editme" }),
    });
    return ((await res.json()) as { link: { id: number } }).link.id;
  }

  it("updates the destination", async () => {
    const id = await createOne();
    const res = await api(`/api/links/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ targetUrl: "https://changed.com" }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()) as unknown).toMatchObject({
      link: { targetUrl: "https://changed.com/" },
    });
  });

  it("deactivates a link", async () => {
    const id = await createOne();
    await api(`/api/links/${id}`, { method: "PATCH", body: JSON.stringify({ isActive: false }) });
    const res = await SELF.fetch("https://link.test/editme", { redirect: "manual" });
    expect(res.status).toBe(410);
  });

  it("removes a password when told to", async () => {
    const created = await api("/api/links", {
      method: "POST",
      body: JSON.stringify({ targetUrl: "https://example.com", password: "hunter2" }),
    });
    const id = ((await created.json()) as { link: { id: number } }).link.id;

    const res = await api(`/api/links/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ password: null }),
    });
    expect((await res.json()) as unknown).toMatchObject({ link: { hasPassword: false } });
  });

  it("soft-deletes and restores", async () => {
    const id = await createOne();

    expect((await api(`/api/links/${id}`, { method: "DELETE" })).status).toBe(200);
    expect((await SELF.fetch("https://link.test/editme", { redirect: "manual" })).status).toBe(404);

    expect((await api(`/api/links/${id}/restore`, { method: "POST" })).status).toBe(200);
    expect((await SELF.fetch("https://link.test/editme", { redirect: "manual" })).status).toBe(302);
  });

  it("returns 404 for an unknown id", async () => {
    expect((await api("/api/links/999999")).status).toBe(404);
  });
});

describe("GET /api/links/:id/qr.svg", () => {
  it("returns an SVG encoding the short URL", async () => {
    const created = await api("/api/links", {
      method: "POST",
      body: JSON.stringify({ targetUrl: "https://example.com", slug: "qrtest" }),
    });
    const id = ((await created.json()) as { link: { id: number } }).link.id;

    const res = await api(`/api/links/${id}/qr.svg`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("image/svg+xml");
    expect(await res.text()).toContain("<svg");
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm test -- test/routes/links-api.test.ts`
Expected: FAIL — no link routes.

- [ ] **Step 3: Write `src/routes/api/links.ts`**

```ts
import { Hono } from "hono";
import qrcode from "qrcode-generator";
import { z } from "zod";
import { requireSession } from "../../auth/middleware";
import {
  type LinkRow,
  SlugTakenError,
  createLink,
  findById,
  listLinks,
  restoreLink,
  softDeleteLink,
  updateLink,
} from "../../db/links";
import { hashPassword, randomSalt } from "../../lib/crypto";
import { isReservedSlug, isValidSlugShape, normaliseSlug } from "../../lib/slug";
import { validateTargetUrl } from "../../lib/url";
import type { Env } from "../../types";

export function serialiseLink(link: LinkRow, shortDomain: string) {
  return {
    id: link.id,
    slug: link.slug,
    shortUrl: `https://${shortDomain}/${link.slug}`,
    targetUrl: link.target_url,
    title: link.title,
    description: link.description,
    hasPassword: link.password_hash !== null,
    expiresAt: link.expires_at,
    expiredUrl: link.expired_url,
    isActive: link.is_active === 1,
    createdAt: link.created_at,
    updatedAt: link.updated_at,
    deletedAt: link.deleted_at,
  };
}

const createSchema = z.object({
  targetUrl: z.string().min(1),
  slug: z.string().optional(),
  title: z.string().max(200).nullish(),
  description: z.string().max(1000).nullish(),
  password: z.string().min(1).max(200).nullish(),
  expiresAt: z.number().int().positive().nullish(),
  expiredUrl: z.string().nullish(),
});

const updateSchema = createSchema.partial().extend({
  isActive: z.boolean().optional(),
});

const listSchema = z.object({
  search: z.string().optional(),
  status: z.enum(["all", "active", "inactive", "expired", "deleted"]).optional(),
  tagId: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export const links = new Hono<{ Bindings: Env; Variables: { sessionId: string } }>();

links.use("*", requireSession);

links.get("/", async (c) => {
  const parsed = listSchema.safeParse(c.req.query());
  if (!parsed.success) return c.json({ error: "invalid_query" }, 400);

  const now = Math.floor(Date.now() / 1000);
  const { items, total } = await listLinks(c.env.DB, parsed.data, now);
  return c.json({
    links: items.map((l) => serialiseLink(l, c.env.SHORT_DOMAIN)),
    total,
  });
});

links.post("/", async (c) => {
  const parsed = createSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid_body" }, 400);

  const input = parsed.data;

  const destination = validateTargetUrl(input.targetUrl, c.env.SHORT_DOMAIN);
  if (!destination.ok) return c.json({ error: destination.error }, 422);

  let slug: string | undefined;
  if (input.slug !== undefined) {
    slug = normaliseSlug(input.slug);
    if (!isValidSlugShape(slug)) return c.json({ error: "invalid_slug" }, 422);
    if (isReservedSlug(slug)) return c.json({ error: "reserved_slug" }, 422);
  }

  let expiredUrl: string | null = null;
  if (input.expiredUrl) {
    const fallback = validateTargetUrl(input.expiredUrl, c.env.SHORT_DOMAIN);
    if (!fallback.ok) return c.json({ error: "invalid_expired_url" }, 422);
    expiredUrl = fallback.url;
  }

  let passwordHash: string | null = null;
  let passwordSalt: string | null = null;
  if (input.password) {
    passwordSalt = randomSalt();
    passwordHash = await hashPassword(input.password, passwordSalt);
  }

  const now = Math.floor(Date.now() / 1000);

  try {
    const link = await createLink(
      c.env.DB,
      {
        slug,
        targetUrl: destination.url,
        title: input.title ?? null,
        description: input.description ?? null,
        expiresAt: input.expiresAt ?? null,
        expiredUrl,
        passwordHash,
        passwordSalt,
      },
      now,
    );
    return c.json({ link: serialiseLink(link, c.env.SHORT_DOMAIN) }, 201);
  } catch (error) {
    if (error instanceof SlugTakenError) return c.json({ error: "slug_taken" }, 409);
    throw error;
  }
});

links.get("/:id", async (c) => {
  const link = await findById(c.env.DB, Number(c.req.param("id")));
  if (!link) return c.json({ error: "not_found" }, 404);
  return c.json({ link: serialiseLink(link, c.env.SHORT_DOMAIN) });
});

links.patch("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const existing = await findById(c.env.DB, id);
  if (!existing) return c.json({ error: "not_found" }, 404);

  const parsed = updateSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid_body" }, 400);

  const input = parsed.data;
  const patch: Parameters<typeof updateLink>[2] = {};

  if (input.targetUrl !== undefined) {
    const destination = validateTargetUrl(input.targetUrl, c.env.SHORT_DOMAIN);
    if (!destination.ok) return c.json({ error: destination.error }, 422);
    patch.targetUrl = destination.url;
  }

  if (input.slug !== undefined) {
    const slug = normaliseSlug(input.slug);
    if (!isValidSlugShape(slug)) return c.json({ error: "invalid_slug" }, 422);
    if (isReservedSlug(slug)) return c.json({ error: "reserved_slug" }, 422);
    patch.slug = slug;
  }

  if (input.expiredUrl !== undefined) {
    if (input.expiredUrl === null) {
      patch.expiredUrl = null;
    } else {
      const fallback = validateTargetUrl(input.expiredUrl, c.env.SHORT_DOMAIN);
      if (!fallback.ok) return c.json({ error: "invalid_expired_url" }, 422);
      patch.expiredUrl = fallback.url;
    }
  }

  if (input.password !== undefined) {
    if (input.password === null) {
      patch.passwordHash = null;
      patch.passwordSalt = null;
    } else {
      const salt = randomSalt();
      patch.passwordSalt = salt;
      patch.passwordHash = await hashPassword(input.password, salt);
    }
  }

  if (input.title !== undefined) patch.title = input.title;
  if (input.description !== undefined) patch.description = input.description;
  if (input.expiresAt !== undefined) patch.expiresAt = input.expiresAt;
  if (input.isActive !== undefined) patch.isActive = input.isActive;

  try {
    const link = await updateLink(c.env.DB, id, patch, Math.floor(Date.now() / 1000));
    if (!link) return c.json({ error: "not_found" }, 404);
    return c.json({ link: serialiseLink(link, c.env.SHORT_DOMAIN) });
  } catch (error) {
    if (error instanceof SlugTakenError) return c.json({ error: "slug_taken" }, 409);
    throw error;
  }
});

links.delete("/:id", async (c) => {
  const removed = await softDeleteLink(
    c.env.DB,
    Number(c.req.param("id")),
    Math.floor(Date.now() / 1000),
  );
  return removed ? c.json({ ok: true }) : c.json({ error: "not_found" }, 404);
});

links.post("/:id/restore", async (c) => {
  const restored = await restoreLink(
    c.env.DB,
    Number(c.req.param("id")),
    Math.floor(Date.now() / 1000),
  );
  return restored ? c.json({ ok: true }) : c.json({ error: "not_found" }, 404);
});

links.get("/:id/qr.svg", async (c) => {
  const link = await findById(c.env.DB, Number(c.req.param("id")));
  if (!link) return c.json({ error: "not_found" }, 404);

  const qr = qrcode(0, "M");
  qr.addData(`https://${c.env.SHORT_DOMAIN}/${link.slug}?s=qr`);
  qr.make();

  return c.body(qr.createSvgTag({ cellSize: 8, margin: 2, scalable: true }), 200, {
    "content-type": "image/svg+xml; charset=utf-8",
    "cache-control": "private, max-age=3600",
  });
});
```

The QR encodes `?s=qr` so scans are counted apart from ordinary clicks, exactly as spec §2.1 states.

- [ ] **Step 4: Mount it in `src/routes/api/index.ts`**

```ts
import { links } from "./links";

// inside createApiRouter, after the auth routers:
api.route("/links", links);
```

- [ ] **Step 5: Run the tests**

Run: `npm test -- test/routes`
Expected: PASS, and the guard test now covers the seven new routes automatically.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(api): add link management endpoints with QR generation"
```

---

## Task 15: Tags

**Files:**
- Create: `src/db/tags.ts`, `src/routes/api/tags.ts`
- Modify: `src/routes/api/index.ts`, `src/routes/api/links.ts`
- Test: `test/routes/tags-api.test.ts`

**Interfaces:**
- Consumes: link repository (Task 9).
- Produces:
  - `listTags(db: D1Database): Promise<TagRow[]>` where `TagRow = { id: number; name: string; color: string }`
  - `createTag(db: D1Database, name: string, color: string): Promise<TagRow>`
  - `deleteTag(db: D1Database, id: number): Promise<boolean>`
  - `setLinkTags(db: D1Database, linkId: number, tagIds: number[]): Promise<void>`
  - `tagsForLinks(db: D1Database, linkIds: number[]): Promise<Map<number, TagRow[]>>`
  - Routes `GET /api/tags`, `POST /api/tags`, `DELETE /api/tags/:id`, `PUT /api/links/:id/tags`

- [ ] **Step 1: Write the failing test `test/routes/tags-api.test.ts`**

```ts
import { SELF, env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

let cookie = "";

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM link_tags").run();
  await env.DB.prepare("DELETE FROM tags").run();
  await env.DB.prepare("DELETE FROM links").run();
  await env.DB.prepare("DELETE FROM admin_sessions").run();

  const res = await SELF.fetch("https://link.test/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "correct-horse-battery-staple" }),
  });
  cookie = (res.headers.get("set-cookie") ?? "").split(";")[0] as string;
});

function api(path: string, init: RequestInit = {}) {
  return SELF.fetch(`https://link.test${path}`, {
    ...init,
    headers: { "content-type": "application/json", cookie, ...(init.headers ?? {}) },
  });
}

async function createLinkViaApi(slug: string): Promise<number> {
  const res = await api("/api/links", {
    method: "POST",
    body: JSON.stringify({ targetUrl: "https://example.com", slug }),
  });
  return ((await res.json()) as { link: { id: number } }).link.id;
}

describe("tags", () => {
  it("creates and lists tags", async () => {
    const created = await api("/api/tags", {
      method: "POST",
      body: JSON.stringify({ name: "campaign", color: "#4338ca" }),
    });
    expect(created.status).toBe(201);

    const list = await api("/api/tags");
    const body = (await list.json()) as { tags: { name: string }[] };
    expect(body.tags.map((t) => t.name)).toEqual(["campaign"]);
  });

  it("rejects a duplicate tag name with 409", async () => {
    await api("/api/tags", {
      method: "POST",
      body: JSON.stringify({ name: "dup", color: "#000000" }),
    });
    const res = await api("/api/tags", {
      method: "POST",
      body: JSON.stringify({ name: "dup", color: "#111111" }),
    });
    expect(res.status).toBe(409);
  });

  it("rejects a colour that is not a hex value", async () => {
    const res = await api("/api/tags", {
      method: "POST",
      body: JSON.stringify({ name: "bad", color: "red" }),
    });
    expect(res.status).toBe(400);
  });

  it("assigns tags to a link and returns them on the link", async () => {
    const linkId = await createLinkViaApi("tagged");
    const tagRes = await api("/api/tags", {
      method: "POST",
      body: JSON.stringify({ name: "spring", color: "#16a34a" }),
    });
    const tagId = ((await tagRes.json()) as { tag: { id: number } }).tag.id;

    const assign = await api(`/api/links/${linkId}/tags`, {
      method: "PUT",
      body: JSON.stringify({ tagIds: [tagId] }),
    });
    expect(assign.status).toBe(200);

    const list = await api("/api/links");
    const body = (await list.json()) as { links: { tags: { name: string }[] }[] };
    expect(body.links[0]?.tags.map((t) => t.name)).toEqual(["spring"]);
  });

  it("replaces the whole tag set on assignment", async () => {
    const linkId = await createLinkViaApi("replace");
    const ids: number[] = [];
    for (const name of ["one", "two"]) {
      const res = await api("/api/tags", {
        method: "POST",
        body: JSON.stringify({ name, color: "#000000" }),
      });
      ids.push(((await res.json()) as { tag: { id: number } }).tag.id);
    }

    await api(`/api/links/${linkId}/tags`, {
      method: "PUT",
      body: JSON.stringify({ tagIds: ids }),
    });
    await api(`/api/links/${linkId}/tags`, {
      method: "PUT",
      body: JSON.stringify({ tagIds: [ids[1]] }),
    });

    const list = await api("/api/links");
    const body = (await list.json()) as { links: { tags: { name: string }[] }[] };
    expect(body.links[0]?.tags.map((t) => t.name)).toEqual(["two"]);
  });

  it("filters the link list by tag", async () => {
    const tagged = await createLinkViaApi("has-tag");
    await createLinkViaApi("no-tag");
    const tagRes = await api("/api/tags", {
      method: "POST",
      body: JSON.stringify({ name: "filter", color: "#000000" }),
    });
    const tagId = ((await tagRes.json()) as { tag: { id: number } }).tag.id;
    await api(`/api/links/${tagged}/tags`, {
      method: "PUT",
      body: JSON.stringify({ tagIds: [tagId] }),
    });

    const list = await api(`/api/links?tagId=${tagId}`);
    const body = (await list.json()) as { links: { slug: string }[] };
    expect(body.links.map((l) => l.slug)).toEqual(["has-tag"]);
  });

  it("deleting a tag detaches it from links without deleting them", async () => {
    const linkId = await createLinkViaApi("keeps");
    const tagRes = await api("/api/tags", {
      method: "POST",
      body: JSON.stringify({ name: "temp", color: "#000000" }),
    });
    const tagId = ((await tagRes.json()) as { tag: { id: number } }).tag.id;
    await api(`/api/links/${linkId}/tags`, {
      method: "PUT",
      body: JSON.stringify({ tagIds: [tagId] }),
    });

    expect((await api(`/api/tags/${tagId}`, { method: "DELETE" })).status).toBe(200);

    const list = await api("/api/links");
    const body = (await list.json()) as { links: { slug: string; tags: unknown[] }[] };
    expect(body.links).toHaveLength(1);
    expect(body.links[0]?.tags).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm test -- test/routes/tags-api.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write `src/db/tags.ts`**

```ts
export interface TagRow {
  id: number;
  name: string;
  color: string;
}

export class TagNameTakenError extends Error {
  constructor(name: string) {
    super(`Tag already exists: ${name}`);
    this.name = "TagNameTakenError";
  }
}

export async function listTags(db: D1Database): Promise<TagRow[]> {
  const { results } = await db.prepare("SELECT * FROM tags ORDER BY name").all<TagRow>();
  return results;
}

export async function createTag(db: D1Database, name: string, color: string): Promise<TagRow> {
  try {
    const row = await db
      .prepare("INSERT INTO tags (name, color) VALUES (?, ?) RETURNING *")
      .bind(name, color)
      .first<TagRow>();
    if (!row) throw new Error("Insert returned no row");
    return row;
  } catch (error) {
    if (error instanceof Error && /UNIQUE constraint failed/i.test(error.message)) {
      throw new TagNameTakenError(name);
    }
    throw error;
  }
}

export async function deleteTag(db: D1Database, id: number): Promise<boolean> {
  const [, removal] = await db.batch([
    db.prepare("DELETE FROM link_tags WHERE tag_id = ?").bind(id),
    db.prepare("DELETE FROM tags WHERE id = ?").bind(id),
  ]);
  return (removal?.meta.changes ?? 0) > 0;
}

export async function setLinkTags(
  db: D1Database,
  linkId: number,
  tagIds: number[],
): Promise<void> {
  const statements = [db.prepare("DELETE FROM link_tags WHERE link_id = ?").bind(linkId)];
  for (const tagId of tagIds) {
    statements.push(
      db
        .prepare("INSERT OR IGNORE INTO link_tags (link_id, tag_id) VALUES (?, ?)")
        .bind(linkId, tagId),
    );
  }
  await db.batch(statements);
}

export async function tagsForLinks(
  db: D1Database,
  linkIds: number[],
): Promise<Map<number, TagRow[]>> {
  const grouped = new Map<number, TagRow[]>();
  if (linkIds.length === 0) return grouped;

  const placeholders = linkIds.map(() => "?").join(", ");
  const { results } = await db
    .prepare(
      `SELECT lt.link_id AS link_id, t.id, t.name, t.color
       FROM link_tags lt
       JOIN tags t ON t.id = lt.tag_id
       WHERE lt.link_id IN (${placeholders})
       ORDER BY t.name`,
    )
    .bind(...linkIds)
    .all<TagRow & { link_id: number }>();

  for (const row of results) {
    const list = grouped.get(row.link_id) ?? [];
    list.push({ id: row.id, name: row.name, color: row.color });
    grouped.set(row.link_id, list);
  }

  return grouped;
}
```

The join rows are deleted explicitly rather than relying on `ON DELETE CASCADE`. The constraint is declared and D1 does enforce foreign keys, but a correctness test should not silently depend on that: the batch makes the behaviour obvious and portable.

- [ ] **Step 4: Write `src/routes/api/tags.ts`**

```ts
import { Hono } from "hono";
import { z } from "zod";
import { requireSession } from "../../auth/middleware";
import { TagNameTakenError, createTag, deleteTag, listTags } from "../../db/tags";
import type { Env } from "../../types";

const tagSchema = z.object({
  name: z.string().min(1).max(40),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
});

export const tags = new Hono<{ Bindings: Env; Variables: { sessionId: string } }>();

tags.use("*", requireSession);

tags.get("/", async (c) => c.json({ tags: await listTags(c.env.DB) }));

tags.post("/", async (c) => {
  const parsed = tagSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid_body" }, 400);

  try {
    const tag = await createTag(c.env.DB, parsed.data.name, parsed.data.color);
    return c.json({ tag }, 201);
  } catch (error) {
    if (error instanceof TagNameTakenError) return c.json({ error: "tag_exists" }, 409);
    throw error;
  }
});

tags.delete("/:id", async (c) => {
  const removed = await deleteTag(c.env.DB, Number(c.req.param("id")));
  return removed ? c.json({ ok: true }) : c.json({ error: "not_found" }, 404);
});
```

- [ ] **Step 5: Add tag assignment and tag hydration to `src/routes/api/links.ts`**

Add these imports and the route, and extend the list handler.

```ts
import { setLinkTags, tagsForLinks } from "../../db/tags";

const assignTagsSchema = z.object({
  tagIds: z.array(z.number().int().positive()).max(20),
});

links.put("/:id/tags", async (c) => {
  const id = Number(c.req.param("id"));
  if (!(await findById(c.env.DB, id))) return c.json({ error: "not_found" }, 404);

  const parsed = assignTagsSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid_body" }, 400);

  await setLinkTags(c.env.DB, id, parsed.data.tagIds);
  return c.json({ ok: true });
});
```

Replace the body of `links.get("/")` so each link carries its tags:

```ts
links.get("/", async (c) => {
  const parsed = listSchema.safeParse(c.req.query());
  if (!parsed.success) return c.json({ error: "invalid_query" }, 400);

  const now = Math.floor(Date.now() / 1000);
  const { items, total } = await listLinks(c.env.DB, parsed.data, now);
  const tagMap = await tagsForLinks(
    c.env.DB,
    items.map((l) => l.id),
  );

  return c.json({
    links: items.map((l) => ({
      ...serialiseLink(l, c.env.SHORT_DOMAIN),
      tags: tagMap.get(l.id) ?? [],
    })),
    total,
  });
});
```

And replace `links.get("/:id")` so a single link carries its tags too:

```ts
links.get("/:id", async (c) => {
  const link = await findById(c.env.DB, Number(c.req.param("id")));
  if (!link) return c.json({ error: "not_found" }, 404);

  const tagMap = await tagsForLinks(c.env.DB, [link.id]);
  return c.json({
    link: { ...serialiseLink(link, c.env.SHORT_DOMAIN), tags: tagMap.get(link.id) ?? [] },
  });
});
```

- [ ] **Step 6: Mount the tag router in `src/routes/api/index.ts`**

```ts
import { tags } from "./tags";

// inside createApiRouter:
api.route("/tags", tags);
```

- [ ] **Step 7: Run the tests**

Run: `npm test -- test/routes`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(api): add tags and link tagging"
```

---

## Task 16: Statistics queries

**Files:**
- Create: `src/db/stats.ts`
- Test: `test/db/stats.test.ts`

**Interfaces:**
- Consumes: schema from Task 2.
- Produces:

```ts
interface StatsRange { from: number; to: number; linkId?: number }
interface Summary { clicks: number; uniques: number; bots: number; countries: number }
interface TimeBucket { bucket: string; clicks: number; uniques: number }
interface DimensionSlice { value: string; clicks: number; uniques: number }
type Granularity = "hour" | "day" | "week";
type DimensionName =
  | "country" | "city" | "device" | "os" | "browser" | "referrer_type"
  | "referrer_host" | "utm_source" | "utm_medium" | "utm_campaign"
  | "language" | "asn_org" | "dow_hour" | "source" | "outcome";
```

- `DIMENSION_COLUMNS: Record<DimensionName, string>` — the SQL expression each dimension aggregates over.
- `summary(db: D1Database, range: StatsRange): Promise<Summary>`
- `timeseries(db: D1Database, range: StatsRange, granularity: Granularity): Promise<TimeBucket[]>`
- `dimension(db: D1Database, range: StatsRange, name: DimensionName, limit: number): Promise<DimensionSlice[]>`
- `sparklines(db: D1Database, days: number, now: number): Promise<Map<number, number[]>>`

- [ ] **Step 1: Write the failing test `test/db/stats.test.ts`**

```ts
import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { createLink } from "../../src/db/links";
import { dimension, sparklines, summary, timeseries } from "../../src/db/stats";

const DAY = 86_400;
const BASE = Date.parse("2026-03-10T00:00:00Z") / 1000;

let linkId = 0;
let otherId = 0;

async function insert(overrides: Record<string, unknown> = {}) {
  const row = {
    link_id: linkId,
    ts: BASE + 3600,
    visitor_hash: "aaaa",
    source: "link",
    outcome: "redirect",
    is_bot: 0,
    country: "IT",
    city: "Milan",
    device_type: "desktop",
    os: "macOS",
    browser: "Chrome",
    referrer_type: "social",
    referrer_host: "x.com",
    language: "it-IT",
    ...overrides,
  };
  await env.DB.prepare(
    `INSERT INTO clicks (link_id, ts, visitor_hash, source, outcome, is_bot, country, city,
       device_type, os, browser, referrer_type, referrer_host, language)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      row.link_id,
      row.ts,
      row.visitor_hash,
      row.source,
      row.outcome,
      row.is_bot,
      row.country,
      row.city,
      row.device_type,
      row.os,
      row.browser,
      row.referrer_type,
      row.referrer_host,
      row.language,
    )
    .run();
}

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM clicks").run();
  await env.DB.prepare("DELETE FROM links").run();
  linkId = (await createLink(env.DB, { slug: "s1", targetUrl: "https://e.com" }, BASE)).id;
  otherId = (await createLink(env.DB, { slug: "s2", targetUrl: "https://e.com" }, BASE)).id;
});

describe("summary", () => {
  it("counts clicks, distinct visitors, bots and countries", async () => {
    await insert({ visitor_hash: "a" });
    await insert({ visitor_hash: "a" });
    await insert({ visitor_hash: "b", country: "FR" });
    await insert({ visitor_hash: "c", is_bot: 1 });

    const result = await summary(env.DB, { from: BASE, to: BASE + DAY });

    expect(result.clicks).toBe(3);
    expect(result.uniques).toBe(2);
    expect(result.bots).toBe(1);
    expect(result.countries).toBe(2);
  });

  it("excludes bots from clicks and uniques but reports them separately", async () => {
    await insert({ visitor_hash: "bot", is_bot: 1 });
    const result = await summary(env.DB, { from: BASE, to: BASE + DAY });
    expect(result.clicks).toBe(0);
    expect(result.bots).toBe(1);
  });

  it("respects the range boundaries", async () => {
    await insert({ ts: BASE - 1 });
    await insert({ ts: BASE + DAY });
    const result = await summary(env.DB, { from: BASE, to: BASE + DAY });
    expect(result.clicks).toBe(0);
  });

  it("scopes to a single link when asked", async () => {
    await insert({ link_id: linkId });
    await insert({ link_id: otherId, visitor_hash: "z" });
    const result = await summary(env.DB, { from: BASE, to: BASE + DAY, linkId });
    expect(result.clicks).toBe(1);
  });
});

describe("timeseries", () => {
  it("buckets by hour", async () => {
    await insert({ ts: BASE + 3600 });
    await insert({ ts: BASE + 3700, visitor_hash: "b" });
    await insert({ ts: BASE + 7300, visitor_hash: "c" });

    const buckets = await timeseries(env.DB, { from: BASE, to: BASE + DAY }, "hour");

    expect(buckets).toHaveLength(2);
    expect(buckets[0]?.clicks).toBe(2);
    expect(buckets[1]?.clicks).toBe(1);
  });

  it("buckets by day", async () => {
    await insert({ ts: BASE + 3600 });
    await insert({ ts: BASE + DAY + 3600, visitor_hash: "b" });

    const buckets = await timeseries(env.DB, { from: BASE, to: BASE + 3 * DAY }, "day");

    expect(buckets.map((b) => b.bucket)).toEqual(["2026-03-10", "2026-03-11"]);
  });

  it("buckets by week starting on Monday", async () => {
    await insert({ ts: BASE + 3600 });
    await insert({ ts: BASE + 7 * DAY, visitor_hash: "b" });

    const buckets = await timeseries(env.DB, { from: BASE, to: BASE + 14 * DAY }, "week");

    expect(buckets).toHaveLength(2);
    expect(buckets[0]?.bucket).toBe("2026-03-09");
  });

  it("returns buckets in chronological order", async () => {
    await insert({ ts: BASE + 2 * DAY });
    await insert({ ts: BASE, visitor_hash: "b" });
    const buckets = await timeseries(env.DB, { from: BASE, to: BASE + 3 * DAY }, "day");
    expect(buckets[0]?.bucket).toBe("2026-03-10");
  });
});

describe("dimension", () => {
  it("ranks values by clicks", async () => {
    await insert({ country: "IT", visitor_hash: "a" });
    await insert({ country: "IT", visitor_hash: "b" });
    await insert({ country: "FR", visitor_hash: "c" });

    const slices = await dimension(env.DB, { from: BASE, to: BASE + DAY }, "country", 10);

    expect(slices[0]).toEqual({ value: "IT", clicks: 2, uniques: 2 });
    expect(slices[1]?.value).toBe("FR");
  });

  it("labels missing values as unknown rather than dropping them", async () => {
    await insert({ country: null });
    const slices = await dimension(env.DB, { from: BASE, to: BASE + DAY }, "country", 10);
    expect(slices[0]?.value).toBe("unknown");
  });

  it("honours the limit", async () => {
    for (const country of ["A", "B", "C", "D"]) {
      await insert({ country, visitor_hash: country });
    }
    const slices = await dimension(env.DB, { from: BASE, to: BASE + DAY }, "country", 2);
    expect(slices).toHaveLength(2);
  });

  it("produces weekday-hour keys for the heatmap", async () => {
    await insert({ ts: BASE + 3600 });
    const slices = await dimension(env.DB, { from: BASE, to: BASE + DAY }, "dow_hour", 10);
    expect(slices[0]?.value).toMatch(/^[0-6]-\d{2}$/);
  });

  it("counts outcomes including failures, which bots do not pollute", async () => {
    await insert({ outcome: "password_failed", visitor_hash: "a" });
    await insert({ outcome: "redirect", visitor_hash: "b" });
    const slices = await dimension(env.DB, { from: BASE, to: BASE + DAY }, "outcome", 10);
    expect(slices.map((s) => s.value).sort()).toEqual(["password_failed", "redirect"]);
  });
});

describe("sparklines", () => {
  it("returns one bucket per day per link, zero-filled", async () => {
    await insert({ ts: BASE + 3600 });
    const map = await sparklines(env.DB, 7, BASE + DAY);
    const series = map.get(linkId);
    expect(series).toHaveLength(7);
    expect(series?.reduce((a, b) => a + b, 0)).toBe(1);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm test -- test/db/stats.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/db/stats.ts`**

```ts
export interface StatsRange {
  from: number;
  to: number;
  linkId?: number;
}

export interface Summary {
  clicks: number;
  uniques: number;
  bots: number;
  countries: number;
}

export interface TimeBucket {
  bucket: string;
  clicks: number;
  uniques: number;
}

export interface DimensionSlice {
  value: string;
  clicks: number;
  uniques: number;
}

export type Granularity = "hour" | "day" | "week";

export type DimensionName =
  | "country"
  | "city"
  | "device"
  | "os"
  | "browser"
  | "referrer_type"
  | "referrer_host"
  | "utm_source"
  | "utm_medium"
  | "utm_campaign"
  | "language"
  | "asn_org"
  | "dow_hour"
  | "source"
  | "outcome";

export const DIMENSION_COLUMNS: Record<DimensionName, string> = {
  country: "country",
  city: "city",
  device: "device_type",
  os: "os",
  browser: "browser",
  referrer_type: "referrer_type",
  referrer_host: "referrer_host",
  utm_source: "utm_source",
  utm_medium: "utm_medium",
  utm_campaign: "utm_campaign",
  language: "language",
  asn_org: "asn_org",
  source: "source",
  outcome: "outcome",
  dow_hour: "strftime('%w', ts, 'unixepoch') || '-' || strftime('%H', ts, 'unixepoch')",
};

const BUCKET_EXPRESSIONS: Record<Granularity, string> = {
  hour: "strftime('%Y-%m-%dT%H:00', ts, 'unixepoch')",
  day: "date(ts, 'unixepoch')",
  week: "date(ts, 'unixepoch', '-' || ((strftime('%w', ts, 'unixepoch') + 6) % 7) || ' days')",
};

function scope(range: StatsRange): { clause: string; values: number[] } {
  const values: number[] = [range.from, range.to];
  let clause = "ts >= ? AND ts < ?";
  if (range.linkId !== undefined) {
    clause += " AND link_id = ?";
    values.push(range.linkId);
  }
  return { clause, values };
}

export async function summary(db: D1Database, range: StatsRange): Promise<Summary> {
  const { clause, values } = scope(range);

  const row = await db
    .prepare(
      `SELECT
         SUM(CASE WHEN is_bot = 0 THEN 1 ELSE 0 END) AS clicks,
         COUNT(DISTINCT CASE WHEN is_bot = 0 THEN visitor_hash END) AS uniques,
         SUM(is_bot) AS bots,
         COUNT(DISTINCT CASE WHEN is_bot = 0 THEN country END) AS countries
       FROM clicks WHERE ${clause}`,
    )
    .bind(...values)
    .first<{
      clicks: number | null;
      uniques: number | null;
      bots: number | null;
      countries: number | null;
    }>();

  return {
    clicks: row?.clicks ?? 0,
    uniques: row?.uniques ?? 0,
    bots: row?.bots ?? 0,
    countries: row?.countries ?? 0,
  };
}

export async function timeseries(
  db: D1Database,
  range: StatsRange,
  granularity: Granularity,
): Promise<TimeBucket[]> {
  const { clause, values } = scope(range);
  const bucket = BUCKET_EXPRESSIONS[granularity];

  const { results } = await db
    .prepare(
      `SELECT ${bucket} AS bucket,
              COUNT(*) AS clicks,
              COUNT(DISTINCT visitor_hash) AS uniques
       FROM clicks
       WHERE ${clause} AND is_bot = 0
       GROUP BY bucket
       ORDER BY bucket`,
    )
    .bind(...values)
    .all<TimeBucket>();

  return results;
}

export async function dimension(
  db: D1Database,
  range: StatsRange,
  name: DimensionName,
  limit: number,
): Promise<DimensionSlice[]> {
  const column = DIMENSION_COLUMNS[name];
  const { clause, values } = scope(range);

  const { results } = await db
    .prepare(
      `SELECT COALESCE(NULLIF(${column}, ''), 'unknown') AS value,
              COUNT(*) AS clicks,
              COUNT(DISTINCT visitor_hash) AS uniques
       FROM clicks
       WHERE ${clause} AND is_bot = 0
       GROUP BY value
       ORDER BY clicks DESC, value ASC
       LIMIT ?`,
    )
    .bind(...values, limit)
    .all<DimensionSlice>();

  return results;
}

export async function sparklines(
  db: D1Database,
  days: number,
  now: number,
): Promise<Map<number, number[]>> {
  const from = now - days * 86_400;

  const { results } = await db
    .prepare(
      `SELECT link_id, date(ts, 'unixepoch') AS day, COUNT(*) AS clicks
       FROM clicks
       WHERE ts >= ? AND is_bot = 0
       GROUP BY link_id, day`,
    )
    .bind(from)
    .all<{ link_id: number; day: string; clicks: number }>();

  const dayKeys: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    dayKeys.push(new Date((now - i * 86_400) * 1000).toISOString().slice(0, 10));
  }

  const series = new Map<number, number[]>();
  for (const row of results) {
    const bucket = series.get(row.link_id) ?? new Array<number>(days).fill(0);
    const index = dayKeys.indexOf(row.day);
    if (index >= 0) bucket[index] = row.clicks;
    series.set(row.link_id, bucket);
  }

  return series;
}
```

`DIMENSION_COLUMNS` is a fixed lookup, never a caller-supplied string, so the dimension name can never reach SQL as raw text.

Bots are excluded from every human-facing figure and reported only as their own count, which is why the `outcome` breakdown is not skewed by crawlers hitting a password page.

- [ ] **Step 4: Run the test**

Run: `npm test -- test/db/stats.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/db/stats.ts test/db/stats.test.ts
git commit -m "feat(stats): add aggregate queries for summary, series and dimensions"
```

---

## Task 17: Statistics API

**Files:**
- Create: `src/routes/api/stats.ts`
- Modify: `src/routes/api/index.ts`
- Test: `test/routes/stats-api.test.ts`

**Interfaces:**
- Consumes: `src/db/stats.ts` (Task 16), `recentClicks` (Task 10).
- Produces: `GET /api/stats/summary`, `GET /api/stats/timeseries`, `GET /api/stats/dimension`, `GET /api/stats/live`, `GET /api/stats/sparklines`. Every endpoint accepts `from`, `to` (unix seconds) and optional `linkId`; `summary` additionally returns a `previous` block covering the immediately preceding window of equal length, which is what the dashboard's delta indicators consume.

- [ ] **Step 1: Write the failing test `test/routes/stats-api.test.ts`**

```ts
import { SELF, env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { createLink } from "../../src/db/links";

const DAY = 86_400;
const BASE = Date.parse("2026-03-10T00:00:00Z") / 1000;
let cookie = "";
let linkId = 0;

async function insertClick(ts: number, overrides: Record<string, unknown> = {}) {
  const row = { visitor_hash: `v${ts}`, country: "IT", is_bot: 0, ...overrides };
  await env.DB.prepare(
    `INSERT INTO clicks (link_id, ts, visitor_hash, source, outcome, is_bot, country)
     VALUES (?, ?, ?, 'link', 'redirect', ?, ?)`,
  )
    .bind(linkId, ts, row.visitor_hash, row.is_bot, row.country)
    .run();
}

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM clicks").run();
  await env.DB.prepare("DELETE FROM links").run();
  await env.DB.prepare("DELETE FROM admin_sessions").run();

  linkId = (await createLink(env.DB, { slug: "stats", targetUrl: "https://e.com" }, BASE)).id;

  const res = await SELF.fetch("https://link.test/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "correct-horse-battery-staple" }),
  });
  cookie = (res.headers.get("set-cookie") ?? "").split(";")[0] as string;
});

function api(path: string) {
  return SELF.fetch(`https://link.test${path}`, { headers: { cookie } });
}

describe("GET /api/stats/summary", () => {
  it("returns the current window and the preceding one", async () => {
    await insertClick(BASE + 100);
    await insertClick(BASE + 200);
    await insertClick(BASE - DAY + 100);

    const res = await api(`/api/stats/summary?from=${BASE}&to=${BASE + DAY}`);
    const body = (await res.json()) as {
      current: { clicks: number };
      previous: { clicks: number };
    };

    expect(body.current.clicks).toBe(2);
    expect(body.previous.clicks).toBe(1);
  });

  it("rejects a range where from is after to", async () => {
    const res = await api(`/api/stats/summary?from=${BASE + DAY}&to=${BASE}`);
    expect(res.status).toBe(400);
  });

  it("rejects a missing range", async () => {
    expect((await api("/api/stats/summary")).status).toBe(400);
  });
});

describe("GET /api/stats/timeseries", () => {
  it("returns buckets at the requested granularity", async () => {
    await insertClick(BASE + 100);
    await insertClick(BASE + 4000);

    const res = await api(`/api/stats/timeseries?from=${BASE}&to=${BASE + DAY}&granularity=hour`);
    const body = (await res.json()) as { buckets: unknown[] };
    expect(body.buckets).toHaveLength(2);
  });

  it("rejects an unknown granularity", async () => {
    const res = await api(`/api/stats/timeseries?from=${BASE}&to=${BASE + DAY}&granularity=eon`);
    expect(res.status).toBe(400);
  });
});

describe("GET /api/stats/dimension", () => {
  it("returns a ranked breakdown", async () => {
    await insertClick(BASE + 1, { country: "IT" });
    await insertClick(BASE + 2, { country: "IT" });
    await insertClick(BASE + 3, { country: "FR" });

    const res = await api(`/api/stats/dimension?name=country&from=${BASE}&to=${BASE + DAY}`);
    const body = (await res.json()) as { slices: { value: string; clicks: number }[] };
    expect(body.slices[0]).toMatchObject({ value: "IT", clicks: 2 });
  });

  it("rejects an unknown dimension name rather than interpolating it", async () => {
    const res = await api(
      `/api/stats/dimension?name=${encodeURIComponent("country; DROP TABLE links")}&from=${BASE}&to=${BASE + DAY}`,
    );
    expect(res.status).toBe(400);

    const tables = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='links'",
    ).first();
    expect(tables).not.toBeNull();
  });
});

describe("GET /api/stats/live", () => {
  it("returns the most recent clicks with their slug", async () => {
    await insertClick(BASE + 1);
    await insertClick(BASE + 2);

    const res = await api("/api/stats/live?limit=10");
    const body = (await res.json()) as { clicks: { slug: string; ts: number }[] };
    expect(body.clicks[0]?.slug).toBe("stats");
    expect(body.clicks[0]?.ts).toBe(BASE + 2);
  });

  it("caps the limit", async () => {
    const res = await api("/api/stats/live?limit=99999");
    expect(res.status).toBe(400);
  });
});

describe("GET /api/stats/sparklines", () => {
  it("returns one series per link", async () => {
    await insertClick(Math.floor(Date.now() / 1000) - 3600);
    const res = await api("/api/stats/sparklines?days=7");
    const body = (await res.json()) as { series: Record<string, number[]> };
    expect(body.series[String(linkId)]).toHaveLength(7);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm test -- test/routes/stats-api.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write `src/routes/api/stats.ts`**

```ts
import { Hono } from "hono";
import { z } from "zod";
import { requireSession } from "../../auth/middleware";
import { recentClicks } from "../../db/clicks";
import {
  DIMENSION_COLUMNS,
  type DimensionName,
  type Granularity,
  dimension,
  sparklines,
  summary,
  timeseries,
} from "../../db/stats";
import type { Env } from "../../types";

const rangeSchema = z
  .object({
    from: z.coerce.number().int().nonnegative(),
    to: z.coerce.number().int().positive(),
    linkId: z.coerce.number().int().positive().optional(),
  })
  .refine((value) => value.from < value.to, { message: "from must be before to" });

const dimensionNames = Object.keys(DIMENSION_COLUMNS) as [DimensionName, ...DimensionName[]];

export const stats = new Hono<{ Bindings: Env; Variables: { sessionId: string } }>();

stats.use("*", requireSession);

stats.get("/summary", async (c) => {
  const parsed = rangeSchema.safeParse(c.req.query());
  if (!parsed.success) return c.json({ error: "invalid_range" }, 400);

  const { from, to, linkId } = parsed.data;
  const span = to - from;

  const [current, previous] = await Promise.all([
    summary(c.env.DB, { from, to, linkId }),
    summary(c.env.DB, { from: from - span, to: from, linkId }),
  ]);

  return c.json({ current, previous, range: { from, to } });
});

stats.get("/timeseries", async (c) => {
  const parsed = rangeSchema.safeParse(c.req.query());
  if (!parsed.success) return c.json({ error: "invalid_range" }, 400);

  const granularity = c.req.query("granularity") ?? "day";
  if (!["hour", "day", "week"].includes(granularity)) {
    return c.json({ error: "invalid_granularity" }, 400);
  }

  const buckets = await timeseries(c.env.DB, parsed.data, granularity as Granularity);
  return c.json({ buckets, granularity });
});

stats.get("/dimension", async (c) => {
  const parsed = rangeSchema.safeParse(c.req.query());
  if (!parsed.success) return c.json({ error: "invalid_range" }, 400);

  const name = z.enum(dimensionNames).safeParse(c.req.query("name"));
  if (!name.success) return c.json({ error: "invalid_dimension" }, 400);

  const limit = z.coerce.number().int().min(1).max(100).safeParse(c.req.query("limit") ?? 20);
  if (!limit.success) return c.json({ error: "invalid_limit" }, 400);

  const slices = await dimension(c.env.DB, parsed.data, name.data, limit.data);
  return c.json({ slices, dimension: name.data });
});

stats.get("/live", async (c) => {
  const limit = z.coerce.number().int().min(1).max(200).safeParse(c.req.query("limit") ?? 50);
  if (!limit.success) return c.json({ error: "invalid_limit" }, 400);

  const clicks = await recentClicks(c.env.DB, limit.data);
  return c.json({
    clicks: clicks.map((row) => ({
      id: row.id,
      linkId: row.link_id,
      slug: row.slug,
      ts: row.ts,
      country: row.country,
      city: row.city,
      device: row.device_type,
      browser: row.browser,
      referrerType: row.referrer_type,
      source: row.source,
      outcome: row.outcome,
      isBot: row.is_bot === 1,
    })),
  });
});

stats.get("/sparklines", async (c) => {
  const days = z.coerce.number().int().min(1).max(90).safeParse(c.req.query("days") ?? 7);
  if (!days.success) return c.json({ error: "invalid_days" }, 400);

  const series = await sparklines(c.env.DB, days.data, Math.floor(Date.now() / 1000));
  return c.json({
    days: days.data,
    series: Object.fromEntries([...series].map(([id, values]) => [String(id), values])),
  });
});
```

- [ ] **Step 4: Mount it in `src/routes/api/index.ts`**

```ts
import { stats } from "./stats";

// inside createApiRouter:
api.route("/stats", stats);
```

- [ ] **Step 5: Run the tests**

Run: `npm test`
Expected: PASS, guard test included.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(api): expose statistics endpoints for the dashboard"
```

---

## Task 18: Rollup and retention cron jobs

**Files:**
- Create: `src/cron/rollup.ts`, `src/cron/retention.ts`
- Modify: `src/index.ts`
- Test: `test/cron/rollup.test.ts`, `test/cron/retention.test.ts`

**Interfaces:**
- Consumes: schema (Task 2), `deleteClicksBefore` (Task 10), `deleteExpiredSessions` (Task 12), `deleteStaleLoginAttempts` (Task 12).
- Produces:
  - `rollupDay(db: D1Database, day: string): Promise<void>` — recomputes `click_daily` and `click_daily_dim` for one UTC day, idempotently.
  - `runRollup(db: D1Database, now: number): Promise<string[]>` — rolls up today and yesterday, returning the days processed.
  - `runRetention(db: D1Database, now: number, retentionDays: number): Promise<{ clicks: number; sessions: number; loginAttempts: number }>`

- [ ] **Step 1: Write the failing test `test/cron/rollup.test.ts`**

```ts
import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { createLink } from "../../src/db/links";
import { rollupDay, runRollup } from "../../src/cron/rollup";

const BASE = Date.parse("2026-03-10T00:00:00Z") / 1000;
const DAY = "2026-03-10";
let linkId = 0;

async function insert(ts: number, overrides: Record<string, unknown> = {}) {
  const row = {
    visitor_hash: `v${ts}`,
    is_bot: 0,
    country: "IT",
    device_type: "desktop",
    ...overrides,
  };
  await env.DB.prepare(
    `INSERT INTO clicks (link_id, ts, visitor_hash, source, outcome, is_bot, country, device_type)
     VALUES (?, ?, ?, 'link', 'redirect', ?, ?, ?)`,
  )
    .bind(linkId, ts, row.visitor_hash, row.is_bot, row.country, row.device_type)
    .run();
}

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM click_daily").run();
  await env.DB.prepare("DELETE FROM click_daily_dim").run();
  await env.DB.prepare("DELETE FROM clicks").run();
  await env.DB.prepare("DELETE FROM links").run();
  linkId = (await createLink(env.DB, { slug: "roll", targetUrl: "https://e.com" }, BASE)).id;
});

describe("rollupDay", () => {
  it("writes totals that match the raw rows", async () => {
    await insert(BASE + 10, { visitor_hash: "a" });
    await insert(BASE + 20, { visitor_hash: "a" });
    await insert(BASE + 30, { visitor_hash: "b" });
    await insert(BASE + 40, { visitor_hash: "c", is_bot: 1 });

    await rollupDay(env.DB, DAY);

    const row = await env.DB.prepare("SELECT * FROM click_daily WHERE day = ?")
      .bind(DAY)
      .first<{ clicks: number; uniques: number; bots: number }>();

    expect(row?.clicks).toBe(3);
    expect(row?.uniques).toBe(2);
    expect(row?.bots).toBe(1);
  });

  it("writes one row per dimension value", async () => {
    await insert(BASE + 10, { country: "IT", visitor_hash: "a" });
    await insert(BASE + 20, { country: "FR", visitor_hash: "b" });

    await rollupDay(env.DB, DAY);

    const { results } = await env.DB.prepare(
      "SELECT value, clicks FROM click_daily_dim WHERE dimension = 'country' ORDER BY value",
    ).all<{ value: string; clicks: number }>();

    expect(results.map((r) => r.value)).toEqual(["FR", "IT"]);
  });

  it("is idempotent: running twice does not double the counts", async () => {
    await insert(BASE + 10);

    await rollupDay(env.DB, DAY);
    await rollupDay(env.DB, DAY);

    const row = await env.DB.prepare("SELECT clicks FROM click_daily WHERE day = ?")
      .bind(DAY)
      .first<{ clicks: number }>();
    expect(row?.clicks).toBe(1);

    const dims = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM click_daily_dim WHERE dimension = 'country'",
    ).first<{ n: number }>();
    expect(dims?.n).toBe(1);
  });

  it("reflects deletions when re-run", async () => {
    await insert(BASE + 10);
    await rollupDay(env.DB, DAY);
    await env.DB.prepare("DELETE FROM clicks").run();
    await rollupDay(env.DB, DAY);

    const row = await env.DB.prepare("SELECT * FROM click_daily WHERE day = ?").bind(DAY).first();
    expect(row).toBeNull();
  });

  it("ignores clicks from other days", async () => {
    await insert(BASE - 10);
    await rollupDay(env.DB, DAY);
    expect(await env.DB.prepare("SELECT * FROM click_daily").first()).toBeNull();
  });
});

describe("runRollup", () => {
  it("processes today and yesterday", async () => {
    const days = await runRollup(env.DB, BASE + 3600);
    expect(days).toEqual(["2026-03-09", "2026-03-10"]);
  });
});
```

- [ ] **Step 2: Write the failing test `test/cron/retention.test.ts`**

```ts
import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { createLink } from "../../src/db/links";
import { runRetention } from "../../src/cron/retention";
import { createSession } from "../../src/db/sessions";

const NOW = Date.parse("2026-09-01T00:00:00Z") / 1000;
const DAY = 86_400;
let linkId = 0;

async function insert(ts: number) {
  await env.DB.prepare(
    `INSERT INTO clicks (link_id, ts, visitor_hash, source, outcome, is_bot)
     VALUES (?, ?, 'v', 'link', 'redirect', 0)`,
  )
    .bind(linkId, ts)
    .run();
}

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM clicks").run();
  await env.DB.prepare("DELETE FROM links").run();
  await env.DB.prepare("DELETE FROM admin_sessions").run();
  await env.DB.prepare("DELETE FROM login_attempts").run();
  linkId = (await createLink(env.DB, { slug: "ret", targetUrl: "https://e.com" }, NOW)).id;
});

describe("runRetention", () => {
  it("deletes raw clicks older than the retention window and keeps newer ones", async () => {
    await insert(NOW - 181 * DAY);
    await insert(NOW - 179 * DAY);

    const result = await runRetention(env.DB, NOW, 180);

    expect(result.clicks).toBe(1);
    const remaining = await env.DB.prepare("SELECT COUNT(*) AS n FROM clicks").first<{ n: number }>();
    expect(remaining?.n).toBe(1);
  });

  it("leaves aggregates untouched", async () => {
    await env.DB.prepare(
      "INSERT INTO click_daily (day, link_id, clicks, uniques, bots) VALUES ('2020-01-01', ?, 5, 3, 0)",
    )
      .bind(linkId)
      .run();

    await runRetention(env.DB, NOW, 180);

    const row = await env.DB.prepare("SELECT clicks FROM click_daily").first<{ clicks: number }>();
    expect(row?.clicks).toBe(5);
  });

  it("removes expired sessions and stale login attempts", async () => {
    await createSession(env.DB, null, NOW - 40 * DAY);
    await env.DB.prepare(
      "INSERT INTO login_attempts (ip_hash, attempts, first_attempt_at, locked_until) VALUES ('x', 3, ?, NULL)",
    )
      .bind(NOW - DAY)
      .run();

    const result = await runRetention(env.DB, NOW, 180);

    expect(result.sessions).toBe(1);
    expect(result.loginAttempts).toBe(1);
  });
});
```

- [ ] **Step 3: Run both to confirm they fail**

Run: `npm test -- test/cron`
Expected: FAIL — modules not found.

- [ ] **Step 4: Write `src/cron/rollup.ts`**

```ts
import { DIMENSION_COLUMNS, type DimensionName } from "../db/stats";

const DIMENSIONS = Object.keys(DIMENSION_COLUMNS) as DimensionName[];

function dayBounds(day: string): { from: number; to: number } {
  const from = Date.parse(`${day}T00:00:00Z`) / 1000;
  return { from, to: from + 86_400 };
}

export async function rollupDay(db: D1Database, day: string): Promise<void> {
  const { from, to } = dayBounds(day);

  const statements: D1PreparedStatement[] = [
    db.prepare("DELETE FROM click_daily WHERE day = ?").bind(day),
    db.prepare("DELETE FROM click_daily_dim WHERE day = ?").bind(day),
    db
      .prepare(
        `INSERT INTO click_daily (day, link_id, clicks, uniques, bots)
         SELECT ?,
                link_id,
                SUM(CASE WHEN is_bot = 0 THEN 1 ELSE 0 END),
                COUNT(DISTINCT CASE WHEN is_bot = 0 THEN visitor_hash END),
                SUM(is_bot)
         FROM clicks
         WHERE ts >= ? AND ts < ?
         GROUP BY link_id`,
      )
      .bind(day, from, to),
  ];

  for (const name of DIMENSIONS) {
    const column = DIMENSION_COLUMNS[name];
    statements.push(
      db
        .prepare(
          `INSERT INTO click_daily_dim (day, link_id, dimension, value, clicks, uniques)
           SELECT ?, link_id, ?,
                  COALESCE(NULLIF(${column}, ''), 'unknown'),
                  COUNT(*),
                  COUNT(DISTINCT visitor_hash)
           FROM clicks
           WHERE ts >= ? AND ts < ? AND is_bot = 0
           GROUP BY link_id, 4`,
        )
        .bind(day, name, from, to),
    );
  }

  await db.batch(statements);
}

export async function runRollup(db: D1Database, now: number): Promise<string[]> {
  const days = [
    new Date((now - 86_400) * 1000).toISOString().slice(0, 10),
    new Date(now * 1000).toISOString().slice(0, 10),
  ];

  for (const day of days) {
    await rollupDay(db, day);
  }

  return days;
}
```

Deleting the day before reinserting it is what makes the job idempotent and correct after a late deletion: an hourly cron that re-runs today all day long must converge on the truth, not accumulate.

Yesterday is re-rolled on every run so that clicks arriving just before midnight, and any correction made overnight, land in the right day.

- [ ] **Step 5: Write `src/cron/retention.ts`**

```ts
import { deleteStaleLoginAttempts } from "../auth/rate-limit";
import { deleteClicksBefore } from "../db/clicks";
import { deleteExpiredSessions } from "../db/sessions";

export interface RetentionResult {
  clicks: number;
  sessions: number;
  loginAttempts: number;
}

export async function runRetention(
  db: D1Database,
  now: number,
  retentionDays: number,
): Promise<RetentionResult> {
  const cutoff = now - retentionDays * 86_400;

  return {
    clicks: await deleteClicksBefore(db, cutoff),
    sessions: await deleteExpiredSessions(db, now),
    loginAttempts: await deleteStaleLoginAttempts(db, now),
  };
}
```

- [ ] **Step 6: Wire the scheduled handler in `src/index.ts`**

```ts
import { Hono } from "hono";
import { runRetention } from "./cron/retention";
import { runRollup } from "./cron/rollup";
import { createApiRouter } from "./routes/api";
import { registerRedirect } from "./routes/redirect";
import type { Env } from "./types";

export const app = new Hono<{ Bindings: Env }>();

app.get("/_health", (c) => c.json({ ok: true }));
app.route("/api", createApiRouter());

registerRedirect(app);

export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledController, env: Env): Promise<void> {
    const now = Math.floor(Date.now() / 1000);

    if (event.cron === "30 3 * * *") {
      const result = await runRetention(env.DB, now, Number(env.RAW_RETENTION_DAYS));
      console.log("retention", result);
      return;
    }

    const days = await runRollup(env.DB, now);
    console.log("rollup", days);
  },
};
```

The public routes are not mounted here — Task 19 creates that module and adds its own line. Keep this file exactly as shown.

- [ ] **Step 7: Run the tests**

Run: `npm test`
Expected: PASS across every file.

- [ ] **Step 8: Verify the cron triggers fire in local development**

```bash
npx wrangler dev
```

In a second terminal:

```bash
curl "http://localhost:8787/cdn-cgi/local/scheduled?cron=0+*+*+*+*"
curl "http://localhost:8787/cdn-cgi/local/scheduled?cron=30+3+*+*+*"
```

Expected: the `wrangler dev` console logs `rollup [...]` and `retention {...}`. Paste both lines into the task's completion note.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(cron): roll up daily aggregates and enforce retention"
```

---

## Task 19: Privacy notice and robots policy

**Files:**
- Create: `src/routes/public.ts`
- Modify: `src/index.ts`
- Test: `test/routes/public.test.ts`

**Interfaces:**
- Consumes: `Env`.
- Produces: `registerPublicRoutes(app: Hono<{ Bindings: Env }>): void` mounting `GET /privacy` and `GET /robots.txt`.

- [ ] **Step 1: Write the failing test `test/routes/public.test.ts`**

```ts
import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("GET /privacy", () => {
  it("is publicly reachable", async () => {
    const res = await SELF.fetch("https://link.test/privacy");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
  });

  it("states the legal basis, the retention window and the absence of IP storage", async () => {
    const body = await (await SELF.fetch("https://link.test/privacy")).text();
    expect(body).toContain("legitimate interest");
    expect(body).toContain("180");
    expect(body).toMatch(/IP address/i);
  });

  it("declares a language for screen readers", async () => {
    const body = await (await SELF.fetch("https://link.test/privacy")).text();
    expect(body).toContain('<html lang="en">');
  });
});

describe("GET /robots.txt", () => {
  it("keeps short links out of search indexes", async () => {
    const res = await SELF.fetch("https://link.test/robots.txt");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Disallow: /");
  });
});
```

- [ ] **Step 2: Write `src/routes/public.ts`**

```ts
import type { Hono } from "hono";
import type { Env } from "../types";

function privacyHtml(retentionDays: string, domain: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Privacy notice</title>
<style>
:root { color-scheme: light dark; --bg: #fbfbfd; --fg: #16161a; --muted: #6b6b76; }
@media (prefers-color-scheme: dark) { :root { --bg: #0d0d11; --fg: #f2f2f5; --muted: #9a9aa5; } }
body { margin: 0 auto; max-width: 44rem; padding: 48px 24px; background: var(--bg); color: var(--fg);
  font: 16px/1.65 system-ui, -apple-system, "Segoe UI", sans-serif; }
h1 { font-size: 1.6rem; margin-bottom: .25em; }
h2 { font-size: 1.1rem; margin-top: 2em; }
p, li { color: var(--muted); }
strong { color: var(--fg); }
</style>
</head>
<body>
<h1>Privacy notice</h1>
<p>This page explains what ${domain} records when you follow a short link.</p>

<h2>What is recorded</h2>
<p>When a short link is opened we record the time, the country, region and city
your request was routed from, your network operator, the type of device,
operating system and browser, your preferred language, the site that referred
you, and any campaign parameters in the link.</p>

<h2>What is not recorded</h2>
<p><strong>Your IP address is never stored</strong>, in any form, and neither is
your full browser user-agent string. To tell one visitor from another without
identifying anyone, a short code is derived from your IP address, browser and
the link, using a key that changes every day. <strong>After 24 hours the same
visitor produces a different code</strong>, so activity cannot be linked across
days. No tracking cookie is set.</p>

<h2>Why</h2>
<p>The legal basis is <strong>legitimate interest</strong> under Article 6(1)(f)
GDPR: measuring how the operator's own links perform. The data is pseudonymous,
there is no profiling, and no decision is made about any individual.</p>

<h2>How long</h2>
<p>Individual records are deleted after <strong>${retentionDays} days</strong>.
Only aggregate counts, which identify nobody, are kept beyond that.</p>

<h2>Your rights</h2>
<p>Because no identifier persists beyond 24 hours, the operator cannot locate
records relating to a specific person, and Article 11 GDPR applies. For any
question about this notice, contact the operator of ${domain}.</p>
</body>
</html>`;
}

export function registerPublicRoutes(app: Hono<{ Bindings: Env }>): void {
  app.get("/privacy", (c) =>
    c.html(privacyHtml(c.env.RAW_RETENTION_DAYS, c.env.SHORT_DOMAIN)),
  );

  app.get("/robots.txt", (c) =>
    c.text("User-agent: *\nDisallow: /\n", 200, { "content-type": "text/plain; charset=utf-8" }),
  );
}
```

- [ ] **Step 3: Mount it in `src/index.ts`, before `registerRedirect`**

```ts
import { registerPublicRoutes } from "./routes/public";

app.get("/_health", (c) => c.json({ ok: true }));
app.route("/api", createApiRouter());
registerPublicRoutes(app);

registerRedirect(app);
```

- [ ] **Step 4: Run the test**

Run: `npm test -- test/routes/public.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(public): add privacy notice and robots policy"
```

---

## Task 20: Rate limiting on link creation

Spec §5 item 5 requires this and nothing so far implements it. An authenticated
endpoint is still a public attack surface once a session cookie leaks, and an
unbounded `POST /api/links` is how a shortener becomes a phishing relay.

**Files:**
- Modify: `src/db/links.ts`, `src/routes/api/links.ts`
- Test: `test/routes/links-rate-limit.test.ts`

**Interfaces:**
- Consumes: link repository (Task 9).
- Produces: `countRecentLinks(db: D1Database, since: number): Promise<number>` and a `429` response from `POST /api/links` once `CREATION_LIMIT_PER_HOUR` is exceeded.

No new table is needed: `links.created_at` already carries everything the
counter requires, so this adds no migration.

- [ ] **Step 1: Write the failing test `test/routes/links-rate-limit.test.ts`**

```ts
import { SELF, env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

let cookie = "";

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM links").run();
  await env.DB.prepare("DELETE FROM admin_sessions").run();

  const res = await SELF.fetch("https://link.test/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "correct-horse-battery-staple" }),
  });
  cookie = (res.headers.get("set-cookie") ?? "").split(";")[0] as string;
});

function create() {
  return SELF.fetch("https://link.test/api/links", {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ targetUrl: "https://example.com" }),
  });
}

async function seedLinks(count: number, createdAt: number) {
  const statements = [];
  for (let i = 0; i < count; i++) {
    statements.push(
      env.DB.prepare(
        "INSERT INTO links (slug, target_url, is_active, created_at, updated_at) VALUES (?, 'https://e.com', 1, ?, ?)",
      ).bind(`seed${i}`, createdAt, createdAt),
    );
  }
  await env.DB.batch(statements);
}

describe("POST /api/links rate limiting", () => {
  it("allows creation under the hourly limit", async () => {
    expect((await create()).status).toBe(201);
  });

  it("refuses with 429 and Retry-After once the hourly limit is reached", async () => {
    await seedLinks(120, Math.floor(Date.now() / 1000));

    const res = await create();

    expect(res.status).toBe(429);
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await res.json()) as unknown).toMatchObject({ error: "rate_limited" });
  });

  it("ignores links created more than an hour ago", async () => {
    await seedLinks(120, Math.floor(Date.now() / 1000) - 7200);
    expect((await create()).status).toBe(201);
  });

  it("counts soft-deleted links too, so deleting does not reset the budget", async () => {
    const now = Math.floor(Date.now() / 1000);
    await seedLinks(120, now);
    await env.DB.prepare("UPDATE links SET deleted_at = ?").bind(now).run();

    expect((await create()).status).toBe(429);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm test -- test/routes/links-rate-limit.test.ts`
Expected: FAIL — creation still returns 201 at the limit.

- [ ] **Step 3: Add `countRecentLinks` to `src/db/links.ts`**

```ts
export async function countRecentLinks(db: D1Database, since: number): Promise<number> {
  const row = await db
    .prepare("SELECT COUNT(*) AS total FROM links WHERE created_at >= ?")
    .bind(since)
    .first<{ total: number }>();
  return row?.total ?? 0;
}
```

Soft-deleted rows are counted on purpose: otherwise the budget resets by
deleting, which is exactly what an abuser would do.

- [ ] **Step 4: Enforce it in `src/routes/api/links.ts`**

Add the import and the constant:

```ts
import { countRecentLinks } from "../../db/links";

const CREATION_LIMIT_PER_HOUR = 120;
const CREATION_WINDOW_SECONDS = 3600;
```

Then insert this block in `links.post("/")`, immediately after the schema parse
and before the destination is validated:

```ts
  const windowStart = Math.floor(Date.now() / 1000) - CREATION_WINDOW_SECONDS;
  if ((await countRecentLinks(c.env.DB, windowStart)) >= CREATION_LIMIT_PER_HOUR) {
    return c.json({ error: "rate_limited" }, 429, {
      "retry-after": String(CREATION_WINDOW_SECONDS),
    });
  }
```

- [ ] **Step 5: Run the tests**

Run: `npm test -- test/routes`
Expected: PASS. The existing link-API tests create far fewer than 120 links per
file, so none of them trips the limit.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(api): rate limit link creation"
```

---

## Task 21: Compliance evidence

Spec §4.2 states that a legitimate-interest assessment is recorded in
`compliance/`, and §4.3 that the data map and Article 30 record are produced
during implementation. Neither exists yet. The project mandate is explicit that
a feature touching personal data states its legal basis before it is built, so
this is owed evidence, not documentation polish.

**Files:**
- Create: `compliance/legitimate-interest-assessment.md`, `compliance/data-map.md`
- Test: `test/compliance.test.ts`

**Interfaces:**
- Consumes: the schema from Task 2.
- Produces: a test that fails when a column is added to `clicks` without being
  described in the data map, which is what keeps the document honest as the
  schema changes.

- [ ] **Step 1: Invoke the compliance skill**

Run the `gdpr-evidence` skill against this repository before writing anything by
hand. It owns the format of the data map and the Article 30 record. What follows
is the minimum the two documents must contain; if the skill produces a richer
structure, keep the skill's.

- [ ] **Step 2: Write `compliance/legitimate-interest-assessment.md`**

```markdown
# Legitimate Interest Assessment — click analytics

**Controller:** the operator of link.margio.uk
**Processing:** recording and aggregating clicks on short links
**Legal basis claimed:** Article 6(1)(f) GDPR
**Assessed:** 2026-09-01

## 1. Purpose test

The interest is measuring how the controller's own short links perform: how many
people follow them, from which countries and devices, and from which referring
sites. The interest is the controller's own and is commercial and operational,
not speculative.

## 2. Necessity test

The purpose cannot be met without recording something about each click. The
processing is limited to what measurement requires:

- No IP address is stored in any form, and no raw user-agent string.
- Visitor de-duplication uses an HMAC keyed on a secret plus the current UTC
  date, so the same visitor is uncorrelatable with themselves after 24 hours.
- Geography stops at city level; latitude and longitude, available from the
  platform at no cost, are deliberately discarded.
- Individual records are deleted after 180 days; only aggregate counts survive.

No less intrusive alternative meets the purpose: a purely aggregate counter
cannot distinguish a returning visitor from a new one, which is the measurement.

## 3. Balancing test

Against the controller's interest stands the data subject's interest in not
being tracked. The processing:

- sets no cookie on visitors and therefore does not require consent under the
  ePrivacy Directive;
- produces no profile, since no identifier survives 24 hours;
- supports no decision about any individual;
- is disclosed in a public notice at /privacy, reachable without authentication.

A visitor following a short link would not reasonably object to a count being
kept of that click when nothing about them persists beyond a day. The residual
risk is low and the balance favours the controller.

## 4. Article 11 position

Because no identifier persists beyond 24 hours, the controller cannot identify a
data subject from the stored records and cannot locate the records of a specific
person. Article 11 applies: the controller is not required to acquire additional
information solely to enable identification. This is stated in the public notice.

## 5. Review

Reassess if any of the following changes: a persistent visitor identifier is
introduced, retention is extended, geography becomes finer than city level, or
the data is combined with any other dataset.
```

- [ ] **Step 3: Write `compliance/data-map.md`**

```markdown
# Data Map — MargioLink

Every column in the `clicks` table, with its classification and basis. The test
in `test/compliance.test.ts` fails if a column exists in the schema and not here.

**Controller:** the operator of link.margio.uk
**Retention:** 180 days for every row below, then deletion. `click_daily` holds
a count of clicks/uniques/bots per link per day; `click_daily_dim` holds a count
grouped by one dimension's value — a city name, a referrer host, a browser name
— retained indefinitely alongside that count. Both remain non-personal not
because the value is absent, but because no individual is identifiable in either
table: the rows are grouped counts with no visitor identifier and no
row-per-person structure. `compliance/data-map.md` is the authoritative wording.
**Legal basis for all of the below:** Article 6(1)(f) — see
`legitimate-interest-assessment.md`.

| Column | Personal data? | Why it is collected |
| --- | --- | --- |
| `id` | No | Row identifier |
| `link_id` | No | Which link was followed |
| `ts` | Yes, in combination | When the click happened; the measurement itself |
| `visitor_hash` | Yes, pseudonymous | Distinguishes visitors within one UTC day; key rotates daily |
| `source` | No | Whether the click came from a QR scan or an ordinary link |
| `outcome` | No | Whether the redirect succeeded, expired, or failed a password |
| `is_bot` | No | Excludes crawler traffic from human-facing figures |
| `continent`, `country`, `region`, `city` | Yes, in combination | Geographic reach of a link; city is the finest granularity kept |
| `timezone` | Yes, in combination | Local-time analysis of when links are followed |
| `asn_org` | Yes, in combination | Network operator, to separate mobile from fixed-line traffic |
| `colo` | No | Cloudflare datacenter that served the request; operational |
| `device_type`, `os`, `os_version` | Yes, in combination | Which devices the audience uses |
| `browser`, `browser_version` | Yes, in combination | Which browsers the audience uses |
| `language` | Yes, in combination | Audience language, for content decisions |
| `referrer_host`, `referrer_type` | Yes, in combination | Which channel drove the traffic |
| `utm_source`, `utm_medium`, `utm_campaign`, `utm_term`, `utm_content` | No | Campaign parameters the controller placed in the link |

## Deliberately not collected

| Field | Available from | Why not stored |
| --- | --- | --- |
| IP address | `CF-Connecting-IP` | Directly identifying; used in memory only as HMAC input |
| Raw user-agent | `User-Agent` | High-entropy fingerprint; only parsed fields are kept |
| Latitude / longitude | `request.cf` | Finer than the purpose requires |
| Postal code | `request.cf` | Finer than the purpose requires |

## Other personal data in the system

| Table | Column | Notes |
| --- | --- | --- |
| `login_attempts` | `ip_hash` | HMAC with the same daily-rotating key; exists solely to throttle brute-force attempts; purged daily once the lockout window closes |
| `admin_sessions` | `ua_summary` | Coarse device label ("Chrome on macOS") shown in the sessions list; relates to the operator, not to visitors |
```

- [ ] **Step 4: Write the test `test/compliance.test.ts`**

```ts
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import dataMap from "../compliance/data-map.md?raw";

describe("data map", () => {
  it("describes every column of the clicks table", async () => {
    const { results } = await env.DB.prepare("PRAGMA table_info(clicks)").all<{ name: string }>();
    const undocumented = results
      .map((column) => column.name)
      .filter((name) => !dataMap.includes(`\`${name}\``));

    expect(
      undocumented,
      `columns missing from compliance/data-map.md: ${undocumented.join(", ")}`,
    ).toEqual([]);
  });

  it("records the retention window that the code actually enforces", () => {
    expect(dataMap).toContain(`${env.RAW_RETENTION_DAYS} days`);
  });

  it("still states that no IP address is stored", () => {
    expect(dataMap).toContain("IP address");
  });
});
```

Add the matching declaration to `env.d.ts`:

```ts
declare module "*.md?raw" {
  const contents: string;
  export default contents;
}
```

- [ ] **Step 5: Run the test**

Run: `npm test -- test/compliance.test.ts`
Expected: PASS. If it fails, the schema and the data map have diverged — fix the
document, which is the whole point of the test.

- [ ] **Step 6: Commit**

```bash
git add compliance test/compliance.test.ts env.d.ts
git commit -m "docs(compliance): record legal basis and data map for click analytics"
```

---

## Task 22: Completion gate

Nothing here is optional. The project standard is that "done" without shown
output is not a claim this team accepts.

- [ ] **Step 1: Run the full gate and show every output**

```bash
npm test
npm run check
npm run typecheck
npx wrangler deploy --dry-run
```

Paste all four outputs into the completion note.

- [ ] **Step 2: Exercise the real endpoints and show the responses**

```bash
npx wrangler dev &
sleep 3

curl -s -X POST http://localhost:8787/api/auth/login \
  -H 'content-type: application/json' \
  -d '{"username":"'"$ADMIN_USER"'","password":"'"$ADMIN_PASSWORD"'"}' \
  -c /tmp/margiolink-cookies.txt -i | head -20

curl -s -X POST http://localhost:8787/api/links \
  -H 'content-type: application/json' -b /tmp/margiolink-cookies.txt \
  -d '{"targetUrl":"https://oltrematica.it","slug":"demo","title":"Demo"}' | head -5

curl -s -i http://localhost:8787/demo | head -5

curl -s -b /tmp/margiolink-cookies.txt \
  "http://localhost:8787/api/stats/live?limit=5" | head -5
```

All four must be shown: a `200` carrying a `__Host-ml_session` cookie; a `201`
with the new link; a `302` to `https://oltrematica.it`; and a live feed
containing that click. Stop the dev server afterwards.

- [ ] **Step 3: Prove the migration rollback once more against the built schema**

```bash
npm run db:migrate:local
npm run db:rollback:local
npm run db:migrate:local
```

Show the output. The rollback was tested in Task 2, but the gate re-runs it
because a later migration could have broken it.

- [ ] **Step 4: Push and open the pull request**

```bash
git push -u origin feature/ML-1-backend
```

The pull request states what changed, why, how to test it, and that no API is
public. It references the spec at
`docs/superpowers/specs/2026-09-01-margiolink-design.md`.

---

## After this plan

With Task 22 green, the backend is complete and deployable. The dashboard is a separate plan, written against the API surface this one produced rather than against a guess: `GET /api/links`, `GET /api/stats/{summary,timeseries,dimension,live,sparklines}`, `GET /api/tags`, and the auth endpoints.

Two follow-ups belong to that plan, not this one:

1. **Static assets binding.** `wrangler.jsonc` gains an `assets` block pointing at the built dashboard, with `run_worker_first` set so `/:slug` continues to reach the Worker before the asset handler.
2. **Queries beyond the retention window.** `src/db/stats.ts` currently reads raw `clicks` only, which is exact but stops at 180 days. The dashboard plan adds the aggregate-table path in `click_daily` and `click_daily_dim` for older ranges, with the honest labelling of summed daily uniques that spec §3.4 requires.
