import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import downSql from "../rollback/0001_init.down.sql?raw";

const OUR_TABLES = [
  "links",
  "tags",
  "link_tags",
  "clicks",
  "click_daily",
  "click_daily_dim",
  "admin_sessions",
  "login_attempts",
];

async function tableNames(): Promise<string[]> {
  const { results } = await env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table'",
  ).all<{ name: string }>();
  return results.map((r) => r.name);
}

describe("migration 0001", () => {
  it("creates every table the spec defines", async () => {
    const names = await tableNames();
    for (const table of OUR_TABLES) {
      expect(names).toContain(table);
    }
  });

  it("is fully reversible", async () => {
    const statements = downSql
      .split(";")
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .map((s) => env.DB.prepare(s));
    await env.DB.batch(statements);

    const names = await tableNames();
    for (const table of OUR_TABLES) {
      expect(names).not.toContain(table);
    }
  });
});
