/**
 * Statistics API.
 *
 * Two limits of these responses are not surfaced to a consumer, and the
 * dashboard has to account for both:
 *
 * 1. **A range extending past the retention window silently under-reports.**
 *    Every endpoint here reads raw `clicks` only. Rows older than
 *    `RAW_RETENTION_DAYS` have been deleted by `src/cron/retention.ts`, so a
 *    query covering them returns a smaller number that looks exactly like a
 *    complete one. The aggregate tables written for this case
 *    (`click_daily`, `click_daily_dim`) are not consulted, and no response
 *    carries a "truncated at" marker.
 * 2. **Summed daily `uniques` over-count a returning visitor.** `uniques` is
 *    `COUNT(DISTINCT visitor_hash)`, and the hash rotates at UTC midnight by
 *    design, so a visitor returning on three days counts three times over a
 *    multi-day range — in `summary`, in `dimension`, and in `timeseries` at
 *    day and week granularity. This is the accepted consequence of the privacy
 *    design, not a bug, but the response is a bare integer with no field the
 *    dashboard could hang an honest label on.
 *
 * Both are recorded here rather than fixed because the fix — a `meta` block
 * naming the oldest retained timestamp, whether the range was truncated, and
 * that uniques are daily-distinct — changes the response shape the dashboard
 * will consume, and belongs with the dashboard work that reads it.
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

  const limit = z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .safeParse(c.req.query("limit") ?? 20);
  if (!limit.success) return c.json({ error: "invalid_limit" }, 400);

  const slices = await dimension(c.env.DB, parsed.data, name.data, limit.data);
  return c.json({ slices, dimension: name.data });
});

stats.get("/top-links", async (c) => {
  const parsed = rangeSchema.safeParse(c.req.query());
  if (!parsed.success) return c.json({ error: "invalid_range" }, 400);

  const limit = z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .safeParse(c.req.query("limit") ?? 5);
  if (!limit.success) return c.json({ error: "invalid_limit" }, 400);

  const links = await topLinks(c.env.DB, parsed.data, limit.data);
  return c.json({ links });
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
