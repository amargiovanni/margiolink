import { Hono } from "hono";
import { createApiRouter } from "./routes/api";
import { registerRedirect } from "./routes/redirect";
import type { Env } from "./types";

export const app = new Hono<{ Bindings: Env }>();

app.get("/_health", (c) => c.json({ ok: true }));
app.route("/api", createApiRouter());

registerRedirect(app);

export default {
  fetch: app.fetch,
} satisfies ExportedHandler<Env>;
