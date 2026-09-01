import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { createLink } from "../../src/db/links";
import {
  DIMENSION_COLUMNS,
  type DimensionName,
  dimension,
  sparklines,
  summary,
  timeseries,
} from "../../src/db/stats";

const DAY = 86_400;
const BASE = Date.parse("2026-03-10T00:00:00Z") / 1000;

let linkId = 0;
let otherId = 0;

async function insert(overrides: Record<string, unknown> = {}) {
  const row = {
    link_id: linkId,
    ts: BASE + 3600,
    visitor_hash: "aaaa",
    source: "link",
    outcome: "redirect",
    is_bot: 0,
    country: "IT",
    city: "Milan",
    device_type: "desktop",
    os: "macOS",
    browser: "Chrome",
    referrer_type: "social",
    referrer_host: "x.com",
    language: "it-IT",
    utm_source: "newsletter",
    utm_medium: "email",
    utm_campaign: "spring-sale",
    asn_org: "Cloudflare",
    ...overrides,
  };
  await env.DB.prepare(
    `INSERT INTO clicks (link_id, ts, visitor_hash, source, outcome, is_bot, country, city,
       device_type, os, browser, referrer_type, referrer_host, language,
       utm_source, utm_medium, utm_campaign, asn_org)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      row.link_id,
      row.ts,
      row.visitor_hash,
      row.source,
      row.outcome,
      row.is_bot,
      row.country,
      row.city,
      row.device_type,
      row.os,
      row.browser,
      row.referrer_type,
      row.referrer_host,
      row.language,
      row.utm_source,
      row.utm_medium,
      row.utm_campaign,
      row.asn_org,
    )
    .run();
}

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM clicks").run();
  await env.DB.prepare("DELETE FROM links").run();
  linkId = (await createLink(env.DB, { slug: "s1", targetUrl: "https://e.com" }, BASE)).id;
  otherId = (await createLink(env.DB, { slug: "s2", targetUrl: "https://e.com" }, BASE)).id;
});

describe("summary", () => {
  it("counts clicks, distinct visitors, bots and countries", async () => {
    await insert({ visitor_hash: "a" });
    await insert({ visitor_hash: "a" });
    await insert({ visitor_hash: "b", country: "FR" });
    await insert({ visitor_hash: "c", is_bot: 1 });

    const result = await summary(env.DB, { from: BASE, to: BASE + DAY });

    expect(result.clicks).toBe(3);
    expect(result.uniques).toBe(2);
    expect(result.bots).toBe(1);
    expect(result.countries).toBe(2);
  });

  it("excludes bots from clicks and uniques but reports them separately", async () => {
    await insert({ visitor_hash: "bot", is_bot: 1 });
    const result = await summary(env.DB, { from: BASE, to: BASE + DAY });
    expect(result.clicks).toBe(0);
    expect(result.bots).toBe(1);
  });

  it("respects the range boundaries", async () => {
    await insert({ ts: BASE - 1 });
    await insert({ ts: BASE + DAY });
    const result = await summary(env.DB, { from: BASE, to: BASE + DAY });
    expect(result.clicks).toBe(0);
    expect(result.uniques).toBe(0);
    expect(result.bots).toBe(0);
    expect(result.countries).toBe(0);
  });

  it("scopes to a single link when asked", async () => {
    await insert({ link_id: linkId });
    await insert({ link_id: otherId, visitor_hash: "z" });
    const result = await summary(env.DB, { from: BASE, to: BASE + DAY, linkId });
    expect(result.clicks).toBe(1);
  });
});

describe("timeseries", () => {
  it("buckets by hour", async () => {
    await insert({ ts: BASE + 3600 });
    await insert({ ts: BASE + 3700, visitor_hash: "b" });
    await insert({ ts: BASE + 7300, visitor_hash: "c" });

    const buckets = await timeseries(env.DB, { from: BASE, to: BASE + DAY }, "hour");

    expect(buckets).toHaveLength(2);
    expect(buckets[0]?.clicks).toBe(2);
    expect(buckets[1]?.clicks).toBe(1);
  });

  it("buckets by day", async () => {
    await insert({ ts: BASE + 3600 });
    await insert({ ts: BASE + DAY + 3600, visitor_hash: "b" });

    const buckets = await timeseries(env.DB, { from: BASE, to: BASE + 3 * DAY }, "day");

    expect(buckets.map((b) => b.bucket)).toEqual(["2026-03-10", "2026-03-11"]);
  });

  it("buckets by week starting on Monday", async () => {
    await insert({ ts: BASE + 3600 });
    await insert({ ts: BASE + 7 * DAY, visitor_hash: "b" });

    const buckets = await timeseries(env.DB, { from: BASE, to: BASE + 14 * DAY }, "week");

    expect(buckets).toHaveLength(2);
    expect(buckets[0]?.bucket).toBe("2026-03-09");
  });

  it("returns buckets in chronological order", async () => {
    await insert({ ts: BASE + 2 * DAY });
    await insert({ ts: BASE, visitor_hash: "b" });
    const buckets = await timeseries(env.DB, { from: BASE, to: BASE + 3 * DAY }, "day");
    expect(buckets[0]?.bucket).toBe("2026-03-10");
  });
});

describe("dimension", () => {
  it("ranks values by clicks", async () => {
    await insert({ country: "IT", visitor_hash: "a" });
    await insert({ country: "IT", visitor_hash: "b" });
    await insert({ country: "FR", visitor_hash: "c" });

    const slices = await dimension(env.DB, { from: BASE, to: BASE + DAY }, "country", 10);

    expect(slices[0]).toEqual({ value: "IT", clicks: 2, uniques: 2 });
    expect(slices[1]?.value).toBe("FR");
  });

  it("labels missing values as unknown rather than dropping them", async () => {
    await insert({ country: null });
    const slices = await dimension(env.DB, { from: BASE, to: BASE + DAY }, "country", 10);
    expect(slices[0]?.value).toBe("unknown");
  });

  it("honours the limit", async () => {
    for (const country of ["A", "B", "C", "D"]) {
      await insert({ country, visitor_hash: country });
    }
    const slices = await dimension(env.DB, { from: BASE, to: BASE + DAY }, "country", 2);
    expect(slices).toHaveLength(2);
  });

  it("produces weekday-hour keys for the heatmap", async () => {
    await insert({ ts: BASE + 3600 });
    const slices = await dimension(env.DB, { from: BASE, to: BASE + DAY }, "dow_hour", 10);
    expect(slices[0]?.value).toMatch(/^[0-6]-\d{2}$/);
  });

  it("counts outcomes including failures, which bots do not pollute", async () => {
    await insert({ outcome: "password_failed", visitor_hash: "a" });
    await insert({ outcome: "redirect", visitor_hash: "b" });
    const slices = await dimension(env.DB, { from: BASE, to: BASE + DAY }, "outcome", 10);
    expect(slices.map((s) => s.value).sort()).toEqual(["password_failed", "redirect"]);
  });

  const SEEDED_VALUES: Partial<Record<DimensionName, string>> = {
    country: "IT",
    city: "Milan",
    device: "desktop",
    os: "macOS",
    browser: "Chrome",
    referrer_type: "social",
    referrer_host: "x.com",
    utm_source: "newsletter",
    utm_medium: "email",
    utm_campaign: "spring-sale",
    language: "it-IT",
    asn_org: "Cloudflare",
    source: "link",
    outcome: "redirect",
  };

  it.each(Object.keys(DIMENSION_COLUMNS) as DimensionName[])(
    "maps dimension %s to its own seeded column",
    async (name) => {
      await insert();

      const slices = await dimension(env.DB, { from: BASE, to: BASE + DAY }, name, 10);

      expect(slices).toHaveLength(1);
      expect(slices[0]?.clicks).toBe(1);
      if (name === "dow_hour") {
        expect(slices[0]?.value).toMatch(/^[0-6]-\d{2}$/);
      } else {
        expect(slices[0]?.value).toBe(SEEDED_VALUES[name]);
      }
    },
  );
});

describe("sparklines", () => {
  it("returns one bucket per day per link, zero-filled", async () => {
    await insert({ ts: BASE + 3600 });
    const map = await sparklines(env.DB, 7, BASE + DAY);
    const series = map.get(linkId);
    expect(series).toHaveLength(7);
    expect(series?.reduce((a, b) => a + b, 0)).toBe(1);
  });
});
