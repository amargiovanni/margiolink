/**
 * Statistics API.
 *
 * Two limits define how consumers must read these responses:
 *
 * 1. **A range cannot extend past raw-data retention.** Every endpoint here
 *    reads raw `clicks` only. Its lower bound is clamped and the response
 *    carries the requested/effective cutoff in `meta`.
 * 2. **Summed daily `uniques` over-count a returning visitor.** `uniques` is
 *    `COUNT(DISTINCT visitor_hash)`, and the hash rotates at UTC midnight by
 *    design, so a visitor returning on three days counts three times over a
 *    multi-day range — in `summary`, in `dimension`, and in `timeseries` at
 *    day and week granularity. This is the accepted consequence of the privacy
 *    design, not a bug. `meta.uniquesDefinition` makes the semantic explicit.
 */

import { Hono } from "hono";
import { z } from "zod";
import { requireSession } from "../../auth/middleware";
import { recentClicks } from "../../db/clicks";
import {
  DIMENSION_COLUMNS,
  type DimensionName,
  dimension,
  type Granularity,
  type StatsRange,
  sparklines,
  summary,
  timeseries,
  topLinks,
} from "../../db/stats";
import type { Env } from "../../types";

const rangeSchema = z
  .object({
    from: z.coerce.number().int().nonnegative(),
    to: z.coerce.number().int().positive(),
    linkId: z.coerce.number().int().positive().optional(),
  })
  .refine((value) => value.from < value.to, { message: "from must be before to" });

/** `/top-links` ranks *across* links, so `linkId` has no meaning here — this
 *  schema simply has no field for it, rather than accepting-and-ignoring it
 *  through the shared `rangeSchema`. A parameter this route cannot honour
 *  should not appear to be part of its contract; a caller who sends
 *  `linkId` gets the same whole-account ranking as one who doesn't, instead
 *  of an unhonoured hint of a per-link one. */
const topLinksRangeSchema = z
  .object({
    from: z.coerce.number().int().nonnegative(),
    to: z.coerce.number().int().positive(),
  })
  .refine((value) => value.from < value.to, { message: "from must be before to" });

const dimensionNames = Object.keys(DIMENSION_COLUMNS) as [DimensionName, ...DimensionName[]];

/** `dow_hour` has a bounded, known maximum of 7 × 24 = 168 distinct values —
 *  the heatmap's whole point is to show all of them, so the cap must not
 *  truncate the grid it exists to render. Every other dimension has an
 *  unbounded cardinality (an arbitrary country list, referrer host, UTM
 *  campaign, …), where a cap is the right call — this raises the shared
 *  cap to the one bounded dimension's actual maximum rather than special
 *  -casing `name` in the schema. */
const DIMENSION_LIMIT_MAX = 168;
const DAY_SECONDS = 86_400;

export interface StatsMeta {
  requestedFrom: number;
  effectiveFrom: number;
  retentionCutoff: number;
  truncated: boolean;
  uniquesDefinition: "daily-rotating-visitor-hash";
}

export function normaliseStatsRange(
  range: StatsRange,
  now: number,
  retentionDays: number,
): { range: StatsRange; meta: StatsMeta } {
  if (!Number.isInteger(retentionDays) || retentionDays <= 0) {
    throw new Error("RAW_RETENTION_DAYS must be a positive integer");
  }

  const retentionCutoff = now - retentionDays * DAY_SECONDS;
  const effectiveFrom = Math.max(range.from, retentionCutoff);
  return {
    range: { ...range, from: effectiveFrom },
    meta: {
      requestedFrom: range.from,
      effectiveFrom,
      retentionCutoff,
      truncated: effectiveFrom !== range.from,
      uniquesDefinition: "daily-rotating-visitor-hash",
    },
  };
}

function rangeForEnv(env: Env, range: StatsRange): { range: StatsRange; meta: StatsMeta } {
  return normaliseStatsRange(range, Math.floor(Date.now() / 1000), Number(env.RAW_RETENTION_DAYS));
}

export const stats = new Hono<{ Bindings: Env; Variables: { sessionId: string } }>();

stats.use("*", requireSession);

stats.get("/summary", async (c) => {
  const parsed = rangeSchema.safeParse(c.req.query());
  if (!parsed.success) return c.json({ error: "invalid_range" }, 400);

  const { from, to, linkId } = parsed.data;
  const span = to - from;
  const normalized = rangeForEnv(c.env, parsed.data);
  const previousRange: StatsRange = {
    from: Math.max(normalized.meta.retentionCutoff, from - span),
    to: Math.max(normalized.meta.retentionCutoff, from),
    ...(linkId === undefined ? {} : { linkId }),
  };

  const [current, previous] = await Promise.all([
    summary(c.env.DB, normalized.range),
    summary(c.env.DB, previousRange),
  ]);

  return c.json({ current, previous, range: { from, to }, meta: normalized.meta });
});

stats.get("/timeseries", async (c) => {
  const parsed = rangeSchema.safeParse(c.req.query());
  if (!parsed.success) return c.json({ error: "invalid_range" }, 400);

  const granularity = c.req.query("granularity") ?? "day";
  if (!["hour", "day", "week"].includes(granularity)) {
    return c.json({ error: "invalid_granularity" }, 400);
  }

  const normalized = rangeForEnv(c.env, parsed.data);
  const buckets = await timeseries(c.env.DB, normalized.range, granularity as Granularity);
  return c.json({ buckets, granularity, meta: normalized.meta });
});

stats.get("/dimension", async (c) => {
  const parsed = rangeSchema.safeParse(c.req.query());
  if (!parsed.success) return c.json({ error: "invalid_range" }, 400);

  const name = z.enum(dimensionNames).safeParse(c.req.query("name"));
  if (!name.success) return c.json({ error: "invalid_dimension" }, 400);

  const limit = z.coerce
    .number()
    .int()
    .min(1)
    .max(DIMENSION_LIMIT_MAX)
    .safeParse(c.req.query("limit") ?? 20);
  if (!limit.success) return c.json({ error: "invalid_limit" }, 400);

  const normalized = rangeForEnv(c.env, parsed.data);
  const slices = await dimension(c.env.DB, normalized.range, name.data, limit.data);
  return c.json({ slices, dimension: name.data, meta: normalized.meta });
});

stats.get("/top-links", async (c) => {
  const parsed = topLinksRangeSchema.safeParse(c.req.query());
  if (!parsed.success) return c.json({ error: "invalid_range" }, 400);

  const limit = z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .safeParse(c.req.query("limit") ?? 5);
  if (!limit.success) return c.json({ error: "invalid_limit" }, 400);

  const normalized = rangeForEnv(c.env, parsed.data);
  const links = await topLinks(c.env.DB, normalized.range, limit.data);
  return c.json({ links, meta: normalized.meta });
});

stats.get("/live", async (c) => {
  const limit = z.coerce
    .number()
    .int()
    .min(1)
    .max(200)
    .safeParse(c.req.query("limit") ?? 50);
  if (!limit.success) return c.json({ error: "invalid_limit" }, 400);

  const linkId = z.coerce.number().int().positive().optional().safeParse(c.req.query("linkId"));
  if (!linkId.success) return c.json({ error: "invalid_link" }, 400);

  const clicks = await recentClicks(c.env.DB, limit.data, linkId.data);
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
  const days = z.coerce
    .number()
    .int()
    .min(1)
    .max(90)
    .safeParse(c.req.query("days") ?? 7);
  if (!days.success) return c.json({ error: "invalid_days" }, 400);

  const series = await sparklines(c.env.DB, days.data, Math.floor(Date.now() / 1000));
  return c.json({
    days: days.data,
    series: Object.fromEntries([...series].map(([id, values]) => [String(id), values])),
  });
});
