import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { z } from "zod";
import { requireSession } from "../../auth/middleware";
import { clearLoginFailures, reserveLoginAttempt } from "../../auth/rate-limit";
import { SESSION_COOKIE, SESSION_MAX_AGE, summariseUserAgent } from "../../auth/session";
import {
  createSession,
  destroyAllSessions,
  destroySession,
  destroySessionById,
  listSessions,
} from "../../db/sessions";
import { constantTimeEquals, ipHash } from "../../lib/crypto";
import { requireHashSecret } from "../../lib/secrets";
import { parseClient } from "../../lib/ua";
import type { Env } from "../../types";

const loginSchema = z.object({
  username: z.string().min(1).max(200),
  password: z.string().min(1).max(200),
});

export const publicAuth = new Hono<{ Bindings: Env }>();

publicAuth.post("/auth/login", async (c) => {
  // The login throttle keys on `ipHash`, so an unusable HASH_SECRET would make
  // the lockout table keyed on a guessable value. Refuse rather than throttle
  // on a key an attacker can compute.
  const secret = requireHashSecret(c.env);

  const parsed = loginSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: "invalid_body" }, 400);
  }

  const now = Math.floor(Date.now() / 1000);
  const key = await ipHash(secret, c.req.header("cf-connecting-ip") ?? "", now);

  const limit = await reserveLoginAttempt(c.env.DB, key, now);
  if (!limit.allowed) {
    return c.json({ error: "too_many_attempts" }, 429, {
      "retry-after": String(limit.retryAfter),
    });
  }

  const [userOk, passwordOk] = await Promise.all([
    constantTimeEquals(parsed.data.username, c.env.ADMIN_USER),
    constantTimeEquals(parsed.data.password, c.env.ADMIN_PASSWORD),
  ]);

  if (!userOk || !passwordOk) {
    return c.json({ error: "invalid_credentials" }, 401);
  }

  await clearLoginFailures(c.env.DB, key);

  const client = parseClient(c.req.raw.headers);
  const token = await createSession(c.env.DB, summariseUserAgent(client.browser, client.os), now);

  setCookie(c, SESSION_COOKIE, token, {
    path: "/",
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    maxAge: SESSION_MAX_AGE,
  });

  return c.json({ ok: true });
});

export const privateAuth = new Hono<{ Bindings: Env; Variables: { sessionId: string } }>();

privateAuth.use("*", requireSession);

privateAuth.post("/auth/logout", async (c) => {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) {
    await destroySession(c.env.DB, token);
  }
  deleteCookie(c, SESSION_COOKIE, { path: "/", secure: true });
  return c.json({ ok: true });
});

privateAuth.get("/auth/sessions", async (c) => {
  const sessions = await listSessions(c.env.DB, Math.floor(Date.now() / 1000));
  const current = c.get("sessionId");
  return c.json({
    sessions: sessions.map((s) => ({
      id: s.id,
      createdAt: s.created_at,
      lastSeenAt: s.last_seen_at,
      expiresAt: s.expires_at,
      device: s.ua_summary,
      current: s.id === current,
    })),
  });
});

privateAuth.delete("/auth/sessions", async (c) => {
  await destroyAllSessions(c.env.DB);
  deleteCookie(c, SESSION_COOKIE, { path: "/", secure: true });
  return c.json({ ok: true });
});

privateAuth.delete("/auth/sessions/:id", async (c) => {
  const removed = await destroySessionById(c.env.DB, c.req.param("id"));
  return removed ? c.json({ ok: true }) : c.json({ error: "not_found" }, 404);
});
