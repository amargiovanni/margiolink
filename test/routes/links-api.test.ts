import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

const CREDENTIALS = { username: "admin", password: "correct-horse-battery-staple" };
let cookie = "";

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM clicks").run();
  await env.DB.prepare("DELETE FROM links").run();
  await env.DB.prepare("DELETE FROM admin_sessions").run();

  const res = await SELF.fetch("https://link.test/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(CREDENTIALS),
  });
  cookie = (res.headers.get("set-cookie") ?? "").split(";")[0] as string;
});

function api(path: string, init: RequestInit = {}) {
  return SELF.fetch(`https://link.test${path}`, {
    ...init,
    headers: { "content-type": "application/json", cookie, ...(init.headers ?? {}) },
  });
}

describe("POST /api/links", () => {
  it("creates a link and returns its short URL", async () => {
    const res = await api("/api/links", {
      method: "POST",
      body: JSON.stringify({ targetUrl: "https://example.com", title: "Example" }),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as { link: Record<string, unknown> };
    expect(body.link.shortUrl).toBe(`https://link.test/${body.link.slug}`);
    expect(body.link.hasPassword).toBe(false);
  });

  it("accepts a custom slug", async () => {
    const res = await api("/api/links", {
      method: "POST",
      body: JSON.stringify({ targetUrl: "https://example.com", slug: "Launch-2026" }),
    });
    const body = (await res.json()) as { link: { slug: string } };
    expect(body.link.slug).toBe("launch-2026");
  });

  it("rejects a duplicate slug with 409", async () => {
    await api("/api/links", {
      method: "POST",
      body: JSON.stringify({ targetUrl: "https://example.com", slug: "dup" }),
    });
    const res = await api("/api/links", {
      method: "POST",
      body: JSON.stringify({ targetUrl: "https://other.com", slug: "dup" }),
    });
    expect(res.status).toBe(409);
  });

  it("rejects a reserved slug", async () => {
    const res = await api("/api/links", {
      method: "POST",
      body: JSON.stringify({ targetUrl: "https://example.com", slug: "api" }),
    });
    expect(res.status).toBe(422);
    expect((await res.json()) as unknown).toMatchObject({ error: "reserved_slug" });
  });

  it("rejects a malformed slug", async () => {
    const res = await api("/api/links", {
      method: "POST",
      body: JSON.stringify({ targetUrl: "https://example.com", slug: "has space" }),
    });
    expect(res.status).toBe(422);
  });

  it.each([
    ["javascript:alert(1)", "unsupported_protocol"],
    ["https://link.test/loop", "self_reference"],
    ["nonsense", "invalid"],
  ])("rejects the destination %s", async (targetUrl, reason) => {
    const res = await api("/api/links", { method: "POST", body: JSON.stringify({ targetUrl }) });
    expect(res.status).toBe(422);
    expect((await res.json()) as unknown).toMatchObject({ error: reason });
  });

  it("stores a password as a hash and never returns it", async () => {
    const res = await api("/api/links", {
      method: "POST",
      body: JSON.stringify({ targetUrl: "https://example.com", password: "hunter2" }),
    });
    const body = (await res.json()) as { link: { id: number; hasPassword: boolean } };
    expect(body.link.hasPassword).toBe(true);
    expect(JSON.stringify(body)).not.toContain("hunter2");

    const row = await env.DB.prepare("SELECT password_hash FROM links WHERE id = ?")
      .bind(body.link.id)
      .first<{ password_hash: string }>();
    expect(row?.password_hash).not.toBe("hunter2");
  });
});

describe("GET /api/links", () => {
  it("lists links newest first with a total", async () => {
    for (const slug of ["one", "two", "three"]) {
      await api("/api/links", {
        method: "POST",
        body: JSON.stringify({ targetUrl: `https://example.com/${slug}`, slug }),
      });
    }
    const res = await api("/api/links");
    const body = (await res.json()) as { links: { slug: string }[]; total: number };
    expect(body.links.map((l) => l.slug)).toEqual(["three", "two", "one"]);
    expect(body.total).toBe(3);
  });

  it("filters by search term", async () => {
    await api("/api/links", {
      method: "POST",
      body: JSON.stringify({ targetUrl: "https://example.com", slug: "findme" }),
    });
    const res = await api("/api/links?search=findm");
    const body = (await res.json()) as { links: unknown[] };
    expect(body.links).toHaveLength(1);
  });
});

describe("PATCH and DELETE", () => {
  async function createOne() {
    const res = await api("/api/links", {
      method: "POST",
      body: JSON.stringify({ targetUrl: "https://example.com", slug: "editme" }),
    });
    return ((await res.json()) as { link: { id: number } }).link.id;
  }

  it("updates the destination", async () => {
    const id = await createOne();
    const res = await api(`/api/links/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ targetUrl: "https://changed.com" }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()) as unknown).toMatchObject({
      link: { targetUrl: "https://changed.com/" },
    });
  });

  it("rejects an unsupported protocol on update", async () => {
    const id = await createOne();
    const res = await api(`/api/links/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ targetUrl: "javascript:alert(1)" }),
    });
    expect(res.status).toBe(422);
    expect((await res.json()) as unknown).toMatchObject({ error: "unsupported_protocol" });
  });

  it("rejects a self-referencing destination on update", async () => {
    const id = await createOne();
    const res = await api(`/api/links/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ targetUrl: "https://link.test/loop" }),
    });
    expect(res.status).toBe(422);
    expect((await res.json()) as unknown).toMatchObject({ error: "self_reference" });
  });

  it("rejects an invalid expired-url fallback on update", async () => {
    const id = await createOne();
    const res = await api(`/api/links/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ expiredUrl: "javascript:alert(1)" }),
    });
    expect(res.status).toBe(422);
    expect((await res.json()) as unknown).toMatchObject({ error: "invalid_expired_url" });
  });

  it("rejects an invalid expired-url fallback on create", async () => {
    const res = await api("/api/links", {
      method: "POST",
      body: JSON.stringify({ targetUrl: "https://example.com", expiredUrl: "not a url" }),
    });
    expect(res.status).toBe(422);
    expect((await res.json()) as unknown).toMatchObject({ error: "invalid_expired_url" });
  });

  it("deactivates a link", async () => {
    const id = await createOne();
    await api(`/api/links/${id}`, { method: "PATCH", body: JSON.stringify({ isActive: false }) });
    const res = await SELF.fetch("https://link.test/editme", { redirect: "manual" });
    expect(res.status).toBe(410);
  });

  it("removes a password when told to", async () => {
    const created = await api("/api/links", {
      method: "POST",
      body: JSON.stringify({ targetUrl: "https://example.com", password: "hunter2" }),
    });
    const id = ((await created.json()) as { link: { id: number } }).link.id;

    const res = await api(`/api/links/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ password: null }),
    });
    expect((await res.json()) as unknown).toMatchObject({ link: { hasPassword: false } });
  });

  it("soft-deletes and restores", async () => {
    const id = await createOne();

    expect((await api(`/api/links/${id}`, { method: "DELETE" })).status).toBe(200);
    expect((await SELF.fetch("https://link.test/editme", { redirect: "manual" })).status).toBe(404);

    expect((await api(`/api/links/${id}/restore`, { method: "POST" })).status).toBe(200);
    expect((await SELF.fetch("https://link.test/editme", { redirect: "manual" })).status).toBe(302);
  });

  it("returns 404 for an unknown id", async () => {
    expect((await api("/api/links/999999")).status).toBe(404);
  });
});

describe("GET /api/links/:id/qr.svg", () => {
  it("returns an SVG encoding the short URL", async () => {
    const created = await api("/api/links", {
      method: "POST",
      body: JSON.stringify({ targetUrl: "https://example.com", slug: "qrtest" }),
    });
    const id = ((await created.json()) as { link: { id: number } }).link.id;

    const res = await api(`/api/links/${id}/qr.svg`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("image/svg+xml");
    expect(await res.text()).toContain("<svg");
  });
});
