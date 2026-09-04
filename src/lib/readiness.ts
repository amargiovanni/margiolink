import type { Env } from "../types";
import { requireHashSecret } from "./secrets";

function requireNonEmpty(name: string, value: unknown): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${name} is not configured`);
  }
}

export async function checkReadiness(env: Env): Promise<boolean> {
  try {
    requireNonEmpty("ADMIN_USER", env.ADMIN_USER);
    requireNonEmpty("ADMIN_PASSWORD", env.ADMIN_PASSWORD);
    requireNonEmpty("SHORT_DOMAIN", env.SHORT_DOMAIN);
    requireHashSecret(env);

    const retentionDays = Number(env.RAW_RETENTION_DAYS);
    if (!Number.isInteger(retentionDays) || retentionDays <= 0) {
      throw new Error("RAW_RETENTION_DAYS must be a positive integer");
    }

    if (!env.ASSETS || typeof env.ASSETS.fetch !== "function") {
      throw new Error("ASSETS binding is not configured");
    }
    const assetResponse = await env.ASSETS.fetch(
      new Request("https://margiolink-assets.invalid/app.html"),
    );
    if (!assetResponse.ok) {
      throw new Error(`ASSETS binding returned ${assetResponse.status} for app.html`);
    }
    await assetResponse.body?.cancel();

    // A successful prepare/execute proves both D1 availability and the
    // presence of the migrated links table; an empty installation is ready.
    await env.DB.prepare("SELECT 1 AS ok FROM links LIMIT 1").first();
    return true;
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "readiness_failed",
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return false;
  }
}
