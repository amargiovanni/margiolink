import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { runRetention } from "../../src/cron/retention";
import { createLink } from "../../src/db/links";
import { createSession } from "../../src/db/sessions";

const NOW = Date.parse("2026-09-01T00:00:00Z") / 1000;
const DAY = 86_400;
let linkId = 0;

async function insert(ts: number) {
  await env.DB.prepare(
    `INSERT INTO clicks (link_id, ts, visitor_hash, source, outcome, is_bot)
     VALUES (?, ?, 'v', 'link', 'redirect', 0)`,
  )
    .bind(linkId, ts)
    .run();
}

function dayOf(ts: number): string {
  return new Date(ts * 1000).toISOString().slice(0, 10);
}

/** Stand in for a successful rollup of `ts`'s UTC day. */
async function markRolledUp(ts: number) {
  await env.DB.prepare(
    "INSERT OR IGNORE INTO click_daily (day, link_id, clicks, uniques, bots) VALUES (?, ?, 1, 1, 0)",
  )
    .bind(dayOf(ts), linkId)
    .run();
}

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM clicks").run();
  await env.DB.prepare("DELETE FROM links").run();
  await env.DB.prepare("DELETE FROM admin_sessions").run();
  await env.DB.prepare("DELETE FROM login_attempts").run();
  await env.DB.prepare("DELETE FROM click_daily").run();
  await env.DB.prepare("DELETE FROM click_daily_dim").run();
  linkId = (await createLink(env.DB, { slug: "ret", targetUrl: "https://e.com" }, NOW)).id;
});

describe("runRetention", () => {
  it("deletes raw clicks older than the retention window and keeps newer ones", async () => {
    await insert(NOW - 181 * DAY);
    await insert(NOW - 179 * DAY);
    await markRolledUp(NOW - 181 * DAY);

    const result = await runRetention(env.DB, NOW, 180);

    expect(result.clicks).toBe(1);
    expect(result.skippedDays).toEqual([]);
    const remaining = await env.DB.prepare("SELECT COUNT(*) AS n FROM clicks").first<{
      n: number;
    }>();
    expect(remaining?.n).toBe(1);
  });

  it("refuses to delete a day that was never rolled up, and reports it", async () => {
    // The rollup only ever recomputes today and yesterday, so an outage longer
    // than 48 hours leaves days permanently unaggregated. Deleting their raw
    // rows would be a silent, unrecoverable hole in the analytics.
    await insert(NOW - 181 * DAY);
    await insert(NOW - 182 * DAY);
    await markRolledUp(NOW - 182 * DAY);

    const result = await runRetention(env.DB, NOW, 180);

    expect(result.clicks).toBe(1);
    expect(result.skippedDays).toEqual([dayOf(NOW - 181 * DAY)]);

    const { results } = await env.DB.prepare("SELECT ts FROM clicks").all<{ ts: number }>();
    expect(results.map((r) => r.ts)).toEqual([NOW - 181 * DAY]);
  });

  it("deletes nothing at all when no expired day was rolled up", async () => {
    await insert(NOW - 181 * DAY);
    await insert(NOW - 200 * DAY);

    const result = await runRetention(env.DB, NOW, 180);

    expect(result.clicks).toBe(0);
    expect(result.skippedDays).toEqual([dayOf(NOW - 200 * DAY), dayOf(NOW - 181 * DAY)]);
    const remaining = await env.DB.prepare("SELECT COUNT(*) AS n FROM clicks").first<{
      n: number;
    }>();
    expect(remaining?.n).toBe(2);
  });

  it("does not report a day that is still inside the retention window", async () => {
    await insert(NOW - 1 * DAY);

    const result = await runRetention(env.DB, NOW, 180);

    expect(result.skippedDays).toEqual([]);
  });

  it("leaves aggregates untouched", async () => {
    await env.DB.prepare(
      "INSERT INTO click_daily (day, link_id, clicks, uniques, bots) VALUES ('2020-01-01', ?, 5, 3, 0)",
    )
      .bind(linkId)
      .run();

    await runRetention(env.DB, NOW, 180);

    const row = await env.DB.prepare("SELECT clicks FROM click_daily").first<{ clicks: number }>();
    expect(row?.clicks).toBe(5);
  });

  it("expires old sensitive dimensions but keeps coarse and recent aggregates", async () => {
    const oldDay = dayOf(NOW - 181 * DAY);
    const recentDay = dayOf(NOW - 179 * DAY);
    const insertDimension = (day: string, dimension: string, value: string) =>
      env.DB.prepare(
        `INSERT INTO click_daily_dim (day, link_id, dimension, value, clicks, uniques)
         VALUES (?, ?, ?, ?, 3, 3)`,
      )
        .bind(day, linkId, dimension, value)
        .run();

    await insertDimension(oldDay, "utm_campaign", "old-campaign");
    await insertDimension(oldDay, "country", "IT");
    await insertDimension(recentDay, "utm_campaign", "recent-campaign");

    const result = await runRetention(env.DB, NOW, 180);
    const { results } = await env.DB.prepare(
      "SELECT day, dimension, value FROM click_daily_dim ORDER BY day, dimension, value",
    ).all<{ day: string; dimension: string; value: string }>();

    expect(result.dimensions).toBe(1);
    expect(result.dimensionsCapped).toBe(false);
    expect(results).toStrictEqual([
      { day: oldDay, dimension: "country", value: "IT" },
      { day: recentDay, dimension: "utm_campaign", value: "recent-campaign" },
    ]);
  });

  it("removes expired sessions and stale login attempts", async () => {
    await createSession(env.DB, null, NOW - 40 * DAY);
    await env.DB.prepare(
      "INSERT INTO login_attempts (ip_hash, attempts, first_attempt_at, locked_until) VALUES ('x', 3, ?, NULL)",
    )
      .bind(NOW - DAY)
      .run();

    const result = await runRetention(env.DB, NOW, 180);

    expect(result.sessions).toBe(1);
    expect(result.loginAttempts).toBe(1);
  });

  it("rejects a non-finite or non-positive retention window", async () => {
    await expect(runRetention(env.DB, NOW, Number.NaN)).rejects.toThrow();
    await expect(runRetention(env.DB, NOW, 0)).rejects.toThrow();
  });
});
