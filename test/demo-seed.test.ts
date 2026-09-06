import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { generateDemoData } from "../scripts/demo-data.mjs";
import {
  buildSeedStatements,
  CLICK_COLUMNS,
  ROLLUP_DIMENSIONS,
  SENSITIVE_ROLLUP_DIMENSIONS,
} from "../scripts/demo-sql.mjs";
import { hashPasswordForSeed } from "../scripts/password-hash.mjs";
import { rollupDay } from "../src/cron/rollup";
import {
  DIMENSION_COLUMNS,
  SENSITIVE_DIMENSIONS,
  summary,
  timeseries,
  topLinks,
} from "../src/db/stats";

/**
 * The demo seed, tested against a real D1 rather than by reading it.
 *
 * `scripts/seed-demo.mjs` writes rows straight into the database instead of
 * driving the public API, which buys it the two things `e2e/seed.ts` cannot
 * fake (a spread of countries, and six months of days) and costs it the
 * safety net of going through the real insert path. This file is that safety
 * net: it runs the generator's own SQL against a real database, then asks the
 * real dashboard queries whether what came out is something the product can
 * actually draw.
 *
 * The two files it imports are plain `.mjs` with no `node:` imports precisely
 * so they can be loaded inside `workerd` here.
 */

// Small enough to insert in a couple of statements, long enough to span
// weekdays and to reach every scheduled moment in a link's life — the
// expiry, the deactivation and the soft delete all sit at fractions of the
// window, so they land inside any window at all.
const DAYS = 14;
const NOW = Date.UTC(2026, 8, 3, 14, 30) / 1000;

function seed() {
  const data = generateDemoData({ now: NOW, days: DAYS });
  for (const link of data.links) {
    if (!link.password) continue;
    link.passwordSalt = "5eed5eed5eed5eed5eed5eed5eed5eed";
    link.passwordHash = "not-a-real-hash";
  }
  return data;
}

async function apply(statements: string[]): Promise<void> {
  // One at a time rather than `db.batch`: a batch is a single transaction and
  // this is several megabytes of literal SQL in the real script — the point
  // here is to exercise the same statements the script sends, in the same
  // order, not to wrap them differently.
  for (const statement of statements) {
    await env.DB.prepare(statement).run();
  }
}

async function rows<T>(sql: string): Promise<T[]> {
  const result = await env.DB.prepare(sql).all<T>();
  return result.results;
}

describe("the demo dataset", () => {
  it("uses the same versioned password encoding as production", async () => {
    const hash = await hashPasswordForSeed("demo-password", "5eed5eed5eed5eed5eed5eed5eed5eed");

    expect(hash).toMatch(/^pbkdf2-sha256\$600000\$[0-9a-f]{64}$/);
  });

  it("is deterministic — the same arguments produce byte-identical rows", () => {
    expect(JSON.stringify(seed())).toBe(JSON.stringify(seed()));
  });

  it("changes completely with a different seed", () => {
    const a = generateDemoData({ now: NOW, days: DAYS, seed: 1 });
    const b = generateDemoData({ now: NOW, days: DAYS, seed: 2 });
    expect(JSON.stringify(a.clicks)).not.toBe(JSON.stringify(b.clicks));
  });

  it("covers the whole window, one row per day, ending today", () => {
    const data = seed();
    const days = new Set(
      data.clicks.map((click) => new Date(click.ts * 1000).toISOString().slice(0, 10)),
    );
    expect(days.size).toBe(DAYS);
    expect(Math.max(...data.clicks.map((click) => click.ts))).toBeLessThanOrEqual(NOW);
  });

  /**
   * Every panel on the dashboard is a `GROUP BY` over one column. A dataset
   * that varies only two of them produces a page of single-bar charts, which
   * is exactly the failure mode the e2e seed documents and this one exists to
   * avoid — so the coverage is asserted rather than hoped for.
   */
  it("gives every dashboard panel more than one bar to draw", () => {
    const { clicks } = seed();
    const distinct = (key: keyof (typeof clicks)[number]) =>
      new Set(clicks.map((click) => click[key])).size;

    expect(distinct("country")).toBeGreaterThanOrEqual(10);
    expect(distinct("city")).toBeGreaterThanOrEqual(10);
    expect(distinct("deviceType")).toBeGreaterThanOrEqual(4);
    expect(distinct("os")).toBeGreaterThanOrEqual(4);
    expect(distinct("browser")).toBeGreaterThanOrEqual(4);
    expect(distinct("referrerType")).toBeGreaterThanOrEqual(5);
    expect(distinct("language")).toBeGreaterThanOrEqual(8);
    expect(distinct("asnOrg")).toBeGreaterThanOrEqual(10);
    expect(distinct("utmCampaign")).toBeGreaterThanOrEqual(3);
    expect(distinct("source")).toBe(2);
    // Enough hours in enough weekdays that the heatmap is a shape, not a row.
    expect(new Set(clicks.map((click) => new Date(click.ts * 1000).getUTCHours())).size).toBe(24);
  });

  it("exercises every outcome the redirect route can record", () => {
    const outcomes = new Set(seed().clicks.map((click) => click.outcome));
    expect([...outcomes].sort()).toEqual(
      ["expired", "inactive", "password_failed", "password_required", "redirect"].sort(),
    );
  });

  it("includes bots, and records them the way the user-agent parser would", () => {
    const bots = seed().clicks.filter((click) => click.isBot === 1);
    expect(bots.length).toBeGreaterThan(0);
    for (const bot of bots) {
      // `src/lib/ua.ts` returns device_type "bot" and nulls everywhere else
      // for a crawler; a bot row carrying a browser version would be a row no
      // real crawler could produce.
      expect(bot.deviceType).toBe("bot");
      expect(bot.os).toBeNull();
      expect(bot.browser).toBeNull();
      expect(bot.referrerHost).toBeNull();
      expect(bot.utmCampaign).toBeNull();
    }
  });

  it("does not populate retired free-form UTM term or content fields", () => {
    const { clicks } = seed();
    expect(new Set(clicks.map((click) => click.utmTerm))).toEqual(new Set([null]));
    expect(new Set(clicks.map((click) => click.utmContent))).toEqual(new Set([null]));
  });

  it("leaves the links in the states the dashboard has filters for", () => {
    const { links } = seed();
    expect(links.some((link) => link.deletedAt !== null)).toBe(true);
    expect(links.some((link) => link.isActive === 0)).toBe(true);
    expect(links.some((link) => link.expiresAt !== null)).toBe(true);
    expect(links.some((link) => link.password !== null)).toBe(true);
    // A link created halfway through the window has no clicks before it
    // existed — the one property that makes the time series believable.
    for (const link of links) {
      const earliest = Math.min(
        ...seed()
          .clicks.filter((click) => click.linkId === link.id)
          .map((click) => click.ts),
      );
      if (Number.isFinite(earliest))
        expect(earliest).toBeGreaterThanOrEqual(link.createdAt - 86_400);
    }
  });
});

/**
 * The generator writes columns by hand, so the hand has to be checked. Both
 * directions, like `test/compliance.test.ts` does for the data map: a column
 * added to `clicks` that the seed never fills is a panel that is empty in
 * every demo, and a column the seed fills that no longer exists is a seed
 * that throws.
 */
describe("the seed's columns and the schema", () => {
  it("names exactly the columns the clicks table has, minus its key", async () => {
    const columns = (await rows<{ name: string }>("PRAGMA table_info(clicks)"))
      .map((column) => column.name)
      .filter((name) => name !== "id");

    expect([...CLICK_COLUMNS].sort()).toEqual(columns.sort());
  });

  it("aggregates exactly the dimensions the rollup and the stats API know about", () => {
    expect(ROLLUP_DIMENSIONS).toEqual(DIMENSION_COLUMNS);
    expect([...SENSITIVE_ROLLUP_DIMENSIONS].sort()).toEqual([...SENSITIVE_DIMENSIONS].sort());
  });
});

describe("the seeded database", () => {
  beforeEach(async () => {
    await apply(buildSeedStatements(seed()));
  });

  it("holds every generated row", async () => {
    const data = seed();
    const [counts] = await rows<{
      links: number;
      tags: number;
      clicks: number;
    }>(
      "SELECT (SELECT COUNT(*) FROM links) AS links, (SELECT COUNT(*) FROM tags) AS tags, (SELECT COUNT(*) FROM clicks) AS clicks",
    );
    expect(counts).toEqual({
      links: data.links.length,
      tags: data.tags.length,
      clicks: data.clicks.length,
    });
  });

  /**
   * The load-bearing test in this file.
   *
   * The seed aggregates all 180 days in one grouped pass per dimension, while
   * production aggregates one named day at a time (`rollupDay`, run hourly
   * over today and yesterday). Those are two different SQL statements that
   * have to produce the same table, and the only way to know they do is to
   * run both and diff.
   */
  it("aggregates exactly as the production rollup would", async () => {
    const order = "ORDER BY day, link_id";
    const dimOrder = "ORDER BY day, link_id, dimension, value";

    const seedDaily = await rows(`SELECT * FROM click_daily ${order}`);
    const seedDims = await rows(`SELECT * FROM click_daily_dim ${dimOrder}`);

    // Anti-vacuity: two empty tables would compare equal.
    expect(seedDaily.length).toBeGreaterThan(0);
    expect(seedDims.length).toBeGreaterThan(0);

    await env.DB.prepare("DELETE FROM click_daily").run();
    await env.DB.prepare("DELETE FROM click_daily_dim").run();

    const days = [
      ...new Set(
        (
          await rows<{ day: string }>("SELECT DISTINCT date(ts, 'unixepoch') AS day FROM clicks")
        ).map((row) => row.day),
      ),
    ];
    for (const day of days) await rollupDay(env.DB, day);

    expect(await rows(`SELECT * FROM click_daily ${order}`)).toEqual(seedDaily);
    expect(await rows(`SELECT * FROM click_daily_dim ${dimOrder}`)).toEqual(seedDims);
  });

  /** The point of the whole exercise: the dashboard's own queries, over the
   *  seeded data, return something worth photographing. */
  it("answers the dashboard's queries with a populated result", async () => {
    const range = { from: NOW - DAYS * 86_400, to: NOW };

    const totals = await summary(env.DB, range);
    expect(totals.clicks).toBeGreaterThan(0);
    expect(totals.countries).toBeGreaterThanOrEqual(10);
    // Uniques are per-day distinct visitor codes: always below the click
    // count, never zero.
    expect(totals.uniques).toBeGreaterThan(0);
    expect(totals.uniques).toBeLessThan(totals.clicks);
    expect(totals.bots).toBeGreaterThan(0);

    const series = await timeseries(env.DB, range, "day");
    expect(series.length).toBe(DAYS);
    expect(series.every((bucket) => bucket.clicks >= 0)).toBe(true);
    expect(series.some((bucket) => bucket.clicks > 0)).toBe(true);

    const top = await topLinks(env.DB, range, 5);
    expect(top.length).toBe(5);
    // Ranked, and by a real difference rather than a tie between sixteen
    // identical links.
    expect(top[0]?.clicks).toBeGreaterThan(top[4]?.clicks ?? 0);
  });
});
