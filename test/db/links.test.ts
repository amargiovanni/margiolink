import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import {
  createLink,
  findById,
  findBySlug,
  listLinks,
  restoreLink,
  SlugTakenError,
  softDeleteLink,
  updateLink,
} from "../../src/db/links";

const NOW = 1_772_000_000;

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM links").run();
});

describe("createLink", () => {
  it("generates a slug when none is given", async () => {
    const link = await createLink(env.DB, { targetUrl: "https://example.com" }, NOW);
    expect(link.slug).toHaveLength(7);
    expect(link.target_url).toBe("https://example.com");
    expect(link.is_active).toBe(1);
    expect(link.created_at).toBe(NOW);
  });

  it("uses an explicit slug", async () => {
    const link = await createLink(
      env.DB,
      { slug: "launch", targetUrl: "https://example.com" },
      NOW,
    );
    expect(link.slug).toBe("launch");
  });

  it("throws SlugTakenError when an explicit slug is already used", async () => {
    await createLink(env.DB, { slug: "launch", targetUrl: "https://example.com" }, NOW);
    await expect(
      createLink(env.DB, { slug: "launch", targetUrl: "https://other.com" }, NOW),
    ).rejects.toBeInstanceOf(SlugTakenError);
  });

  it("stores optional fields", async () => {
    const link = await createLink(
      env.DB,
      {
        targetUrl: "https://example.com",
        title: "Launch",
        description: "Spring campaign",
        expiresAt: NOW + 3600,
        expiredUrl: "https://example.com/over",
        passwordHash: "deadbeef",
        passwordSalt: "cafe",
      },
      NOW,
    );
    expect(link.title).toBe("Launch");
    expect(link.expires_at).toBe(NOW + 3600);
    expect(link.expired_url).toBe("https://example.com/over");
    expect(link.password_hash).toBe("deadbeef");
  });
});

describe("findBySlug", () => {
  it("finds a link", async () => {
    await createLink(env.DB, { slug: "found", targetUrl: "https://example.com" }, NOW);
    expect((await findBySlug(env.DB, "found"))?.slug).toBe("found");
  });

  it("returns null for an unknown slug", async () => {
    expect(await findBySlug(env.DB, "nothing")).toBeNull();
  });

  it("still returns soft-deleted links so the caller decides", async () => {
    const link = await createLink(env.DB, { slug: "gone", targetUrl: "https://example.com" }, NOW);
    await softDeleteLink(env.DB, link.id, NOW);
    expect((await findBySlug(env.DB, "gone"))?.deleted_at).toBe(NOW);
  });
});

describe("updateLink", () => {
  it("patches only the given fields and bumps updated_at", async () => {
    const link = await createLink(
      env.DB,
      { slug: "patch", targetUrl: "https://example.com", title: "Before" },
      NOW,
    );
    const updated = await updateLink(
      env.DB,
      link.id,
      { targetUrl: "https://changed.com" },
      NOW + 60,
    );
    expect(updated?.target_url).toBe("https://changed.com");
    expect(updated?.title).toBe("Before");
    expect(updated?.updated_at).toBe(NOW + 60);
  });

  it("toggles active state", async () => {
    const link = await createLink(env.DB, { targetUrl: "https://example.com" }, NOW);
    const updated = await updateLink(env.DB, link.id, { isActive: false }, NOW);
    expect(updated?.is_active).toBe(0);
  });

  it("returns null for an unknown id", async () => {
    expect(await updateLink(env.DB, 9999, { title: "x" }, NOW)).toBeNull();
  });
});

describe("soft delete and restore", () => {
  it("round-trips", async () => {
    const link = await createLink(env.DB, { targetUrl: "https://example.com" }, NOW);
    expect(await softDeleteLink(env.DB, link.id, NOW)).toBe(true);
    expect((await findById(env.DB, link.id))?.deleted_at).toBe(NOW);
    expect(await restoreLink(env.DB, link.id, NOW + 1)).toBe(true);
    expect((await findById(env.DB, link.id))?.deleted_at).toBeNull();
  });
});

describe("listLinks", () => {
  let taggedTagId: number;
  let emptyTagId: number;

  beforeEach(async () => {
    await env.DB.prepare("DELETE FROM link_tags").run();
    await env.DB.prepare("DELETE FROM tags").run();

    const alpha = await createLink(
      env.DB,
      { slug: "alpha", targetUrl: "https://a.com", title: "Alpha" },
      NOW,
    );
    const beta = await createLink(
      env.DB,
      { slug: "beta", targetUrl: "https://b.com", title: "Beta" },
      NOW + 1,
    );
    const gamma = await createLink(env.DB, { slug: "gamma", targetUrl: "https://c.com" }, NOW + 2);
    await updateLink(env.DB, gamma.id, { isActive: false }, NOW + 2);
    const deleted = await createLink(
      env.DB,
      { slug: "delta", targetUrl: "https://d.com" },
      NOW + 3,
    );
    await softDeleteLink(env.DB, deleted.id, NOW + 3);

    const taggedTag = await env.DB.prepare(
      "INSERT INTO tags (name, color) VALUES (?, ?) RETURNING id",
    )
      .bind("launch", "#fff")
      .first<{ id: number }>();
    const emptyTag = await env.DB.prepare(
      "INSERT INTO tags (name, color) VALUES (?, ?) RETURNING id",
    )
      .bind("empty", "#000")
      .first<{ id: number }>();
    if (!taggedTag || !emptyTag) throw new Error("Failed to insert tag fixtures");
    taggedTagId = taggedTag.id;
    emptyTagId = emptyTag.id;

    await env.DB.prepare("INSERT INTO link_tags (link_id, tag_id) VALUES (?, ?)")
      .bind(alpha.id, taggedTagId)
      .run();
    await env.DB.prepare("INSERT INTO link_tags (link_id, tag_id) VALUES (?, ?)")
      .bind(beta.id, taggedTagId)
      .run();
    await env.DB.prepare("INSERT INTO link_tags (link_id, tag_id) VALUES (?, ?)")
      .bind(gamma.id, taggedTagId)
      .run();
  });

  it("excludes deleted links by default and sorts newest first", async () => {
    const { items, total } = await listLinks(env.DB, {}, NOW + 10);
    expect(items.map((l) => l.slug)).toEqual(["gamma", "beta", "alpha"]);
    expect(total).toBe(3);
  });

  it("filters to active links", async () => {
    const { items } = await listLinks(env.DB, { status: "active" }, NOW + 10);
    expect(items.map((l) => l.slug)).toEqual(["beta", "alpha"]);
  });

  it("filters to inactive links", async () => {
    const { items } = await listLinks(env.DB, { status: "inactive" }, NOW + 10);
    expect(items.map((l) => l.slug)).toEqual(["gamma"]);
  });

  it("lists deleted links on request", async () => {
    const { items } = await listLinks(env.DB, { status: "deleted" }, NOW + 10);
    expect(items.map((l) => l.slug)).toEqual(["delta"]);
  });

  it("searches slug and title", async () => {
    expect((await listLinks(env.DB, { search: "alph" }, NOW + 10)).items).toHaveLength(1);
    expect((await listLinks(env.DB, { search: "Beta" }, NOW + 10)).items).toHaveLength(1);
  });

  it("paginates while reporting the full total", async () => {
    const page = await listLinks(env.DB, { limit: 2, offset: 1 }, NOW + 10);
    expect(page.items.map((l) => l.slug)).toEqual(["beta", "alpha"]);
    expect(page.total).toBe(3);
  });

  it("filters by tagId alone", async () => {
    const { items, total } = await listLinks(env.DB, { tagId: taggedTagId }, NOW + 10);
    expect(items.map((l) => l.slug)).toEqual(["gamma", "beta", "alpha"]);
    expect(total).toBe(3);
  });

  it("combines tagId with search", async () => {
    const { items } = await listLinks(env.DB, { tagId: taggedTagId, search: "Beta" }, NOW + 10);
    expect(items.map((l) => l.slug)).toEqual(["beta"]);
  });

  it("combines tagId with status active", async () => {
    const { items } = await listLinks(env.DB, { tagId: taggedTagId, status: "active" }, NOW + 10);
    expect(items.map((l) => l.slug)).toEqual(["beta", "alpha"]);
  });

  it("combines tagId with limit/offset while reporting the full tagged total", async () => {
    const page = await listLinks(env.DB, { tagId: taggedTagId, limit: 2, offset: 1 }, NOW + 10);
    expect(page.items.map((l) => l.slug)).toEqual(["beta", "alpha"]);
    expect(page.total).toBe(3);
  });

  it("returns an empty list for a tag with no links", async () => {
    const { items, total } = await listLinks(env.DB, { tagId: emptyTagId }, NOW + 10);
    expect(items).toEqual([]);
    expect(total).toBe(0);
  });
});
