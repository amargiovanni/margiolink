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
