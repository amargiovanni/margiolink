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

export interface TopLink {
  id: number;
  slug: string;
  title: string | null;
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

const SENSITIVE_DIMENSION_NAMES = [
  "city",
  "asn_org",
  "referrer_host",
  "utm_source",
  "utm_medium",
  "utm_campaign",
] as const satisfies readonly DimensionName[];

export const SENSITIVE_DIMENSIONS: ReadonlySet<DimensionName> = new Set(SENSITIVE_DIMENSION_NAMES);

const DIMENSION_DELETE_BATCH_SIZE = 5_000;
const DIMENSION_DELETE_MAX_BATCHES = 100;

export async function deleteSensitiveDimensionsBefore(
  db: D1Database,
  day: string,
  batchSize: number = DIMENSION_DELETE_BATCH_SIZE,
  maxBatches: number = DIMENSION_DELETE_MAX_BATCHES,
): Promise<{ deleted: number; capped: boolean }> {
  const placeholders = SENSITIVE_DIMENSION_NAMES.map(() => "?").join(", ");
  const statement = db.prepare(
    `DELETE FROM click_daily_dim
     WHERE rowid IN (
       SELECT rowid FROM click_daily_dim
       WHERE day < ? AND dimension IN (${placeholders})
       LIMIT ?
     )`,
  );
  let deleted = 0;

  for (let batch = 0; batch < maxBatches; batch++) {
    const result = await statement.bind(day, ...SENSITIVE_DIMENSION_NAMES, batchSize).run();
    const changes = result.meta.changes ?? 0;
    deleted += changes;
    if (changes < batchSize) return { deleted, capped: false };
  }

  return { deleted, capped: true };
}

const BUCKET_EXPRESSIONS: Record<Granularity, string> = {
  hour: "strftime('%Y-%m-%dT%H:00', ts, 'unixepoch')",
  day: "date(ts, 'unixepoch')",
  week: "date(ts, 'unixepoch', '-' || ((strftime('%w', ts, 'unixepoch') + 6) % 7) || ' days')",
};

const DAY_SECONDS = 86_400;

interface CompleteUtcRange {
  fromDay: string;
  toDay: string;
  days: number;
}

/** Rollups are valid only for whole, closed UTC days. A partial day must stay
 * raw because its aggregate would omit clicks that have not arrived yet. */
function completeUtcRange(range: StatsRange, now: number): CompleteUtcRange | null {
  const currentDayStart = Math.floor(now / DAY_SECONDS) * DAY_SECONDS;
  if (
    range.from % DAY_SECONDS !== 0 ||
    range.to % DAY_SECONDS !== 0 ||
    range.from >= range.to ||
    range.to > currentDayStart
  ) {
    return null;
  }

  return {
    fromDay: new Date(range.from * 1000).toISOString().slice(0, 10),
    toDay: new Date(range.to * 1000).toISOString().slice(0, 10),
    days: (range.to - range.from) / DAY_SECONDS,
  };
}

async function hasDailyRollup(db: D1Database, range: CompleteUtcRange): Promise<boolean> {
  try {
    const row = await db
      .prepare(
        `SELECT COUNT(DISTINCT day) AS days
         FROM click_daily
         WHERE day >= ? AND day < ?`,
      )
      .bind(range.fromDay, range.toDay)
      .first<{ days: number }>();
    return (row?.days ?? 0) === range.days;
  } catch {
    // A deployment without the rollup tables must remain usable on raw data.
    return false;
  }
}

async function hasDimensionRollup(
  db: D1Database,
  range: CompleteUtcRange,
  name: DimensionName,
  linkId?: number,
): Promise<boolean> {
  const linkClause = linkId === undefined ? "" : " AND d.link_id = ?";

  try {
    const row = await db
      .prepare(
        `SELECT COUNT(*) AS missing
         FROM click_daily d
         WHERE d.day >= ? AND d.day < ? AND d.clicks > 0${linkClause}
           AND NOT EXISTS (
             SELECT 1 FROM click_daily_dim dim
             WHERE dim.day = d.day
               AND dim.link_id = d.link_id
               AND dim.dimension = ?
           )`,
      )
      // The dimension value is used by the correlated subquery, so bind it
      // after the optional link filter's value.
      .bind(range.fromDay, range.toDay, ...(linkId === undefined ? [name] : [linkId, name]))
      .first<{ missing: number }>();
    return (row?.missing ?? 0) === 0;
  } catch {
    return false;
  }
}

async function dailyRollupRange(
  db: D1Database,
  range: StatsRange,
): Promise<CompleteUtcRange | null> {
  const complete = completeUtcRange(range, Math.floor(Date.now() / 1000));
  if (!complete || !(await hasDailyRollup(db, complete))) return null;
  return complete;
}

function rollupScope(
  range: CompleteUtcRange,
  linkId?: number,
): { clause: string; values: (string | number)[] } {
  const values: (string | number)[] = [range.fromDay, range.toDay];
  let clause = "day >= ? AND day < ?";
  if (linkId !== undefined) {
    clause += " AND link_id = ?";
    values.push(linkId);
  }
  return { clause, values };
}

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
  const rollup = await dailyRollupRange(db, range);
  if (rollup && (await hasDimensionRollup(db, rollup, "country", range.linkId))) {
    const scoped = rollupScope(rollup, range.linkId);
    const row = await db
      .prepare(
        `SELECT COALESCE(SUM(clicks), 0) AS clicks,
                COALESCE(SUM(uniques), 0) AS uniques,
                COALESCE(SUM(bots), 0) AS bots,
                (
                  SELECT COUNT(DISTINCT dim.value)
                  FROM click_daily_dim dim
                  WHERE dim.day >= ? AND dim.day < ?
                    AND dim.dimension = 'country'
                    ${range.linkId === undefined ? "" : "AND dim.link_id = ?"}
                ) AS countries
         FROM click_daily
         WHERE ${scoped.clause}`,
      )
      .bind(
        rollup.fromDay,
        rollup.toDay,
        ...(range.linkId === undefined ? [] : [range.linkId]),
        ...scoped.values,
      )
      .first<{ clicks: number; uniques: number; bots: number; countries: number }>();

    return {
      clicks: row?.clicks ?? 0,
      uniques: row?.uniques ?? 0,
      bots: row?.bots ?? 0,
      countries: row?.countries ?? 0,
    };
  }

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
  const rollup = granularity === "day" ? await dailyRollupRange(db, range) : null;
  if (rollup) {
    const scoped = rollupScope(rollup, range.linkId);
    const { results } = await db
      .prepare(
        `SELECT day AS bucket,
                SUM(clicks) AS clicks,
                SUM(uniques) AS uniques
         FROM click_daily
         WHERE ${scoped.clause}
         GROUP BY day
         ORDER BY day`,
      )
      .bind(...scoped.values)
      .all<TimeBucket>();
    return results;
  }

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
  const rollup = SENSITIVE_DIMENSIONS.has(name) ? null : await dailyRollupRange(db, range);
  if (rollup && (await hasDimensionRollup(db, rollup, name, range.linkId))) {
    const scoped = rollupScope(rollup, range.linkId);
    const dimensionValues = [name, ...scoped.values];
    const { results } = await db
      .prepare(
        `SELECT COALESCE(NULLIF(value, ''), 'unknown') AS value,
                SUM(clicks) AS clicks,
                SUM(uniques) AS uniques
         FROM click_daily_dim
         WHERE dimension = ? AND ${scoped.clause}
         GROUP BY value
         ORDER BY clicks DESC, value ASC
         LIMIT ?`,
      )
      .bind(...dimensionValues, limit)
      .all<DimensionSlice>();
    return results;
  }

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

/** Ranks links by click count within `[from, to)` — the overview page's "top
 *  links" panel, and the only ranking that crosses links rather than staying
 *  within one.
 *
 *  Deliberately does not call `scope()`: that helper emits bare `ts` and
 *  `link_id`, unambiguous here only because `links` happens to have neither
 *  column — a coincidence this query should not depend on now that it joins
 *  `links` in. It also carries a `linkId` branch that means nothing for a
 *  ranking *across* links, so it is not reused even partially.
 *
 *  Soft-deleted links are excluded: a top-N list never sums to the period
 *  total anyway, so their absence introduces no discrepancy a reader could
 *  misread, and every row here links to a detail page a deleted link no
 *  longer has.
 *
 *  The `l.slug ASC` tie-break makes the order deterministic — without it,
 *  links tied on click count come back in whatever order SQLite chooses,
 *  and the panel would reshuffle between refreshes for no reason a reader
 *  could see. */
export async function topLinks(
  db: D1Database,
  range: { from: number; to: number },
  limit: number,
): Promise<TopLink[]> {
  const rollup = await dailyRollupRange(db, range);
  if (rollup) {
    const { results } = await db
      .prepare(
        `SELECT l.id AS id, l.slug AS slug, l.title AS title,
                SUM(d.clicks) AS clicks,
                SUM(d.uniques) AS uniques
         FROM click_daily d
         JOIN links l ON l.id = d.link_id
         WHERE d.day >= ? AND d.day < ? AND l.deleted_at IS NULL
         GROUP BY l.id
         ORDER BY clicks DESC, l.slug ASC
         LIMIT ?`,
      )
      .bind(rollup.fromDay, rollup.toDay, limit)
      .all<TopLink>();
    return results;
  }

  const { results } = await db
    .prepare(
      `SELECT l.id AS id, l.slug AS slug, l.title AS title,
              COUNT(*) AS clicks,
              COUNT(DISTINCT c.visitor_hash) AS uniques
       FROM clicks c
       JOIN links l ON l.id = c.link_id
       WHERE c.ts >= ? AND c.ts < ? AND c.is_bot = 0 AND l.deleted_at IS NULL
       GROUP BY l.id
       ORDER BY clicks DESC, l.slug ASC
       LIMIT ?`,
    )
    .bind(range.from, range.to, limit)
    .all<TopLink>();

  return results;
}

export async function sparklines(
  db: D1Database,
  days: number,
  now: number,
): Promise<Map<number, number[]>> {
  const from = now - days * 86_400;

  const rollup = await dailyRollupRange(db, { from, to: now });
  if (rollup) {
    const { results } = await db
      .prepare(
        `SELECT link_id, day, SUM(clicks) AS clicks
         FROM click_daily
         WHERE day >= ? AND day < ?
         GROUP BY link_id, day`,
      )
      .bind(rollup.fromDay, rollup.toDay)
      .all<{ link_id: number; day: string; clicks: number }>();

    return buildSparklineSeries(results, days, now - DAY_SECONDS);
  }

  const { results } = await db
    .prepare(
      `SELECT link_id, date(ts, 'unixepoch') AS day, COUNT(*) AS clicks
       FROM clicks
       WHERE ts >= ? AND is_bot = 0
       GROUP BY link_id, day`,
    )
    .bind(from)
    .all<{ link_id: number; day: string; clicks: number }>();

  return buildSparklineSeries(results, days, now);
}

function buildSparklineSeries(
  results: Array<{ link_id: number; day: string; clicks: number }>,
  days: number,
  now: number,
): Map<number, number[]> {
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
