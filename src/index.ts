import { Hono } from "hono";
import { registerRedirect } from "./routes/redirect";
import type { Env } from "./types";

const app = new Hono<{ Bindings: Env }>();

app.get("/_health", (c) => c.json({ ok: true }));

registerRedirect(app);

export default {
  fetch: app.fetch,
} satisfies ExportedHandler<Env>;
