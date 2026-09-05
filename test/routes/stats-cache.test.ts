import { createExecutionContext, env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLink } from "../../src/db/links";
import { createSession, destroySession } from "../../src/db/sessions";
import { app } from "../../src/index";
import type { Env } from "../../src/types";

const NOW = Math.floor(Date.now() / 1000);
const DAY = 86400;
let token: string;
let id: number;
const queries: string[] = [];
let failRaw = false;
const db = new Proxy(env.DB, {
  get(target, property) {
    if (property === "prepare")
      return (sql: string) => {
        queries.push(sql);
        if (failRaw && /FROM clicks\b/.test(sql)) throw new Error("D1 unavailable");
        return target.prepare(sql);
      };
    const value = Reflect.get(target, property);
    return typeof value === "function" ? value.bind(target) : value;
  },
});
function path(kind = "dimension", from = NOW - 2 * DAY, to = NOW - DAY) {
  return `/api/stats/${kind}?name=city&from=${from}&to=${to}&linkId=${id}`;
}
function request(url = path(), session = token, retention = "180") {
  queries.length = 0;
  return app.fetch(
    new Request(`https://link.test${url}`, { headers: { cookie: `__Host-ml_session=${session}` } }),
    { ...env, DB: db, RAW_RETENTION_DAYS: retention } as unknown as Env,
    createExecutionContext(),
  );
}
function rawQueries() {
  return queries.filter((sql) => /FROM clicks\b/.test(sql));
}
async function click(ts = NOW - 2 * DAY + 10, city = "Rare city") {
  await env.DB.prepare(
    "INSERT INTO clicks (link_id, ts, visitor_hash, source, outcome, is_bot, city) VALUES (?, ?, ?, 'link', 'redirect', 0, ?)",
  )
    .bind(id, ts, "same-visitor", city)
    .run();
}
beforeEach(async () => {
  vi.spyOn(Date, "now").mockReturnValue(NOW * 1000);
  failRaw = false;
  token = await createSession(env.DB, null, NOW);
  id = (
    await createLink(
      env.DB,
      { slug: `cache-${crypto.randomUUID()}`, targetUrl: "https://example.com" },
      NOW,
    )
  ).id;
  await click();
});
afterEach(() => vi.restoreAllMocks());

describe("authenticated closed-period stats cache", () => {
  it.each(["summary", "timeseries", "dimension", "top-links"])(
    "%s misses then hits without raw queries and authenticates once",
    async (kind) => {
      const first = await request(path(kind));
      const body = await first.json();
      expect(rawQueries().length).toBeGreaterThan(0);
      const second = await request(path(kind));
      expect(await second.json()).toEqual(body);
      expect(rawQueries()).toHaveLength(0);
      expect(queries.filter((sql) => sql.startsWith("SELECT * FROM admin_sessions"))).toHaveLength(
        1,
      );
      expect(second.headers.get("Cache-Control")).toBe("private, no-store");
      expect(second.headers.get("x-stats-stored-at")).toBeNull();
    },
  );
  it("executes three raw scans for initial summary and timeseries, one for a requested dimension", async () => {
    await (await request(path("summary"))).arrayBuffer();
    expect(rawQueries()).toHaveLength(2);
    await (await request(path("timeseries"))).arrayBuffer();
    expect(rawQueries()).toHaveLength(1);
    await (await request()).arrayBuffer();
    expect(rawQueries()).toHaveLength(1);
  });
  it("keeps unsuppressed sensitive counts and expires at 60 seconds", async () => {
    expect(await (await request()).json()).toMatchObject({
      slices: [{ value: "Rare city", clicks: 1, uniques: 1 }],
    });
    await click();
    vi.mocked(Date.now).mockReturnValue((NOW + 59) * 1000);
    const cached = await (await request()).json();
    expect(cached).toMatchObject({
      slices: [{ clicks: 1 }],
      meta: { retentionCutoff: NOW + 59 - 180 * DAY },
    });
    expect(rawQueries()).toHaveLength(0);
    vi.mocked(Date.now).mockReturnValue((NOW + 60) * 1000);
    expect(await (await request()).json()).toMatchObject({ slices: [{ clicks: 2, uniques: 1 }] });
    expect(rawQueries()).toHaveLength(1);
  });
  it("isolates sessions, links, ranges and retention configuration", async () => {
    await (await request()).arrayBuffer();
    const second = await createSession(env.DB, null, NOW);
    for (const [url, session, retention] of [
      [path(), second, "180"],
      [path().replace(`linkId=${id}`, `linkId=${id + 1}`), token, "180"],
      [path("dimension", NOW - 3 * DAY), token, "180"],
      [path(), token, "90"],
    ]) {
      await (await request(url, session, retention)).arrayBuffer();
      expect(rawQueries()).toHaveLength(1);
    }
  });
  it.each(["revoked", "expired"])("rejects a %s session before a cache hit", async (state) => {
    await (await request()).arrayBuffer();
    if (state === "revoked") await destroySession(env.DB, token);
    else await env.DB.prepare("UPDATE admin_sessions SET expires_at = ?").bind(NOW).run();
    expect((await request()).status).toBe(401);
    expect(rawQueries()).toHaveLength(0);
  });
  it.each(["live", "sparklines", "open", "future", "truncated", "comparison"])(
    "never caches %s requests",
    async (kind) => {
      const cutoff = NOW - 180 * DAY;
      const url =
        kind === "live" || kind === "sparklines"
          ? `/api/stats/${kind}`
          : kind === "open"
            ? path("dimension", NOW - DAY, NOW)
            : kind === "future"
              ? path("dimension", NOW - DAY, NOW + DAY)
              : kind === "truncated"
                ? path("dimension", cutoff - 1, cutoff + DAY)
                : path("summary", cutoff + 10, cutoff + DAY);
      for (let i = 0; i < 2; i++) {
        await (await request(url)).arrayBuffer();
        expect(rawQueries().length).toBeGreaterThan(0);
      }
    },
  );
  it.each(["dimension", "summary"])(
    "rechecks moving retention for %s before serving a hit",
    async (kind) => {
      const cutoff = NOW - 180 * DAY;
      const from = cutoff + (kind === "summary" ? 20 : 10);
      const url = path(kind, from, from + 10);
      await click(cutoff + 11);
      await (await request(url)).arrayBuffer();
      vi.mocked(Date.now).mockReturnValue((NOW + 12) * 1000);
      const result = await (await request(url)).json();
      expect(rawQueries().length).toBeGreaterThan(0);
      expect(result).toMatchObject({ meta: { retentionCutoff: cutoff + 12 } });
    },
  );
  it.each(["match", "put"] as const)("falls back to D1 on cache %s failures", async (method) => {
    const failure = vi
      .spyOn(caches.default, method)
      .mockRejectedValue(new Error("cache unavailable"));
    const response = await request();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ slices: [{ clicks: 1 }] });
    expect(rawQueries()).toHaveLength(1);
    expect(failure).toHaveBeenCalledOnce();
  });
  it("does not cache invalid input or D1 errors", async () => {
    const invalid = `${path()}&limit=9999`;
    expect((await request(invalid)).status).toBe(400);
    expect((await request(invalid)).status).toBe(400);
    failRaw = true;
    expect((await request()).status).toBe(500);
    failRaw = false;
    expect((await request()).status).toBe(200);
    expect(rawQueries()).toHaveLength(1);
  });
});
