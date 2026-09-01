import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { app } from "../../src/index";
import { PUBLIC_API_ROUTES } from "../../src/routes/api";

function concreteUrl(path: string): string {
  return `https://link.test${path.replace(/:[A-Za-z_]+/g, "1")}`;
}

describe("API authorization coverage", () => {
  const apiRoutes = app.routes.filter(
    (route) => route.path.startsWith("/api") && route.method !== "ALL",
  );

  it("registers API routes at all, so this test cannot pass vacuously", () => {
    expect(apiRoutes.length).toBeGreaterThanOrEqual(5);
  });

  it.each(apiRoutes.map((route) => [route.method, route.path] as const))(
    "%s %s requires a session unless explicitly public",
    async (method, path) => {
      const key = `${method} ${path}`;
      if (PUBLIC_API_ROUTES.has(key)) return;

      const res = await SELF.fetch(concreteUrl(path), {
        method,
        headers: { "content-type": "application/json" },
        body: method === "GET" || method === "HEAD" ? undefined : "{}",
      });

      expect(res.status, `${key} answered ${res.status} to an anonymous caller`).toBe(401);
    },
  );
});
