import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { tagsForLinks } from "../../src/db/tags";

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM link_tags").run();
  await env.DB.prepare("DELETE FROM tags").run();
  await env.DB.prepare("DELETE FROM links").run();
});

describe("tagsForLinks", () => {
  it("returns an empty Map and does not throw for an empty link-id array", async () => {
    await expect(tagsForLinks(env.DB, [])).resolves.toEqual(new Map());
  });
});
