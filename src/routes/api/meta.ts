import { Hono } from "hono";
import { requireSession } from "../../auth/middleware";
import type { Env } from "../../types";

/**
 * Two facts the dashboard has no other way to learn: `RAW_RETENTION_DAYS`
 * and `SHORT_DOMAIN` are Worker environment variables, read today only by
 * the cron (`src/cron/retention.ts`) and the server-rendered `/privacy`
 * page. Neither is a secret — both are already stated on that public page —
 * but this stays behind `requireSession` like the rest of `/api`, because
 * there is no reason to widen the anonymous surface for them.
 *
 * `retentionDays` is deliberately `Number(...)`, not the raw env string:
 * `RAW_RETENTION_DAYS` is typed `string` on `Env` (it comes from wrangler
 * config, which has no numeric env vars), and a client that formats "180"
 * and 180 differently must be handed the type it actually means.
 *
 * The build version is NOT here on purpose — see `web/vite.config.ts`. The
 * version a reader wants in the dashboard's About group is the one baked
 * into the assets they are looking at, not one this endpoint could report
 * for a Worker that may already be a step ahead or behind that build.
 */
export const meta = new Hono<{ Bindings: Env; Variables: { sessionId: string } }>();

meta.use("*", requireSession);

meta.get("/", (c) =>
  c.json({
    retentionDays: Number(c.env.RAW_RETENTION_DAYS),
    shortDomain: c.env.SHORT_DOMAIN,
  }),
);
