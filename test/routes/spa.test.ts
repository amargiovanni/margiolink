import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { createLink } from "../../src/db/links";

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM links").run();
});

describe("the dashboard shell", () => {
  it("serves HTML at /app", async () => {
    const res = await SELF.fetch("https://link.test/app");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
  });

  it("serves the same document for a nested client route", async () => {
    const res = await SELF.fetch("https://link.test/app/links");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
  });
});

describe("the shell does not shadow the Worker", () => {
  it("leaves a short link redirecting", async () => {
    await createLink(
      env.DB,
      { slug: "notthedashboard", targetUrl: "https://example.com/" },
      Math.floor(Date.now() / 1000),
    );
    const res = await SELF.fetch("https://link.test/notthedashboard", { redirect: "manual" });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://example.com/");
  });

  it("leaves an unknown slug returning 404 rather than the dashboard", async () => {
    const res = await SELF.fetch("https://link.test/nothing-here", { redirect: "manual" });
    expect(res.status).toBe(404);
  });

  it("leaves the API answering JSON", async () => {
    const res = await SELF.fetch("https://link.test/api/links");
    expect(res.status).toBe(401);
    expect(res.headers.get("content-type")).toContain("application/json");
  });

  it("leaves the health endpoint alone", async () => {
    expect((await SELF.fetch("https://link.test/_health")).status).toBe(200);
  });
});
