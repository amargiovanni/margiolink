import { Hono } from "hono";
import { runRetention } from "./cron/retention";
import { runRollup } from "./cron/rollup";
import { createApiRouter } from "./routes/api";
import { registerRedirect } from "./routes/redirect";
import type { Env } from "./types";

export const app = new Hono<{ Bindings: Env }>();

app.get("/_health", (c) => c.json({ ok: true }));
app.route("/api", createApiRouter());

registerRedirect(app);

export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledController, env: Env): Promise<void> {
    const now = Math.floor(Date.now() / 1000);

    if (event.cron === "30 3 * * *") {
      const result = await runRetention(env.DB, now, Number(env.RAW_RETENTION_DAYS));
      console.log("retention", result);
      return;
    }

    const days = await runRollup(env.DB, now);
    console.log("rollup", days);
  },
};
