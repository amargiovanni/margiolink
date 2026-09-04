import { Hono } from "hono";
import { runRetention } from "./cron/retention";
import { runRollup } from "./cron/rollup";
import { checkReadiness } from "./lib/readiness";
import { securityHeaders } from "./lib/security-headers";
import { createApiRouter } from "./routes/api";
import { registerPublicRoutes } from "./routes/public";
import { registerRedirect } from "./routes/redirect";
import type { Env } from "./types";

export const app = new Hono<{ Bindings: Env }>();

app.use("*", securityHeaders);

app.get("/_health", (c) => c.json({ ok: true }));
app.get("/_ready", async (c) => {
  const ready = await checkReadiness(c.env);
  return ready ? c.json({ ok: true }) : c.json({ ok: false }, 503);
});
app.route("/api", createApiRouter());
registerPublicRoutes(app);

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

    const result = await runRollup(env.DB, now);
    console.log(JSON.stringify({ event: "rollup", ...result }));
    if (result.backlog) {
      console.warn(JSON.stringify({ event: "rollup_backlog", days: result.days }));
    }
  },
};
