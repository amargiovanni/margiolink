import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { rollupDay, runRollup } from "../../src/cron/rollup";
import { createLink } from "../../src/db/links";

const BASE = Date.parse("2026-03-10T00:00:00Z") / 1000;
const DAY = "2026-03-10";
let linkId = 0;

async function insert(ts: number, overrides: Record<string, unknown> = {}) {
  const row = {
    visitor_hash: `v${ts}`,
    is_bot: 0,
    country: "IT",
    device_type: "desktop",
    ...overrides,
  };
  await env.DB.prepare(
    `INSERT INTO clicks (link_id, ts, visitor_hash, source, outcome, is_bot, country, device_type)
     VALUES (?, ?, ?, 'link', 'redirect', ?, ?, ?)`,
  )
    .bind(linkId, ts, row.visitor_hash, row.is_bot, row.country, row.device_type)
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

  it("is idempotent: running twice does not double the counts", async () => {
    await insert(BASE + 10);

    await rollupDay(env.DB, DAY);
    await rollupDay(env.DB, DAY);

    const row = await env.DB.prepare("SELECT clicks FROM click_daily WHERE day = ?")
      .bind(DAY)
      .first<{ clicks: number }>();
    expect(row?.clicks).toBe(1);

    const dims = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM click_daily_dim WHERE dimension = 'country'",
    ).first<{ n: number }>();
    expect(dims?.n).toBe(1);
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
});

describe("runRollup", () => {
  it("processes today and yesterday", async () => {
    const days = await runRollup(env.DB, BASE + 3600);
    expect(days).toEqual(["2026-03-09", "2026-03-10"]);
  });
});
