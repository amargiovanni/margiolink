import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

let cookie = "";

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM link_tags").run();
  await env.DB.prepare("DELETE FROM tags").run();
  await env.DB.prepare("DELETE FROM links").run();
  await env.DB.prepare("DELETE FROM admin_sessions").run();

  const res = await SELF.fetch("https://link.test/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "correct-horse-battery-staple" }),
  });
  cookie = (res.headers.get("set-cookie") ?? "").split(";")[0] as string;
});

function api(path: string, init: RequestInit = {}) {
  return SELF.fetch(`https://link.test${path}`, {
    ...init,
    headers: { "content-type": "application/json", cookie, ...(init.headers ?? {}) },
  });
}

async function createLinkViaApi(slug: string): Promise<number> {
  const res = await api("/api/links", {
    method: "POST",
    body: JSON.stringify({ targetUrl: "https://example.com", slug }),
  });
  return ((await res.json()) as { link: { id: number } }).link.id;
}

describe("tags", () => {
  it("creates and lists tags", async () => {
    const created = await api("/api/tags", {
      method: "POST",
      body: JSON.stringify({ name: "campaign", color: "#4338ca" }),
    });
    expect(created.status).toBe(201);

    const list = await api("/api/tags");
    const body = (await list.json()) as { tags: { name: string }[] };
    expect(body.tags.map((t) => t.name)).toEqual(["campaign"]);
  });

  it("rejects a duplicate tag name with 409", async () => {
    await api("/api/tags", {
      method: "POST",
      body: JSON.stringify({ name: "dup", color: "#000000" }),
    });
    const res = await api("/api/tags", {
      method: "POST",
      body: JSON.stringify({ name: "dup", color: "#111111" }),
    });
    expect(res.status).toBe(409);
  });

  it("rejects a colour that is not a hex value", async () => {
    const res = await api("/api/tags", {
      method: "POST",
      body: JSON.stringify({ name: "bad", color: "red" }),
    });
    expect(res.status).toBe(400);
  });

  it("assigns tags to a link and returns them on the link", async () => {
    const linkId = await createLinkViaApi("tagged");
    const tagRes = await api("/api/tags", {
      method: "POST",
      body: JSON.stringify({ name: "spring", color: "#16a34a" }),
    });
    const tagId = ((await tagRes.json()) as { tag: { id: number } }).tag.id;

    const assign = await api(`/api/links/${linkId}/tags`, {
      method: "PUT",
      body: JSON.stringify({ tagIds: [tagId] }),
    });
    expect(assign.status).toBe(200);

    const list = await api("/api/links");
    const body = (await list.json()) as { links: { tags: { name: string }[] }[] };
    expect(body.links[0]?.tags.map((t) => t.name)).toEqual(["spring"]);
  });

  it("replaces the whole tag set on assignment", async () => {
    const linkId = await createLinkViaApi("replace");
    const ids: number[] = [];
    for (const name of ["one", "two"]) {
      const res = await api("/api/tags", {
        method: "POST",
        body: JSON.stringify({ name, color: "#000000" }),
      });
      ids.push(((await res.json()) as { tag: { id: number } }).tag.id);
    }

    await api(`/api/links/${linkId}/tags`, {
      method: "PUT",
      body: JSON.stringify({ tagIds: ids }),
    });
    await api(`/api/links/${linkId}/tags`, {
      method: "PUT",
      body: JSON.stringify({ tagIds: [ids[1]] }),
    });

    const list = await api("/api/links");
    const body = (await list.json()) as { links: { tags: { name: string }[] }[] };
    expect(body.links[0]?.tags.map((t) => t.name)).toEqual(["two"]);
  });

  it("filters the link list by tag", async () => {
    const tagged = await createLinkViaApi("has-tag");
    await createLinkViaApi("no-tag");
    const tagRes = await api("/api/tags", {
      method: "POST",
      body: JSON.stringify({ name: "filter", color: "#000000" }),
    });
    const tagId = ((await tagRes.json()) as { tag: { id: number } }).tag.id;
    await api(`/api/links/${tagged}/tags`, {
      method: "PUT",
      body: JSON.stringify({ tagIds: [tagId] }),
    });

    const list = await api(`/api/links?tagId=${tagId}`);
    const body = (await list.json()) as { links: { slug: string }[] };
    expect(body.links.map((l) => l.slug)).toEqual(["has-tag"]);
  });

  it("deleting a tag detaches it from links without deleting them", async () => {
    const linkId = await createLinkViaApi("keeps");
    const tagRes = await api("/api/tags", {
      method: "POST",
      body: JSON.stringify({ name: "temp", color: "#000000" }),
    });
    const tagId = ((await tagRes.json()) as { tag: { id: number } }).tag.id;
    await api(`/api/links/${linkId}/tags`, {
      method: "PUT",
      body: JSON.stringify({ tagIds: [tagId] }),
    });

    expect((await api(`/api/tags/${tagId}`, { method: "DELETE" })).status).toBe(200);

    const list = await api("/api/links");
    const body = (await list.json()) as { links: { slug: string; tags: unknown[] }[] };
    expect(body.links).toHaveLength(1);
    expect(body.links[0]?.tags).toEqual([]);
  });
});
