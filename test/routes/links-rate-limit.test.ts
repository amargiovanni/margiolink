import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

let cookie = "";

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM links").run();
  await env.DB.prepare("DELETE FROM admin_sessions").run();

  const res = await SELF.fetch("https://link.test/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "correct-horse-battery-staple" }),
  });
  cookie = (res.headers.get("set-cookie") ?? "").split(";")[0] as string;
});

function create() {
  return SELF.fetch("https://link.test/api/links", {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ targetUrl: "https://example.com" }),
  });
}

async function seedLinks(count: number, createdAt: number) {
  const statements = [];
  for (let i = 0; i < count; i++) {
    statements.push(
      env.DB.prepare(
        "INSERT INTO links (slug, target_url, is_active, created_at, updated_at) VALUES (?, 'https://e.com', 1, ?, ?)",
      ).bind(`seed${i}`, createdAt, createdAt),
    );
  }
  await env.DB.batch(statements);
}

describe("POST /api/links rate limiting", () => {
  it("allows creation under the hourly limit", async () => {
    expect((await create()).status).toBe(201);
  });

  it("refuses with 429 and Retry-After once the hourly limit is reached", async () => {
    await seedLinks(120, Math.floor(Date.now() / 1000));

    const res = await create();

    expect(res.status).toBe(429);
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await res.json()) as unknown).toMatchObject({ error: "rate_limited" });
  });

  it("ignores links created more than an hour ago", async () => {
    await seedLinks(120, Math.floor(Date.now() / 1000) - 7200);
    expect((await create()).status).toBe(201);
  });

  it("counts soft-deleted links too, so deleting does not reset the budget", async () => {
    const now = Math.floor(Date.now() / 1000);
    await seedLinks(120, now);
    await env.DB.prepare("UPDATE links SET deleted_at = ?").bind(now).run();

    expect((await create()).status).toBe(429);
  });
});
