import { Hono } from "hono";
import { type AuthedVariables, requireSession } from "../../auth/middleware";
import type { Env } from "../../types";
import { privateAuth, publicAuth } from "./auth";
import { links } from "./links";
import { meta } from "./meta";
import { stats } from "./stats";
import { tags } from "./tags";

export const PUBLIC_API_ROUTES: ReadonlySet<string> = new Set(["POST /api/auth/login"]);

export function createApiRouter(): Hono<{ Bindings: Env; Variables: AuthedVariables }> {
  const api = new Hono<{ Bindings: Env; Variables: AuthedVariables }>();

  api.route("/", publicAuth);
  api.use("*", requireSession);
  api.route("/", privateAuth);
  api.route("/links", links);
  api.route("/tags", tags);
  api.route("/stats", stats);
  api.route("/meta", meta);

  api.notFound((c) => c.json({ error: "not_found" }, 404));

  return api;
}
