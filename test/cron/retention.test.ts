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

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM clicks").run();
  await env.DB.prepare("DELETE FROM links").run();
  await env.DB.prepare("DELETE FROM admin_sessions").run();
  await env.DB.prepare("DELETE FROM login_attempts").run();
  linkId = (await createLink(env.DB, { slug: "ret", targetUrl: "https://e.com" }, NOW)).id;
});

describe("runRetention", () => {
  it("deletes raw clicks older than the retention window and keeps newer ones", async () => {
    await insert(NOW - 181 * DAY);
    await insert(NOW - 179 * DAY);

    const result = await runRetention(env.DB, NOW, 180);

    expect(result.clicks).toBe(1);
    const remaining = await env.DB.prepare("SELECT COUNT(*) AS n FROM clicks").first<{
      n: number;
    }>();
    expect(remaining?.n).toBe(1);
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
});
