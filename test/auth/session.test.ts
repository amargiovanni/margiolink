import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { summariseUserAgent } from "../../src/auth/session";
import {
  createSession,
  deleteExpiredSessions,
  destroyAllSessions,
  destroySession,
  destroySessionById,
  listSessions,
  readSession,
} from "../../src/db/sessions";
import { sha256Hex } from "../../src/lib/crypto";

const NOW = 1_772_000_000;
const THIRTY_DAYS = 30 * 24 * 3600;

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM admin_sessions").run();
});

describe("sessions", () => {
  it("issues a token that is not what gets stored", async () => {
    const token = await createSession(env.DB, "Safari on macOS", NOW);
    expect(token).toMatch(/^[0-9a-f]{64}$/);

    const stored = await env.DB.prepare("SELECT id FROM admin_sessions").first<{ id: string }>();
    expect(stored?.id).not.toBe(token);
    expect(stored?.id).toBe(await sha256Hex(token));
  });

  it("reads back a valid session and refreshes last_seen_at", async () => {
    const token = await createSession(env.DB, null, NOW);
    const session = await readSession(env.DB, token, NOW + 100);
    expect(session).not.toBeNull();
    expect(session?.last_seen_at).toBe(NOW + 100);
  });

  it("returns null for an unknown token", async () => {
    expect(await readSession(env.DB, "0".repeat(64), NOW)).toBeNull();
  });

  it("returns null for an expired session", async () => {
    const token = await createSession(env.DB, null, NOW);
    expect(await readSession(env.DB, token, NOW + THIRTY_DAYS + 1)).toBeNull();
  });

  it("destroys a single session", async () => {
    const token = await createSession(env.DB, null, NOW);
    await destroySession(env.DB, token);
    expect(await readSession(env.DB, token, NOW)).toBeNull();
  });

  it("destroys every session at once", async () => {
    await createSession(env.DB, null, NOW);
    await createSession(env.DB, null, NOW);
    await destroyAllSessions(env.DB);
    expect(await listSessions(env.DB, NOW)).toHaveLength(0);
  });

  it("deletes expired sessions in bulk", async () => {
    await createSession(env.DB, null, NOW);
    expect(await deleteExpiredSessions(env.DB, NOW + THIRTY_DAYS + 1)).toBe(1);
  });

  it("destroys a session by id and reports whether one was found", async () => {
    const token = await createSession(env.DB, null, NOW);
    const stored = await env.DB.prepare("SELECT id FROM admin_sessions").first<{ id: string }>();
    const id = stored?.id as string;

    expect(await destroySessionById(env.DB, id)).toBe(true);
    expect(await readSession(env.DB, token, NOW)).toBeNull();
    expect(await destroySessionById(env.DB, id)).toBe(false);
  });
});

describe("summariseUserAgent", () => {
  it("joins browser and OS when both are known", () => {
    expect(summariseUserAgent("Safari", "macOS")).toBe("Safari on macOS");
  });

  it("returns just the browser when the OS is unknown", () => {
    expect(summariseUserAgent("Safari", null)).toBe("Safari");
  });

  it("returns just the OS when the browser is unknown", () => {
    expect(summariseUserAgent(null, "macOS")).toBe("macOS");
  });

  it("returns null when neither is known", () => {
    expect(summariseUserAgent(null, null)).toBeNull();
  });
});
