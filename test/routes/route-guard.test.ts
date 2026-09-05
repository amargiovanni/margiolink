import { createExecutionContext, env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { requireSession } from "../../src/auth/middleware";
import { createSession } from "../../src/db/sessions";
import { app } from "../../src/index";
import { securityHeaders } from "../../src/lib/security-headers";
import { PUBLIC_API_ROUTES } from "../../src/routes/api";
import type { Env } from "../../src/types";

/**
 * The one API route that may answer an anonymous caller. Pinned as a literal so
 * that adding a second one is a visible, deliberate edit to this file rather
 * than a silent widening of `PUBLIC_API_ROUTES`.
 */
const EXPECTED_PUBLIC_API_ROUTES = ["POST /api/auth/login"];

/**
 * Paths where `requireSession` is mounted with `use("*", ...)`. Hono's
 * `route()` copies those registrations into `app.routes` with method `ALL`,
 * indistinguishably from a route registered via `all()` — so they are excluded
 * by identity of the handler, never by a blanket `method !== "ALL"` filter,
 * which would also hide a genuine `all()` handler from this test.
 */
const EXPECTED_SESSION_MIDDLEWARE_PATHS = ["/api/*"];

/**
 * Every route outside `/api`, all of them intentionally reachable without a
 * session: the health probe, the dashboard shell, the public privacy notice,
 * the robots policy and the two redirect handlers. The shell itself is public
 * by design — it is static markup, and the API it calls stays behind
 * `requireSession`. Adding another public path — or an authenticated route
 * mounted outside `/api`, such as the CSV export the Settings screen calls
 * for — fails here until it is accounted for.
 */
const EXPECTED_PUBLIC_NON_API_ROUTES = [
  "GET /_health",
  "GET /_ready",
  "GET /app",
  "GET /app/*",
  "GET /privacy",
  "GET /robots.txt",
  "GET /.well-known/security.txt",
  "GET /:slug",
  "POST /:slug",
];

function concreteUrl(path: string): string {
  return `https://link.test${path.replace(/:[A-Za-z_]+/g, "1")}`;
}

const apiRoutes = app.routes.filter((route) => route.path.startsWith("/api"));
const sessionMiddleware = apiRoutes.filter((route) => route.handler === requireSession);
const apiHandlers = apiRoutes.filter((route) => route.handler !== requireSession);

describe("API authorization coverage", () => {
  it("registers API routes at all, so this test cannot pass vacuously", () => {
    expect(apiHandlers.length).toBeGreaterThanOrEqual(5);
  });

  it("allows exactly one public API route", () => {
    expect([...PUBLIC_API_ROUTES].sort()).toEqual([...EXPECTED_PUBLIC_API_ROUTES].sort());
  });

  it("mounts the session middleware exactly where expected", () => {
    expect(sessionMiddleware.map((route) => route.path).sort()).toEqual(
      [...EXPECTED_SESSION_MIDDLEWARE_PATHS].sort(),
    );
    expect(sessionMiddleware.every((route) => route.method === "ALL")).toBe(true);
  });

  it("reads an authenticated session exactly once for a private request", async () => {
    const token = await createSession(env.DB, null, Math.floor(Date.now() / 1000));
    const queries: string[] = [];
    const db = new Proxy(env.DB, {
      get(target, property) {
        if (property === "prepare") {
          return (sql: string) => {
            queries.push(sql);
            return target.prepare(sql);
          };
        }
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const ctx = createExecutionContext();

    const res = await app.fetch(
      new Request("https://link.test/api/meta", {
        headers: { cookie: `__Host-ml_session=${token}` },
      }),
      { ...env, DB: db } as unknown as Env,
      ctx,
    );

    expect(res.status).toBe(200);
    expect(queries.filter((sql) => sql.startsWith("SELECT * FROM admin_sessions"))).toHaveLength(1);
  });

  it("registers no ALL-method API route other than that middleware", () => {
    const strays = apiHandlers
      .filter((route) => route.method === "ALL")
      .map((route) => `${route.method} ${route.path}`);

    expect(
      strays,
      `register explicit methods instead: an ALL-method /api route cannot be probed by this test — ${strays.join(", ")}`,
    ).toEqual([]);
  });

  it.each(apiHandlers.map((route) => [route.method, route.path] as const))(
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

describe("routes outside /api", () => {
  it("are exactly the ones intended to be public", () => {
    const nonApi = app.routes
      .filter((route) => !route.path.startsWith("/api"))
      .filter((route) => route.handler !== securityHeaders)
      .map((route) => `${route.method} ${route.path}`);

    expect(nonApi.sort()).toEqual([...EXPECTED_PUBLIC_NON_API_ROUTES].sort());
  });
});
