import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { recentClicks } from "../../src/db/clicks";
import { createLink } from "../../src/db/links";
import { recordClick } from "../../src/ingest/record-click";
import { buildRequestContext } from "../../src/lib/request-context";

const NOW = 1_772_000_000;

function contextFor(url: string, headers: Record<string, string> = {}) {
  const req = new Request(url, { headers });
  Object.defineProperty(req, "cf", {
    value: { country: "IT", city: "Milan", continent: "EU", colo: "MXP" },
    configurable: true,
  });
  return buildRequestContext(req);
}

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM clicks").run();
  await env.DB.prepare("DELETE FROM links").run();
});

describe("recordClick", () => {
  it("writes a row carrying geography, client and referrer", async () => {
    const link = await createLink(env.DB, { slug: "abc", targetUrl: "https://example.com" }, NOW);
    await recordClick(env, {
      linkId: link.id,
      slug: "abc",
      outcome: "redirect",
      context: contextFor("https://link.test/abc?utm_source=news", {
        "cf-connecting-ip": "203.0.113.9",
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
        referer: "https://x.com/post/1",
      }),
      now: NOW,
    });

    const row = await env.DB.prepare("SELECT * FROM clicks").first<Record<string, unknown>>();
    expect(row?.country).toBe("IT");
    expect(row?.city).toBe("Milan");
    expect(row?.referrer_type).toBe("social");
    expect(row?.utm_source).toBe("news");
    expect(row?.outcome).toBe("redirect");
    expect(row?.source).toBe("link");
    expect(row?.is_bot).toBe(0);
    expect(row?.link_id).toBe(link.id);
  });

  it("never stores the IP address or the raw user-agent", async () => {
    const link = await createLink(env.DB, { slug: "abc", targetUrl: "https://example.com" }, NOW);
    const ua = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/140.0.0.0 Safari/537.36";
    await recordClick(env, {
      linkId: link.id,
      slug: "abc",
      outcome: "redirect",
      context: contextFor("https://link.test/abc", {
        "cf-connecting-ip": "203.0.113.9",
        "user-agent": ua,
      }),
      now: NOW,
    });

    const row = await env.DB.prepare("SELECT * FROM clicks").first<Record<string, unknown>>();
    const serialised = JSON.stringify(row);
    expect(serialised).not.toContain("203.0.113.9");
    expect(serialised).not.toContain("AppleWebKit");
    expect(row?.visitor_hash).toMatch(/^[0-9a-f]{32}$/);
  });

  it("gives the same visitor the same hash twice on the same day", async () => {
    const link = await createLink(env.DB, { slug: "abc", targetUrl: "https://example.com" }, NOW);
    const context = contextFor("https://link.test/abc", {
      "cf-connecting-ip": "203.0.113.9",
      "user-agent": "UA/1",
    });
    await recordClick(env, {
      linkId: link.id,
      slug: "abc",
      outcome: "redirect",
      context,
      now: NOW,
    });
    await recordClick(env, {
      linkId: link.id,
      slug: "abc",
      outcome: "redirect",
      context,
      now: NOW + 120,
    });

    const { results } = await env.DB.prepare("SELECT DISTINCT visitor_hash FROM clicks").all();
    expect(results).toHaveLength(1);
  });

  it("marks a QR scan as such", async () => {
    const link = await createLink(env.DB, { slug: "abc", targetUrl: "https://example.com" }, NOW);
    await recordClick(env, {
      linkId: link.id,
      slug: "abc",
      outcome: "redirect",
      context: contextFor("https://link.test/abc?s=qr"),
      now: NOW,
    });
    const row = await env.DB.prepare("SELECT source FROM clicks").first<{ source: string }>();
    expect(row?.source).toBe("qr");
  });

  it("swallows database errors so a redirect is never affected", async () => {
    await expect(
      recordClick(env, {
        linkId: 999_999,
        slug: "missing",
        outcome: "redirect",
        context: contextFor("https://link.test/missing"),
        now: NOW,
      }),
    ).resolves.toBeUndefined();
  });
});

describe("recentClicks", () => {
  it("returns the newest clicks with their slug", async () => {
    const link = await createLink(env.DB, { slug: "feed", targetUrl: "https://example.com" }, NOW);
    for (let i = 0; i < 3; i++) {
      await recordClick(env, {
        linkId: link.id,
        slug: "feed",
        outcome: "redirect",
        context: contextFor("https://link.test/feed", { "cf-connecting-ip": `1.1.1.${i}` }),
        now: NOW + i,
      });
    }
    const feed = await recentClicks(env.DB, 2);
    expect(feed).toHaveLength(2);
    expect(feed[0]?.ts).toBe(NOW + 2);
    expect(feed[0]?.slug).toBe("feed");
  });
});
