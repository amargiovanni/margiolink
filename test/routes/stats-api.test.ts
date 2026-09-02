import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { createLink, softDeleteLink } from "../../src/db/links";

const DAY = 86_400;
const BASE = Date.parse("2026-03-10T00:00:00Z") / 1000;
let cookie = "";
let linkId = 0;
let otherLinkId = 0;

async function insertClickFor(id: number, ts: number, overrides: Record<string, unknown> = {}) {
  const row = { visitor_hash: `v${id}-${ts}`, country: "IT", is_bot: 0, ...overrides };
  await env.DB.prepare(
    `INSERT INTO clicks (link_id, ts, visitor_hash, source, outcome, is_bot, country)
     VALUES (?, ?, ?, 'link', 'redirect', ?, ?)`,
  )
    .bind(id, ts, row.visitor_hash, row.is_bot, row.country)
    .run();
}

async function insertClick(ts: number, overrides: Record<string, unknown> = {}) {
  return insertClickFor(linkId, ts, overrides);
}

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM clicks").run();
  await env.DB.prepare("DELETE FROM links").run();
  await env.DB.prepare("DELETE FROM admin_sessions").run();

  linkId = (await createLink(env.DB, { slug: "stats", targetUrl: "https://e.com" }, BASE)).id;
  otherLinkId = (await createLink(env.DB, { slug: "stats-2", targetUrl: "https://e2.com" }, BASE))
    .id;

  const res = await SELF.fetch("https://link.test/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "correct-horse-battery-staple" }),
  });
  cookie = (res.headers.get("set-cookie") ?? "").split(";")[0] as string;
});

function api(path: string) {
  return SELF.fetch(`https://link.test${path}`, { headers: { cookie } });
}

describe("GET /api/stats/summary", () => {
  it("returns the current window and the preceding one", async () => {
    await insertClick(BASE + 100);
    await insertClick(BASE + 200);
    await insertClick(BASE - DAY + 100);

    const res = await api(`/api/stats/summary?from=${BASE}&to=${BASE + DAY}`);
    const body = (await res.json()) as {
      current: { clicks: number };
      previous: { clicks: number };
    };

    expect(body.current.clicks).toBe(2);
    expect(body.previous.clicks).toBe(1);
  });

  it("rejects a range where from is after to", async () => {
    const res = await api(`/api/stats/summary?from=${BASE + DAY}&to=${BASE}`);
    expect(res.status).toBe(400);
  });

  it("rejects a missing range", async () => {
    expect((await api("/api/stats/summary")).status).toBe(400);
  });

  it("scopes to one link when linkId is supplied, and covers both when it is not", async () => {
    await insertClickFor(linkId, BASE + 100);
    await insertClickFor(linkId, BASE + 200);
    await insertClickFor(otherLinkId, BASE + 100);

    const scoped = await api(`/api/stats/summary?from=${BASE}&to=${BASE + DAY}&linkId=${linkId}`);
    const scopedBody = (await scoped.json()) as { current: { clicks: number } };
    expect(scopedBody.current.clicks).toBe(2);

    const all = await api(`/api/stats/summary?from=${BASE}&to=${BASE + DAY}`);
    const allBody = (await all.json()) as { current: { clicks: number } };
    expect(allBody.current.clicks).toBe(3);
  });
});

describe("GET /api/stats/timeseries", () => {
  it("returns buckets at the requested granularity", async () => {
    await insertClick(BASE + 100);
    await insertClick(BASE + 4000);

    const res = await api(`/api/stats/timeseries?from=${BASE}&to=${BASE + DAY}&granularity=hour`);
    const body = (await res.json()) as { buckets: unknown[] };
    expect(body.buckets).toHaveLength(2);
  });

  it("rejects an unknown granularity", async () => {
    const res = await api(`/api/stats/timeseries?from=${BASE}&to=${BASE + DAY}&granularity=eon`);
    expect(res.status).toBe(400);
  });

  it("rejects a range where from is after to", async () => {
    const res = await api(`/api/stats/timeseries?from=${BASE + DAY}&to=${BASE}&granularity=hour`);
    expect(res.status).toBe(400);
  });

  it("scopes to one link when linkId is supplied, and covers both when it is not", async () => {
    await insertClickFor(linkId, BASE + 100);
    await insertClickFor(otherLinkId, BASE + 200);

    const scoped = await api(
      `/api/stats/timeseries?from=${BASE}&to=${BASE + DAY}&granularity=hour&linkId=${linkId}`,
    );
    const scopedBody = (await scoped.json()) as { buckets: { clicks: number }[] };
    expect(scopedBody.buckets.reduce((sum, b) => sum + b.clicks, 0)).toBe(1);

    const all = await api(`/api/stats/timeseries?from=${BASE}&to=${BASE + DAY}&granularity=hour`);
    const allBody = (await all.json()) as { buckets: { clicks: number }[] };
    expect(allBody.buckets.reduce((sum, b) => sum + b.clicks, 0)).toBe(2);
  });
});

describe("GET /api/stats/dimension", () => {
  it("returns a ranked breakdown", async () => {
    await insertClick(BASE + 1, { country: "IT" });
    await insertClick(BASE + 2, { country: "IT" });
    await insertClick(BASE + 3, { country: "FR" });

    const res = await api(`/api/stats/dimension?name=country&from=${BASE}&to=${BASE + DAY}`);
    const body = (await res.json()) as { slices: { value: string; clicks: number }[] };
    expect(body.slices[0]).toMatchObject({ value: "IT", clicks: 2 });
  });

  it("rejects an unknown dimension name rather than interpolating it", async () => {
    const res = await api(
      `/api/stats/dimension?name=${encodeURIComponent("country; DROP TABLE links")}&from=${BASE}&to=${BASE + DAY}`,
    );
    expect(res.status).toBe(400);

    const tables = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='links'",
    ).first();
    expect(tables).not.toBeNull();
  });

  it("caps the limit", async () => {
    const res = await api(
      `/api/stats/dimension?name=country&from=${BASE}&to=${BASE + DAY}&limit=99999`,
    );
    expect(res.status).toBe(400);
  });

  it("rejects a range where from is after to", async () => {
    const res = await api(`/api/stats/dimension?name=country&from=${BASE + DAY}&to=${BASE}`);
    expect(res.status).toBe(400);
  });

  it("scopes to one link when linkId is supplied, and covers both when it is not", async () => {
    await insertClickFor(linkId, BASE + 1, { country: "IT" });
    await insertClickFor(otherLinkId, BASE + 2, { country: "FR" });

    const scoped = await api(
      `/api/stats/dimension?name=country&from=${BASE}&to=${BASE + DAY}&linkId=${linkId}`,
    );
    const scopedBody = (await scoped.json()) as { slices: { value: string }[] };
    expect(scopedBody.slices.map((s) => s.value)).toStrictEqual(["IT"]);

    const all = await api(`/api/stats/dimension?name=country&from=${BASE}&to=${BASE + DAY}`);
    const allBody = (await all.json()) as { slices: { value: string }[] };
    expect(allBody.slices.map((s) => s.value).sort()).toStrictEqual(["FR", "IT"]);
  });
});

describe("GET /api/stats/live", () => {
  it("returns the most recent clicks with their slug", async () => {
    await insertClick(BASE + 1);
    await insertClick(BASE + 2);

    const res = await api("/api/stats/live?limit=10");
    const body = (await res.json()) as { clicks: { slug: string; ts: number }[] };
    expect(body.clicks[0]?.slug).toBe("stats");
    expect(body.clicks[0]?.ts).toBe(BASE + 2);
  });

  it("maps every field of the most recent click from its own column", async () => {
    await insertClick(BASE + 1);
    const inserted = await env.DB.prepare(
      `INSERT INTO clicks (link_id, ts, visitor_hash, source, outcome, is_bot, country, city, device_type, browser, referrer_type)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        linkId,
        BASE + 2,
        "v-full",
        "qr",
        "expired",
        1,
        "US",
        "Chicago",
        "mobile",
        "Firefox",
        "search",
      )
      .run();
    const insertedId = inserted.meta.last_row_id;

    const res = await api("/api/stats/live?limit=10");
    const body = (await res.json()) as {
      clicks: {
        id: number;
        linkId: number;
        slug: string;
        ts: number;
        country: string;
        city: string;
        device: string;
        browser: string;
        referrerType: string;
        source: string;
        outcome: string;
        isBot: boolean;
      }[];
    };

    expect(body.clicks[0]).toStrictEqual({
      id: insertedId,
      linkId,
      slug: "stats",
      ts: BASE + 2,
      country: "US",
      city: "Chicago",
      device: "mobile",
      browser: "Firefox",
      referrerType: "search",
      source: "qr",
      outcome: "expired",
      isBot: true,
    });
  });

  it("caps the limit", async () => {
    const res = await api("/api/stats/live?limit=99999");
    expect(res.status).toBe(400);
  });

  it("scopes to one link when linkId is supplied, and covers both when it is not", async () => {
    await insertClickFor(linkId, BASE + 1);
    await insertClickFor(otherLinkId, BASE + 2);

    const scoped = await api(`/api/stats/live?limit=10&linkId=${linkId}`);
    const scopedBody = (await scoped.json()) as { clicks: { linkId: number }[] };
    expect(scopedBody.clicks).toHaveLength(1);
    expect(scopedBody.clicks[0]?.linkId).toBe(linkId);

    const all = await api("/api/stats/live?limit=10");
    const allBody = (await all.json()) as { clicks: { linkId: number }[] };
    expect(allBody.clicks).toHaveLength(2);
  });
});

describe("GET /api/stats/top-links", () => {
  it("ranks links by click count within the window", async () => {
    await insertClickFor(linkId, BASE + 1);
    await insertClickFor(linkId, BASE + 2);
    await insertClickFor(otherLinkId, BASE + 1);

    const res = await api(`/api/stats/top-links?from=${BASE}&to=${BASE + DAY}`);
    const body = (await res.json()) as { links: { id: number; clicks: number }[] };
    expect(body.links[0]).toMatchObject({ id: linkId, clicks: 2 });
    expect(body.links[1]).toMatchObject({ id: otherLinkId, clicks: 1 });
  });

  it("excludes clicks before the window", async () => {
    await insertClickFor(linkId, BASE + 1);
    await insertClickFor(linkId, BASE - DAY); // before the window

    const res = await api(`/api/stats/top-links?from=${BASE}&to=${BASE + DAY}`);
    const body = (await res.json()) as { links: { id: number; clicks: number }[] };
    expect(body.links).toStrictEqual([expect.objectContaining({ id: linkId, clicks: 1 })]);
  });

  it("excludes clicks at or after the window's upper bound", async () => {
    // The window is half-open ([from, to)): a click landing exactly on `to`
    // belongs to the *next* window, not this one. An off-by-one that made
    // the upper bound inclusive would double-count that instant across two
    // adjacent periods.
    await insertClickFor(linkId, BASE + 1);
    await insertClickFor(linkId, BASE + DAY); // exactly at `to`
    await insertClickFor(linkId, BASE + DAY + 1); // after `to`

    const res = await api(`/api/stats/top-links?from=${BASE}&to=${BASE + DAY}`);
    const body = (await res.json()) as { links: { id: number; clicks: number }[] };
    expect(body.links).toStrictEqual([expect.objectContaining({ id: linkId, clicks: 1 })]);
  });

  it("excludes bot clicks", async () => {
    await insertClickFor(linkId, BASE + 1, { is_bot: 0 });
    await insertClickFor(linkId, BASE + 2, { is_bot: 1 });

    const res = await api(`/api/stats/top-links?from=${BASE}&to=${BASE + DAY}`);
    const body = (await res.json()) as { links: { id: number; clicks: number }[] };
    expect(body.links[0]).toMatchObject({ id: linkId, clicks: 1 });
  });

  it("excludes soft-deleted links", async () => {
    await insertClickFor(linkId, BASE + 1);
    await insertClickFor(otherLinkId, BASE + 1);
    await softDeleteLink(env.DB, otherLinkId, BASE);

    const res = await api(`/api/stats/top-links?from=${BASE}&to=${BASE + DAY}`);
    const body = (await res.json()) as { links: { id: number }[] };
    expect(body.links.map((l) => l.id)).toStrictEqual([linkId]);
  });

  it("breaks ties by slug so the order is deterministic", async () => {
    // SQLite's default GROUP BY output order (no explicit ORDER BY) tracks
    // the grouping key, `l.id` — which is assigned in creation order. Given
    // `linkId`/`otherLinkId` alone, id order and slug order coincide
    // ("stats" is created first *and* sorts first), so a tie-break test
    // built on them would pass even with the `l.slug ASC` clause deleted —
    // confirmed by actually deleting it and re-running this test before
    // settling on this shape. These two links deliberately invert that:
    // `zLink` is created first (lower id) but sorts *after* `aLink`
    // (higher id) alphabetically, so only an explicit slug order — not
    // insertion order, not id order — can produce ["a-link", "z-link"].
    const zLink = await createLink(
      env.DB,
      { slug: "z-link", targetUrl: "https://z.example" },
      BASE,
    );
    const aLink = await createLink(
      env.DB,
      { slug: "a-link", targetUrl: "https://a.example" },
      BASE,
    );
    expect(zLink.id).toBeLessThan(aLink.id);

    await insertClickFor(zLink.id, BASE + 1);
    await insertClickFor(aLink.id, BASE + 2);

    const res = await api(`/api/stats/top-links?from=${BASE}&to=${BASE + DAY}`);
    const body = (await res.json()) as { links: { slug: string; clicks: number }[] };
    // Tied on click count — this test only proves the tie-break clause if
    // the two links are actually tied.
    expect(body.links.map((l) => l.clicks)).toStrictEqual([1, 1]);
    expect(body.links.map((l) => l.slug)).toStrictEqual(["a-link", "z-link"]);
  });

  it("rejects a range where from is after to", async () => {
    const res = await api(`/api/stats/top-links?from=${BASE + DAY}&to=${BASE}`);
    expect(res.status).toBe(400);
  });

  it("caps the limit", async () => {
    const res = await api(`/api/stats/top-links?from=${BASE}&to=${BASE + DAY}&limit=99999`);
    expect(res.status).toBe(400);
  });

  it("ignores linkId — the ranking is always across every link", async () => {
    // linkId has no meaning for a cross-link ranking; a caller who passes
    // it must not get a per-link result that looks honoured but silently
    // isn't. Same request with and without linkId must return the same
    // ranking.
    await insertClickFor(linkId, BASE + 1);
    await insertClickFor(otherLinkId, BASE + 2);
    await insertClickFor(otherLinkId, BASE + 3);

    const withLinkId = await api(
      `/api/stats/top-links?from=${BASE}&to=${BASE + DAY}&linkId=${linkId}`,
    );
    const withoutLinkId = await api(`/api/stats/top-links?from=${BASE}&to=${BASE + DAY}`);

    expect(withLinkId.status).toBe(200);
    expect(await withLinkId.json()).toStrictEqual(await withoutLinkId.json());
  });
});

describe("GET /api/stats/sparklines", () => {
  it("returns one series per link", async () => {
    await insertClick(Math.floor(Date.now() / 1000) - 3600);
    const res = await api("/api/stats/sparklines?days=7");
    const body = (await res.json()) as { series: Record<string, number[]> };
    expect(body.series[String(linkId)]).toHaveLength(7);
  });

  it("caps the days bound", async () => {
    const res = await api("/api/stats/sparklines?days=999");
    expect(res.status).toBe(400);
  });
});
