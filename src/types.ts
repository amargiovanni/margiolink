export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  ADMIN_USER: string;
  ADMIN_PASSWORD: string;
  // Typed as possibly absent on purpose: a deploy that never ran
  // `wrangler secret put HASH_SECRET` really does hand the Worker `undefined`
  // here. Read it through `requireHashSecret` in `src/lib/secrets.ts`, never
  // directly — this type is what makes a direct read fail to compile.
  HASH_SECRET: string | undefined;
  SHORT_DOMAIN: string;
  RAW_RETENTION_DAYS: string;
}
