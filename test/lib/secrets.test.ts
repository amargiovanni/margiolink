import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { createLink } from "../../src/db/links";
import { app } from "../../src/index";
import { MIN_HASH_SECRET_LENGTH, requireHashSecret } from "../../src/lib/secrets";
import type { Env } from "../../src/types";

const NOW = Math.floor(Date.parse("2026-09-01T00:00:00Z") / 1000);

// A request that cannot be handled securely must fail, not proceed insecurely.
// Both entry points below read HASH_SECRET, so both are exercised.
function envWith(secret: string | undefined): Env {
  return { ...(env as unknown as Env), HASH_SECRET: secret };
}

async function fetchWith(secret: string | undefined, request: Request): Promise<Response> {
  const ctx = createExecutionContext();
  const res = await app.fetch(request, envWith(secret), ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

const TOO_SHORT = "a".repeat(MIN_HASH_SECRET_LENGTH - 1);

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM clicks").run();
  await env.DB.prepare("DELETE FROM links").run();
  await env.DB.prepare("DELETE FROM login_attempts").run();
});

describe("requireHashSecret", () => {
  it("rejects a missing secret", () => {
    expect(() => requireHashSecret(envWith(undefined))).toThrow(/HASH_SECRET/);
  });

  it("rejects a secret shorter than the minimum", () => {
    expect(() => requireHashSecret(envWith(TOO_SHORT))).toThrow(/HASH_SECRET/);
  });

  it("returns a secret of at least the minimum length", () => {
    const secret = "b".repeat(MIN_HASH_SECRET_LENGTH);
    expect(requireHashSecret(envWith(secret))).toBe(secret);
  });

  it("requires at least 32 characters", () => {
    expect(MIN_HASH_SECRET_LENGTH).toBe(32);
  });
});

describe("the redirect path refuses to run without a usable HASH_SECRET", () => {
  beforeEach(async () => {
    await createLink(env.DB, { slug: "go", targetUrl: "https://example.com/dest" }, NOW);
  });

  it.each([
    ["missing", undefined],
    ["too short", TOO_SHORT],
  ])("answers 500 and does not redirect when the secret is %s", async (_label, secret) => {
    const res = await fetchWith(secret, new Request("https://link.test/go"));

    expect(res.status).toBe(500);
    expect(res.headers.get("location")).toBeNull();
  });

  it("records no click when the secret is missing, rather than one hashed insecurely", async () => {
    await fetchWith(undefined, new Request("https://link.test/go"));

    const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM clicks").first<{ n: number }>();
    expect(count?.n).toBe(0);
  });

  it.each([
    ["missing", undefined],
    ["too short", TOO_SHORT],
  ])("refuses a password submission when the secret is %s", async (_label, secret) => {
    const res = await fetchWith(
      secret,
      new Request("https://link.test/go", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "password=hunter2",
      }),
    );

    expect(res.status).toBe(500);
  });
});

describe("the login path refuses to run without a usable HASH_SECRET", () => {
  it.each([
    ["missing", undefined],
    ["too short", TOO_SHORT],
  ])("answers 500 when the secret is %s", async (_label, secret) => {
    const res = await fetchWith(
      secret,
      new Request("https://link.test/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "admin", password: "correct-horse-battery-staple" }),
      }),
    );

    expect(res.status).toBe(500);
    expect(res.headers.get("set-cookie")).toBeNull();
  });
});
