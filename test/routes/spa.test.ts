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

  /**
   * `/app` returning HTML proves nothing about whether the *scripts that
   * HTML references* can actually be fetched. A wrong Vite `base` would
   * still produce a valid document — one pointing at URLs that 404 — and
   * every other test here would stay green while the dashboard rendered as
   * a blank page. This walks the built markup itself rather than assuming
   * a URL shape.
   *
   * The built references are root-relative (`/assets/...`), not under
   * `/app/`: Cloudflare's static-asset router serves `web/dist/**` at the
   * site root with no extra prefix, so `web/dist/assets/x.js` answers to
   * `/assets/x.js`, never `/app/assets/x.js` — nothing on disk maps to that
   * path, so a request for it would fall through to the Worker's `/app/*`
   * catch-all and get served the shell's own HTML instead of the script,
   * 200 and wrong content. `assets` is reserved in `src/lib/slug.ts`
   * specifically so a short link can never collide with this path.
   *
   * The asset fetches below go through `env.ASSETS.fetch` directly, not
   * `SELF.fetch`. Confirmed by direct test: `SELF.fetch` in this harness
   * invokes the Worker's exported `fetch` handler only — it does not
   * simulate Cloudflare's "static assets are served before the Worker runs"
   * behaviour (even `SELF.fetch(".../index.html")`, a real top-level file,
   * 404s through it). `env.ASSETS.fetch` is the binding the Worker itself
   * would be given in production, so it answers the question this test
   * actually needs answered — does the built reference correspond to a
   * real file — without depending on routing behaviour this harness
   * doesn't reproduce.
   */
  it("serves module scripts and stylesheets that actually resolve", async () => {
    const shell = await SELF.fetch("https://link.test/app");
    const body = await shell.text();

    const isDefined = (value: string | undefined): value is string => value !== undefined;
    const scriptSrcs = [...body.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)]
      .map((m) => m[1])
      .filter(isDefined);
    const stylesheetHrefs = [...body.matchAll(/<link[^>]*\brel="stylesheet"[^>]*\shref="([^"]+)"/g)]
      .map((m) => m[1])
      .filter(isDefined);

    // Anti-vacuity guard: without this, a regex that matched nothing would
    // let the assertions below pass by iterating over empty arrays.
    expect(scriptSrcs.length).toBeGreaterThan(0);
    expect(stylesheetHrefs.length).toBeGreaterThan(0);

    for (const src of scriptSrcs) {
      expect(src.startsWith("/assets/")).toBe(true);
      const res = await env.ASSETS.fetch(new URL(src, "https://link.test/"));
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("javascript");
    }

    for (const href of stylesheetHrefs) {
      expect(href.startsWith("/assets/")).toBe(true);
      const res = await env.ASSETS.fetch(new URL(href, "https://link.test/"));
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("css");
    }
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
