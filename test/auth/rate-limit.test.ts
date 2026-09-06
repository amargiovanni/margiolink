import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import {
  clearLoginFailures,
  deleteStaleLoginAttempts,
  reserveLoginAttempt,
} from "../../src/auth/rate-limit";

const NOW = 1_772_000_000;
const KEY = "abcdef0123456789abcdef0123456789";

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM login_attempts").run();
});

describe("login rate limiting", () => {
  it("allows a first attempt", async () => {
    expect((await reserveLoginAttempt(env.DB, KEY, NOW)).allowed).toBe(true);
  });

  it("reserves eight attempts and rejects the ninth", async () => {
    for (let i = 0; i < 8; i++) {
      expect((await reserveLoginAttempt(env.DB, KEY, NOW)).allowed).toBe(true);
    }

    const result = await reserveLoginAttempt(env.DB, KEY, NOW);
    expect(result.allowed).toBe(false);
    expect(result.retryAfter).toBeGreaterThan(0);
  });

  it("allows again once the lock has elapsed", async () => {
    for (let i = 0; i < 8; i++) {
      await reserveLoginAttempt(env.DB, KEY, NOW);
    }
    expect((await reserveLoginAttempt(env.DB, KEY, NOW + 901)).allowed).toBe(true);
  });

  it("locks for longer after repeated rounds of failures", async () => {
    for (let i = 0; i < 8; i++) {
      await reserveLoginAttempt(env.DB, KEY, NOW);
    }
    for (let i = 0; i < 8; i++) {
      expect((await reserveLoginAttempt(env.DB, KEY, NOW + 901)).allowed).toBe(true);
    }

    const result = await reserveLoginAttempt(env.DB, KEY, NOW + 901);
    expect(result.retryAfter).toBeGreaterThan(900);
  });

  it("atomically admits no more than eight concurrent attempts", async () => {
    const results = await Promise.all(
      Array.from({ length: 16 }, () => reserveLoginAttempt(env.DB, KEY, NOW)),
    );

    expect(results.filter((result) => result.allowed)).toHaveLength(8);
    expect(results.filter((result) => !result.allowed)).toHaveLength(8);
    const row = await env.DB.prepare(
      "SELECT attempts, locked_until FROM login_attempts WHERE ip_hash = ?",
    )
      .bind(KEY)
      .first<{ attempts: number; locked_until: number | null }>();
    expect(row).toEqual({ attempts: 8, locked_until: NOW + 900 });
  });

  it("clears the counter on a successful login", async () => {
    for (let i = 0; i < 8; i++) {
      await reserveLoginAttempt(env.DB, KEY, NOW);
    }
    await clearLoginFailures(env.DB, KEY);
    expect((await reserveLoginAttempt(env.DB, KEY, NOW)).allowed).toBe(true);
  });

  it("purges rows whose window and lock have both passed", async () => {
    await reserveLoginAttempt(env.DB, KEY, NOW);
    expect(await deleteStaleLoginAttempts(env.DB, NOW + 100_000)).toBe(1);
  });

  it("isolates different keys", async () => {
    for (let i = 0; i < 8; i++) {
      await reserveLoginAttempt(env.DB, KEY, NOW);
    }
    expect((await reserveLoginAttempt(env.DB, "f".repeat(32), NOW)).allowed).toBe(true);
  });
});
