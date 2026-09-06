import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { deleteClicksBefore, insertClick } from "../../src/db/clicks";
import { createLink } from "../../src/db/links";
import { buildRequestContext } from "../../src/lib/request-context";

const NOW = Date.parse("2026-09-01T00:00:00Z") / 1000;
const DAY = 86_400;
let linkId = 0;

function dayOf(ts: number): string {
  return new Date(ts * 1000).toISOString().slice(0, 10);
}

async function insertClicks(ts: number, count: number) {
  for (let i = 0; i < count; i++) {
    await env.DB.prepare(
      `INSERT INTO clicks (link_id, ts, visitor_hash, source, outcome, is_bot)
       VALUES (?, ?, 'v', 'link', 'redirect', 0)`,
    )
      .bind(linkId, ts)
      .run();
  }
  await env.DB.prepare(
    "INSERT OR IGNORE INTO click_daily (day, link_id, clicks, uniques, bots) VALUES (?, ?, ?, 1, 0)",
  )
    .bind(dayOf(ts), linkId, count)
    .run();
}

async function remaining(): Promise<number> {
  const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM clicks").first<{ n: number }>();
  return row?.n ?? 0;
}

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM clicks").run();
  await env.DB.prepare("DELETE FROM click_daily").run();
  await env.DB.prepare("DELETE FROM links").run();
  linkId = (await createLink(env.DB, { slug: "batch", targetUrl: "https://e.com" }, NOW)).id;
});

describe("insertClick", () => {
  it("leaves legacy UTM term and content columns empty", async () => {
    const context = buildRequestContext(
      new Request(
        "https://link.test/batch?utm_source=newsletter&utm_medium=email&utm_campaign=launch&utm_term=person&utm_content=hero",
      ),
    );

    await insertClick(env.DB, {
      linkId,
      ts: NOW,
      visitorHash: "visitor",
      source: context.source,
      outcome: "redirect",
      isBot: false,
      geo: context.geo,
      client: context.client,
      referrer: context.referrer,
      utm: context.utm,
    });

    const row = await env.DB.prepare("SELECT utm_source, utm_term, utm_content FROM clicks").first<{
      utm_source: string | null;
      utm_term: string | null;
      utm_content: string | null;
    }>();

    expect(row).toEqual({ utm_source: "newsletter", utm_term: null, utm_content: null });
  });
});

describe("deleteClicksBefore", () => {
  it("drains a backlog across several bounded batches and reports the true total", async () => {
    // One unbounded DELETE fails as a unit: if a backlog ever exceeds D1's
    // statement limits it fails identically every night, and retention is
    // silently never enforced. Batching makes partial progress instead.
    await insertClicks(NOW - 200 * DAY, 7);

    const result = await deleteClicksBefore(env.DB, NOW - 180 * DAY, 2, 100);

    expect(result.deleted).toBe(7);
    expect(result.capped).toBe(false);
    expect(await remaining()).toBe(0);
  });

  it("stops at the iteration cap and says so, rather than looping forever", async () => {
    await insertClicks(NOW - 200 * DAY, 7);

    const result = await deleteClicksBefore(env.DB, NOW - 180 * DAY, 2, 2);

    expect(result.deleted).toBe(4);
    expect(result.capped).toBe(true);
    expect(await remaining()).toBe(3);
  });

  it("leaves rows inside the window alone however many batches it runs", async () => {
    await insertClicks(NOW - 200 * DAY, 3);
    await insertClicks(NOW - 10 * DAY, 4);

    const result = await deleteClicksBefore(env.DB, NOW - 180 * DAY, 1, 100);

    expect(result.deleted).toBe(3);
    expect(result.capped).toBe(false);
    expect(await remaining()).toBe(4);
  });

  it("reports nothing deleted and no cap on an empty backlog", async () => {
    await insertClicks(NOW - 10 * DAY, 2);

    const result = await deleteClicksBefore(env.DB, NOW - 180 * DAY, 5, 100);

    expect(result).toEqual({ deleted: 0, capped: false });
  });
});
