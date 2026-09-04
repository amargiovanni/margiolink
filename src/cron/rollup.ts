import { DIMENSION_COLUMNS, type DimensionName, SENSITIVE_DIMENSIONS } from "../db/stats";

const DIMENSIONS = Object.keys(DIMENSION_COLUMNS) as DimensionName[];
const MAX_CATCHUP_DAYS = 7;

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
    const privacyThreshold = SENSITIVE_DIMENSIONS.has(name) ? "HAVING COUNT(*) >= 3" : "";
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
           GROUP BY link_id, 4
           ${privacyThreshold}`,
        )
        .bind(day, name, from, to),
    );
  }

  await db.batch(statements);
}

export interface RollupResult {
  days: string[];
  backlog: boolean;
}

export async function findUnaggregatedDays(
  db: D1Database,
  before: number,
  limit: number,
): Promise<string[]> {
  const { results } = await db
    .prepare(
      `SELECT DISTINCT date(c.ts, 'unixepoch') AS day
       FROM clicks c
       WHERE c.ts < ?
         AND NOT EXISTS (
           SELECT 1 FROM click_daily d
           WHERE d.day = date(c.ts, 'unixepoch')
         )
       ORDER BY day
       LIMIT ?`,
    )
    .bind(before, limit)
    .all<{ day: string }>();
  return results.map((row) => row.day);
}

export async function runRollup(db: D1Database, now: number): Promise<RollupResult> {
  const today = new Date(now * 1000).toISOString().slice(0, 10);
  const todayStart = Date.parse(`${today}T00:00:00Z`) / 1000;
  const yesterday = new Date((todayStart - 86_400) * 1000).toISOString().slice(0, 10);
  const candidates = await findUnaggregatedDays(db, todayStart - 86_400, MAX_CATCHUP_DAYS + 1);
  const days = [...new Set([...candidates.slice(0, MAX_CATCHUP_DAYS), yesterday, today])].sort();

  for (const day of days) {
    await rollupDay(db, day);
  }

  return { days, backlog: candidates.length > MAX_CATCHUP_DAYS };
}
