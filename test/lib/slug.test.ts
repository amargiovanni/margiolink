import { describe, expect, it } from "vitest";
import { generateSlug, isReservedSlug, isValidSlugShape, normaliseSlug } from "../../src/lib/slug";

describe("generateSlug", () => {
  it("returns 7 characters by default", () => {
    expect(generateSlug()).toHaveLength(7);
  });

  it("honours a requested length", () => {
    expect(generateSlug(12)).toHaveLength(12);
  });

  it("never emits visually ambiguous characters", () => {
    const sample = Array.from({ length: 200 }, () => generateSlug(16)).join("");
    expect(sample).not.toMatch(/[01lio]/);
  });

  it("does not repeat within a large sample", () => {
    const seen = new Set(Array.from({ length: 2000 }, () => generateSlug()));
    expect(seen.size).toBe(2000);
  });
});

describe("normaliseSlug", () => {
  it("lowercases and trims", () => {
    expect(normaliseSlug("  MyLink  ")).toBe("mylink");
  });
});

describe("isValidSlugShape", () => {
  it.each(["abc", "my-link", "my_link", "a1", "x".repeat(64)])("accepts %s", (slug) => {
    expect(isValidSlugShape(slug)).toBe(true);
  });

  it.each(["", "-leading", "_leading", "has space", "has/slash", "x".repeat(65), "Uppercase"])(
    "rejects %s",
    (slug) => {
      expect(isValidSlugShape(slug)).toBe(false);
    },
  );
});

/** Two of these — `app` and `index` — name real files in `web/dist`, and
 *  Cloudflare's asset router answers a matching path with the file before the
 *  Worker runs. A link on either slug would serve a page instead of
 *  redirecting, with no request reaching any code that could explain why, so
 *  the documents the build produces and this list have to stay in step. */
describe("isReservedSlug", () => {
  it.each(["app", "index", "api", "privacy", "assets", "robots.txt", "favicon.ico", "_health"])(
    "reserves %s",
    (slug) => {
      expect(isReservedSlug(slug)).toBe(true);
    },
  );

  it("is case-insensitive", () => {
    expect(isReservedSlug("APP")).toBe(true);
  });

  it("allows ordinary slugs", () => {
    expect(isReservedSlug("launch")).toBe(false);
  });
});
