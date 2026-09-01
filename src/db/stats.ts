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
