import type { ReferrerInfo } from "../lib/referrer";
import type { GeoInfo, UtmParams } from "../lib/request-context";
import type { ClientInfo } from "../lib/ua";

export type Outcome = "redirect" | "inactive" | "expired" | "password_required" | "password_failed";

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
        referrer_host, referrer_type,
        utm_source, utm_medium, utm_campaign, utm_term, utm_content
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      click.referrer.type,
      click.utm.source,
      click.utm.medium,
      click.utm.campaign,
      click.utm.term,
      click.utm.content,
    )
    .run();
}

/**
 * SQL fragment: true when the row's UTC day has at least one `click_daily` row.
 *
 * Retention must never delete raw rows for a day the rollup never reached.
 * `runRollup` only recomputes today and yesterday, so an outage spanning more
 * than 48 hours leaves days permanently unaggregated — and once their raw rows
 * are gone there is nothing left to backfill from. Deleting less is always
 * recoverable; deleting unaggregated data is not.
 */
const DAY_WAS_ROLLED_UP = `EXISTS (
    SELECT 1 FROM click_daily d
    WHERE d.day = strftime('%Y-%m-%d', clicks.ts, 'unixepoch')
  )`;

/**
 * UTC days that have raw rows older than `ts` but no `click_daily` row —
 * the days retention is declining to delete. Oldest first.
 */
export async function unaggregatedDaysBefore(db: D1Database, ts: number): Promise<string[]> {
  const { results } = await db
    .prepare(
      `SELECT DISTINCT strftime('%Y-%m-%d', ts, 'unixepoch') AS day
       FROM clicks
       WHERE ts < ? AND NOT ${DAY_WAS_ROLLED_UP}
       ORDER BY day`,
    )
    .bind(ts)
    .all<{ day: string }>();
  return results.map((row) => row.day);
}

/** Rows removed per DELETE statement. */
export const CLICK_DELETE_BATCH_SIZE = 5_000;

/** Upper bound on statements per call, so one run cannot loop unboundedly. */
export const CLICK_DELETE_MAX_BATCHES = 100;

export interface ClickDeletion {
  /** Rows actually deleted, summed across every batch. */
  deleted: number;
  /** True when the iteration cap stopped the run with rows still to delete. */
  capped: boolean;
}

/**
 * Delete raw clicks older than `ts`, in bounded batches.
 *
 * A single unbounded `DELETE` deletes an entire backlog in one statement, so
 * after any period in which the daily cron did not run it must delete
 * everything at once. If that exceeds D1's per-statement limits it fails, and
 * it fails identically every night thereafter — the job never makes partial
 * progress, and personal data is kept past its stated window with only a
 * console line as evidence. Batching means each run makes progress even when
 * it cannot finish.
 */
export async function deleteClicksBefore(
  db: D1Database,
  ts: number,
  batchSize: number = CLICK_DELETE_BATCH_SIZE,
  maxBatches: number = CLICK_DELETE_MAX_BATCHES,
): Promise<ClickDeletion> {
  const statement = db.prepare(
    `DELETE FROM clicks
     WHERE id IN (
       SELECT id FROM clicks WHERE ts < ?1 AND ${DAY_WAS_ROLLED_UP} LIMIT ?2
     )`,
  );

  let deleted = 0;

  for (let batch = 0; batch < maxBatches; batch++) {
    const result = await statement.bind(ts, batchSize).run();
    const changes = result.meta.changes ?? 0;
    deleted += changes;

    // A short batch means the backlog is drained: there was nothing left to
    // fill it. Checking this rather than re-counting saves a query per batch.
    if (changes < batchSize) return { deleted, capped: false };
  }

  return { deleted, capped: true };
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
