import type { MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import { readSession } from "../db/sessions";
import type { Env } from "../types";
import { SESSION_COOKIE } from "./session";

export type AuthedVariables = { sessionId: string };

export const requireSession: MiddlewareHandler<{
  Bindings: Env;
  Variables: AuthedVariables;
}> = async (c, next) => {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) {
    return c.json({ error: "unauthenticated" }, 401);
  }

  const session = await readSession(c.env.DB, token, Math.floor(Date.now() / 1000));
  if (!session) {
    return c.json({ error: "unauthenticated" }, 401);
  }

  c.set("sessionId", session.id);
  await next();
};
