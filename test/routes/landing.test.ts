import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { SECURITY_HEADERS } from "../../src/lib/security-headers";
import staticHeaders from "../../web/public/_headers?raw";

/**
 * The public landing page.
 *
 * Everything here goes through `env.ASSETS.fetch` rather than `SELF.fetch`,
 * for the reason `spa.test.ts` sets out at length: this harness invokes the
 * Worker's `fetch` handler only and does not reproduce Cloudflare's
 * "static assets are served before the Worker runs" behaviour. `/` in
 * production never reaches the Worker at all — the asset router answers it
 * with `web/dist/index.html` — so `env.ASSETS`, the same binding production
 * would hand the Worker, is the honest way to ask whether that document
 * exists and holds together. That it is *reachable* at `/` is what
 * `e2e/landing.spec.ts` checks, in a real browser through the real router.
 *
 * All of this needs `npm run build:web` to have run. CI builds before
 * testing, and so does the local `npm test` path documented in the README.
 */
const asset = (path: string) => env.ASSETS.fetch(new URL(path, "https://link.test/"));

describe("the landing document", () => {
  it("ships the dynamic security policy and immutable hashed-asset caching", () => {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      expect(staticHeaders).toContain(`${name}: ${value}`);
    }
    expect(staticHeaders).toMatch(
      /\/assets\/\*[\s\S]*Cache-Control: public, max-age=31536000, immutable/,
    );
  });

  it("allows exactly the inline bootstrap script through the CSP hash", async () => {
    const body = await (await asset("/index.html")).text();
    const script = body.match(/<script>([\s\S]*?)<\/script>/)?.[1];
    expect(script).toBeDefined();

    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(script));
    const encoded = btoa(String.fromCharCode(...new Uint8Array(digest)));
    expect(SECURITY_HEADERS["Content-Security-Policy"]).toContain(`'sha256-${encoded}'`);
  });

  it("is the asset root's index.html, so the bare domain serves it", async () => {
    const res = await asset("/index.html");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
  });

  it("says what the product is and that it is free software", async () => {
    const body = await (await asset("/index.html")).text();
    expect(body).toContain("MargioLink");
    expect(body).toContain("MIT");
    expect(body).toMatch(/open source/i);
    // The claim the whole design is built around. If the copy ever stops
    // making it, that is a decision someone should have to make on purpose.
    expect(body).toMatch(/IP address/);
  });

  it("declares a language and a title for the reader and the crawler", async () => {
    const body = await (await asset("/index.html")).text();
    expect(body).toContain('<html lang="en">');
    expect(body).toMatch(/<title>[^<]+<\/title>/);
    expect(body).toMatch(/<meta\s+name="description"/);
  });

  /**
   * The landing is the one page here that *should* be indexed — it is why
   * `/robots.txt` grew an `Allow: /$` (see `public.test.ts`). The dashboard
   * shell is the opposite and keeps its `noindex`.
   */
  it("is indexable, while the dashboard shell is not", async () => {
    const landing = await (await asset("/index.html")).text();
    const shell = await (await asset("/app.html")).text();
    expect(landing).not.toContain("noindex");
    expect(shell).toContain('name="robots" content="noindex"');
  });

  /**
   * The three embedded screenshots live in `docs/screenshots/`, outside the
   * Vite root, and Vite resolves them into hashed assets at build time. When
   * one is missing it does not fail the build: it leaves the original
   * `../docs/screenshots/x.png` in the markup, which resolves to a 404 at
   * runtime — a landing page with three broken images and a green pipeline.
   * This is the test that turns that into a failure.
   */
  it("references only images that actually resolve", async () => {
    const body = await (await asset("/index.html")).text();

    const sources = [...body.matchAll(/<img[^>]*\ssrc="([^"]+)"/g)]
      .map((match) => match[1])
      .filter((src): src is string => src !== undefined);

    // Anti-vacuity: a regex that matched nothing would let the loop below
    // pass over an empty array.
    expect(sources.length).toBeGreaterThanOrEqual(3);

    for (const src of sources) {
      expect(src.startsWith("/assets/")).toBe(true);
      const res = await asset(src);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toMatch(/^image\//);
    }
  });

  it("gives every image alternative text", async () => {
    const body = await (await asset("/index.html")).text();
    const images = [...body.matchAll(/<img[^>]*>/g)].map((match) => match[0]);
    expect(images.length).toBeGreaterThanOrEqual(3);
    for (const image of images) {
      expect(image).toMatch(/\salt="[^"]+"/);
    }
  });

  it("loads its script and stylesheet from the asset root", async () => {
    const body = await (await asset("/index.html")).text();

    const scripts = [...body.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)].map((match) => match[1]);
    const styles = [...body.matchAll(/<link[^>]*\brel="stylesheet"[^>]*\shref="([^"]+)"/g)].map(
      (match) => match[1],
    );

    expect(scripts.length).toBeGreaterThan(0);
    expect(styles.length).toBeGreaterThan(0);

    for (const href of [...scripts, ...styles]) {
      expect(href?.startsWith("/assets/")).toBe(true);
      expect((await asset(href as string)).status).toBe(200);
    }
  });
});

describe("the landing does not shadow the Worker", () => {
  it("leaves an unknown slug 404ing rather than answering with the page", async () => {
    const res = await SELF.fetch("https://link.test/definitely-not-a-page", {
      redirect: "manual",
    });
    expect(res.status).toBe(404);
  });

  it("leaves the health endpoint and the API alone", async () => {
    expect((await SELF.fetch("https://link.test/_health")).status).toBe(200);
    expect((await SELF.fetch("https://link.test/api/links")).status).toBe(401);
  });
});
