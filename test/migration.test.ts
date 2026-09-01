import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import down0001 from "../rollback/0001_init.down.sql?raw";
import down0002 from "../rollback/0002_drop_referrer_url.down.sql?raw";

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

async function columnNames(table: string): Promise<string[]> {
  const { results } = await env.DB.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>();
  return results.map((r) => r.name);
}

async function tableNames(): Promise<string[]> {
  const { results } = await env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table'",
  ).all<{ name: string }>();
  return results.map((r) => r.name);
}

describe("migration 0002", () => {
  it("has dropped referrer_url, keeping the host and the classification", async () => {
    const columns = await columnNames("clicks");
    expect(columns).not.toContain("referrer_url");
    expect(columns).toContain("referrer_host");
    expect(columns).toContain("referrer_type");
  });

  it("is reversible — the column comes back, and deliberately not its data", async () => {
    const statements = down0002
      .split(";")
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .map((s) => env.DB.prepare(s));
    await env.DB.batch(statements);

    expect(await columnNames("clicks")).toContain("referrer_url");
  });
});

describe("migration 0001", () => {
  it("creates every table the spec defines", async () => {
    const names = await tableNames();
    for (const table of OUR_TABLES) {
      expect(names).toContain(table);
    }
  });

  it("is fully reversible", async () => {
    const statements = down0001
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
