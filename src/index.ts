import { Hono } from "hono";
import type { Env } from "./types";

const app = new Hono<{ Bindings: Env }>();

app.get("/_health", (c) => c.json({ ok: true }));

export default {
  fetch: app.fetch,
} satisfies ExportedHandler<Env>;
