import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import {
  checkLoginAllowed,
  clearLoginFailures,
  deleteStaleLoginAttempts,
  registerLoginFailure,
} from "../../src/auth/rate-limit";

const NOW = 1_772_000_000;
const KEY = "abcdef0123456789abcdef0123456789";

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM login_attempts").run();
});

describe("login rate limiting", () => {
  it("allows a first attempt", async () => {
    expect((await checkLoginAllowed(env.DB, KEY, NOW)).allowed).toBe(true);
  });

  it("allows up to seven failures then locks on the eighth", async () => {
    for (let i = 0; i < 7; i++) {
      await registerLoginFailure(env.DB, KEY, NOW);
      expect((await checkLoginAllowed(env.DB, KEY, NOW)).allowed).toBe(true);
    }
    await registerLoginFailure(env.DB, KEY, NOW);
    const result = await checkLoginAllowed(env.DB, KEY, NOW);
    expect(result.allowed).toBe(false);
    expect(result.retryAfter).toBeGreaterThan(0);
  });

  it("allows again once the lock has elapsed", async () => {
    for (let i = 0; i < 8; i++) {
      await registerLoginFailure(env.DB, KEY, NOW);
    }
    expect((await checkLoginAllowed(env.DB, KEY, NOW + 901)).allowed).toBe(true);
  });

  it("locks for longer after repeated rounds of failures", async () => {
    for (let i = 0; i < 16; i++) {
      await registerLoginFailure(env.DB, KEY, NOW);
    }
    const result = await checkLoginAllowed(env.DB, KEY, NOW);
    expect(result.retryAfter).toBeGreaterThan(900);
  });

  it("clears the counter on a successful login", async () => {
    for (let i = 0; i < 8; i++) {
      await registerLoginFailure(env.DB, KEY, NOW);
    }
    await clearLoginFailures(env.DB, KEY);
    expect((await checkLoginAllowed(env.DB, KEY, NOW)).allowed).toBe(true);
  });

  it("purges rows whose window and lock have both passed", async () => {
    await registerLoginFailure(env.DB, KEY, NOW);
    expect(await deleteStaleLoginAttempts(env.DB, NOW + 100_000)).toBe(1);
  });

  it("isolates different keys", async () => {
    for (let i = 0; i < 8; i++) {
      await registerLoginFailure(env.DB, KEY, NOW);
    }
    expect((await checkLoginAllowed(env.DB, "f".repeat(32), NOW)).allowed).toBe(true);
  });
});
