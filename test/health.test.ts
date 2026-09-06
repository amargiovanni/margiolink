import { createExecutionContext, env, SELF } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";
import { app } from "../src/index";
import type { Env } from "../src/types";

describe("health endpoint", () => {
  it("answers 200 with ok:true", async () => {
    const res = await SELF.fetch("https://link.test/_health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("adds the complete dynamic response security policy", async () => {
    const res = await SELF.fetch("https://link.test/_health");

    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(res.headers.get("strict-transport-security")).toContain("max-age=31536000");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(res.headers.get("permissions-policy")).toContain("geolocation=()");
    expect(res.headers.get("content-security-policy")).toContain("default-src 'self'");
  });
});

describe("readiness endpoint", () => {
  it("answers 200 when bindings and schema are usable", async () => {
    const res = await SELF.fetch("https://link.test/_ready");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("answers only ok:false when a required secret is absent", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const testEnv = { ...(env as unknown as Env), HASH_SECRET: undefined };
    const res = await app.fetch(
      new Request("https://link.test/_ready"),
      testEnv,
      createExecutionContext(),
    );

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false });
    expect(log).toHaveBeenCalledOnce();
    log.mockRestore();
  });

  it("is not ready when the static asset binding cannot serve the app shell", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const testEnv = {
      ...(env as unknown as Env),
      ASSETS: {
        fetch: () => Promise.resolve(new Response(null, { status: 503 })),
      } as unknown as Fetcher,
    };
    const res = await app.fetch(
      new Request("https://link.test/_ready"),
      testEnv,
      createExecutionContext(),
    );

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false });
    expect(log).toHaveBeenCalledOnce();
    log.mockRestore();
  });
});
