import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import {
  createSession,
  deleteExpiredSessions,
  destroyAllSessions,
  destroySession,
  listSessions,
  readSession,
} from "../../src/db/sessions";

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
});
