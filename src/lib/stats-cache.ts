import type { Context } from "hono";
import { version } from "../../package.json";
import type { AuthedVariables } from "../auth/middleware";
import type { StatsMeta } from "../routes/api/stats";
import type { Env } from "../types";
import { sha256Hex } from "./crypto";

const TTL_MS = 60_000;
const STORED_AT = "x-stats-stored-at";

/** Called only by validated stats handlers behind the API's single session guard.
 * Raw queries remain the source of truth, including unsuppressed dimensions.
 * Cutoff eligibility is recalculated on every request, before any cache lookup.
 */
export async function cachedStats(
  c: Context<{ Bindings: Env; Variables: AuthedVariables }>,
  meta: StatsMeta,
  to: number,
  earliestFrom: number,
  load: () => Promise<Record<string, unknown>>,
): Promise<Response> {
  const now = Date.now();
  const eligible = to < Math.floor(now / 1000) && earliestFrom >= meta.retentionCutoff;
  let key: Request | undefined;
  let cache: Cache | undefined;
  if (eligible) {
    try {
      const identity = await sha256Hex(
        JSON.stringify([c.req.url, version, c.env.RAW_RETENTION_DAYS, c.get("sessionId")]),
      );
      key = new Request(`${new URL(c.req.url).origin}/__stats-cache/${identity}`);
      cache = caches.default;
      const hit = await cache.match(key);
      if (hit?.ok) {
        const storedAt = Number(hit.headers.get(STORED_AT));
        if (Number.isFinite(storedAt) && now >= storedAt && now - storedAt < TTL_MS) {
          const body = await hit.json<Record<string, unknown>>();
          // A cached payload must never freeze the moving retention metadata.
          return Response.json(
            { ...body, meta },
            { headers: { "Cache-Control": "private, no-store" } },
          );
        }
      }
    } catch {
      // Cache availability must not determine analytics availability.
    }
  }

  const body = { ...(await load()), meta };
  if (cache && key) {
    try {
      await cache.put(
        key,
        Response.json(body, {
          headers: {
            "Cache-Control": "public, max-age=60",
            [STORED_AT]: String(now),
          },
        }),
      );
    } catch {
      // The authenticated response still succeeds if a cache write fails.
    }
  }
  return Response.json(body, { headers: { "Cache-Control": "private, no-store" } });
}
