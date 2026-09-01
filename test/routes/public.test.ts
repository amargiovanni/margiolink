import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("GET /privacy", () => {
  it("is publicly reachable", async () => {
    const res = await SELF.fetch("https://link.test/privacy");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
  });

  it("states the legal basis, the retention window and the absence of IP storage", async () => {
    const body = await (await SELF.fetch("https://link.test/privacy")).text();
    expect(body).toContain("legitimate interest");
    expect(body).toContain("180");
    expect(body).toMatch(/IP address/i);
  });

  it("declares a language for screen readers", async () => {
    const body = await (await SELF.fetch("https://link.test/privacy")).text();
    expect(body).toContain('<html lang="en">');
  });

  it("discloses the password-gate cookie", async () => {
    const body = await (await SELF.fetch("https://link.test/privacy")).text();
    expect(body).toMatch(/password/i);
    expect(body).toContain("ten minutes");
  });
});

describe("GET /robots.txt", () => {
  it("keeps short links out of search indexes", async () => {
    const res = await SELF.fetch("https://link.test/robots.txt");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Disallow: /");
  });
});
