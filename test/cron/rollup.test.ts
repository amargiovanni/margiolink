import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { rollupDay, runRollup } from "../../src/cron/rollup";
import { createLink } from "../../src/db/links";
import { DIMENSION_COLUMNS, dimension, summary } from "../../src/db/stats";

const BASE = Date.parse("2026-03-10T00:00:00Z") / 1000;
const DAY = "2026-03-10";
let linkId = 0;

async function insert(ts: number, overrides: Record<string, unknown> = {}) {
  const row = {
    visitor_hash: `v${ts}`,
    is_bot: 0,
    country: "IT",
    device_type: "desktop",
    utm_campaign: null,
    ...overrides,
  };
  await env.DB.prepare(
    `INSERT INTO clicks (link_id, ts, visitor_hash, source, outcome, is_bot, country, device_type, utm_campaign)
     VALUES (?, ?, ?, 'link', 'redirect', ?, ?, ?, ?)`,
  )
    .bind(linkId, ts, row.visitor_hash, row.is_bot, row.country, row.device_type, row.utm_campaign)
    .run();
}

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM click_daily").run();
  await env.DB.prepare("DELETE FROM click_daily_dim").run();
  await env.DB.prepare("DELETE FROM clicks").run();
  await env.DB.prepare("DELETE FROM links").run();
  linkId = (await createLink(env.DB, { slug: "roll", targetUrl: "https://e.com" }, BASE)).id;
});

describe("rollupDay", () => {
  it("writes totals that match the raw rows", async () => {
    await insert(BASE + 10, { visitor_hash: "a" });
    await insert(BASE + 20, { visitor_hash: "a" });
    await insert(BASE + 30, { visitor_hash: "b" });
    await insert(BASE + 40, { visitor_hash: "c", is_bot: 1 });

    await rollupDay(env.DB, DAY);

    const row = await env.DB.prepare("SELECT * FROM click_daily WHERE day = ?")
      .bind(DAY)
      .first<{ clicks: number; uniques: number; bots: number }>();

    expect(row?.clicks).toBe(3);
    expect(row?.uniques).toBe(2);
    expect(row?.bots).toBe(1);
  });

  it("writes one row per dimension value", async () => {
    await insert(BASE + 10, { country: "IT", visitor_hash: "a" });
    await insert(BASE + 20, { country: "FR", visitor_hash: "b" });

    await rollupDay(env.DB, DAY);

    const { results } = await env.DB.prepare(
      "SELECT value, clicks FROM click_daily_dim WHERE dimension = 'country' ORDER BY value",
    ).all<{ value: string; clicks: number }>();

    expect(results.map((r) => r.value)).toEqual(["FR", "IT"]);
  });

  it("suppresses low-count sensitive values but keeps coarse dimensions", async () => {
    await insert(BASE + 10, {
      visitor_hash: "private-a",
      country: "FR",
      utm_campaign: "private-label",
    });
    await insert(BASE + 20, { visitor_hash: "private-b", utm_campaign: "private-label" });
    await insert(BASE + 30, { visitor_hash: "shared-a", utm_campaign: "shared-label" });
    await insert(BASE + 40, { visitor_hash: "shared-b", utm_campaign: "shared-label" });
    await insert(BASE + 50, { visitor_hash: "shared-c", utm_campaign: "shared-label" });

    await rollupDay(env.DB, DAY);

    const { results: campaigns } = await env.DB.prepare(
      `SELECT value, clicks, uniques FROM click_daily_dim
       WHERE dimension = 'utm_campaign' ORDER BY value`,
    ).all<{ value: string; clicks: number; uniques: number }>();
    const france = await env.DB.prepare(
      `SELECT clicks FROM click_daily_dim
       WHERE dimension = 'country' AND value = 'FR'`,
    ).first<{ clicks: number }>();

    expect(campaigns).toStrictEqual([{ value: "shared-label", clicks: 3, uniques: 3 }]);
    expect(france?.clicks).toBe(1);
  });

  it("is idempotent: running twice does not double the counts", async () => {
    await insert(BASE + 10);

    await rollupDay(env.DB, DAY);

    const row = await env.DB.prepare("SELECT clicks FROM click_daily WHERE day = ?")
      .bind(DAY)
      .first<{ clicks: number }>();
    expect(row?.clicks).toBe(1);

    const countsBefore = new Map<string, number>();
    for (const name of Object.keys(DIMENSION_COLUMNS)) {
      const result = await env.DB.prepare(
        "SELECT COUNT(*) AS n FROM click_daily_dim WHERE dimension = ?",
      )
        .bind(name)
        .first<{ n: number }>();
      countsBefore.set(name, result?.n ?? 0);
    }

    await rollupDay(env.DB, DAY);

    const rowAfter = await env.DB.prepare("SELECT clicks FROM click_daily WHERE day = ?")
      .bind(DAY)
      .first<{ clicks: number }>();
    expect(rowAfter?.clicks).toBe(1);

    for (const name of Object.keys(DIMENSION_COLUMNS)) {
      const result = await env.DB.prepare(
        "SELECT COUNT(*) AS n FROM click_daily_dim WHERE dimension = ?",
      )
        .bind(name)
        .first<{ n: number }>();
      expect(result?.n ?? 0).toBe(countsBefore.get(name));
    }
  });

  it("reflects deletions when re-run", async () => {
    await insert(BASE + 10);
    await rollupDay(env.DB, DAY);
    await env.DB.prepare("DELETE FROM clicks").run();
    await rollupDay(env.DB, DAY);

    const row = await env.DB.prepare("SELECT * FROM click_daily WHERE day = ?").bind(DAY).first();
    expect(row).toBeNull();
  });

  it("ignores clicks from other days", async () => {
    await insert(BASE - 10);
    await rollupDay(env.DB, DAY);
    expect(await env.DB.prepare("SELECT * FROM click_daily").first()).toBeNull();
  });

  it("stores aggregates that match the live stats queries for the same day", async () => {
    await insert(BASE + 10, { visitor_hash: "a", country: "IT", device_type: "desktop" });
    await insert(BASE + 20, { visitor_hash: "a", country: "IT", device_type: "desktop" });
    await insert(BASE + 30, { visitor_hash: "b", country: "FR", device_type: "mobile" });
    await insert(BASE + 40, {
      visitor_hash: "c",
      country: "US",
      device_type: "desktop",
      is_bot: 1,
    });

    await rollupDay(env.DB, DAY);

    const from = Date.parse(`${DAY}T00:00:00Z`) / 1000;
    const to = from + 86_400;
    const range = { from, to, linkId };

    const live = await summary(env.DB, range);
    const stored = await env.DB.prepare(
      "SELECT clicks, uniques, bots FROM click_daily WHERE day = ? AND link_id = ?",
    )
      .bind(DAY, linkId)
      .first<{ clicks: number; uniques: number; bots: number }>();

    expect(stored?.clicks).toBe(live.clicks);
    expect(stored?.uniques).toBe(live.uniques);
    expect(stored?.bots).toBe(live.bots);

    for (const name of ["country", "device"] as const) {
      const liveSlices = await dimension(env.DB, range, name, 100);
      const { results: storedSlices } = await env.DB.prepare(
        `SELECT value, clicks, uniques FROM click_daily_dim
         WHERE day = ? AND link_id = ? AND dimension = ?
         ORDER BY clicks DESC, value ASC`,
      )
        .bind(DAY, linkId, name)
        .all<{ value: string; clicks: number; uniques: number }>();

      expect(storedSlices).toEqual(
        liveSlices.map((s) => ({ value: s.value, clicks: s.clicks, uniques: s.uniques })),
      );
    }
  });
});

describe("runRollup", () => {
  it("processes today and yesterday", async () => {
    const result = await runRollup(env.DB, BASE + 3600);
    expect(result).toEqual({ days: ["2026-03-09", "2026-03-10"], backlog: false });
  });

  it("recovers at most seven missed complete days per run and drains the backlog", async () => {
    for (let daysAgo = 11; daysAgo >= 3; daysAgo--) {
      await insert(BASE - daysAgo * 86_400 + 60, {
        visitor_hash: `missed-${daysAgo}`,
      });
    }

    const first = await runRollup(env.DB, BASE + 3600);
    const afterFirst = await env.DB.prepare("SELECT day FROM click_daily ORDER BY day").all<{
      day: string;
    }>();

    expect(first.days).toHaveLength(9);
    expect(first.days.slice(-2)).toEqual(["2026-03-09", "2026-03-10"]);
    expect(first.backlog).toBe(true);
    expect(afterFirst.results).toHaveLength(7);

    const second = await runRollup(env.DB, BASE + 3600);
    const afterSecond = await env.DB.prepare("SELECT day FROM click_daily ORDER BY day").all<{
      day: string;
    }>();

    expect(second.days).toHaveLength(4);
    expect(second.backlog).toBe(false);
    expect(afterSecond.results).toHaveLength(9);
  });
});
