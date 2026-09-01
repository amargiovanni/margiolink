import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import dataMap from "../compliance/data-map.md?raw";

/**
 * Column names documented in the `## \`clicks\`` table of the data map.
 *
 * Only the first cell of each row is read. A substring search over the whole
 * file would let an unrelated mention satisfy the check — a new `ip_hash`
 * column would "match" the prose about `login_attempts.ip_hash` in the "Other
 * personal data" section and pass as documented, which is precisely the column
 * whose addition most needs catching.
 */
function documentedClickColumns(markdown: string): string[] {
  const section = markdown.split(/^## /m).find((part) => part.startsWith("`clicks`"));
  if (!section) {
    throw new Error("compliance/data-map.md has no `## `clicks`` section");
  }

  const names: string[] = [];
  for (const line of section.split("\n")) {
    if (!line.startsWith("|")) continue;
    const firstCell = line.split("|")[1] ?? "";
    for (const match of firstCell.matchAll(/`([^`]+)`/g)) {
      names.push(match[1] as string);
    }
  }
  return names;
}

async function schemaClickColumns(): Promise<string[]> {
  const { results } = await env.DB.prepare("PRAGMA table_info(clicks)").all<{ name: string }>();
  return results.map((column) => column.name);
}

describe("data map", () => {
  it("parses the clicks table at all, so the checks below cannot pass vacuously", () => {
    const documented = documentedClickColumns(dataMap);
    expect(documented).toContain("visitor_hash");
    expect(documented.length).toBeGreaterThanOrEqual(20);
    expect(new Set(documented).size, "a column is listed twice").toBe(documented.length);
  });

  it("documents exactly the columns of the clicks table, in both directions", async () => {
    const schema = await schemaClickColumns();
    const documented = documentedClickColumns(dataMap);

    const undocumented = schema.filter((name) => !documented.includes(name));
    expect(
      undocumented,
      `columns present in the schema but missing from compliance/data-map.md: ${undocumented.join(", ")}`,
    ).toEqual([]);

    const stale = documented.filter((name) => !schema.includes(name));
    expect(
      stale,
      `columns documented in compliance/data-map.md that the schema no longer has: ${stale.join(", ")}`,
    ).toEqual([]);
  });

  it("records the retention window that the code actually enforces", () => {
    expect(dataMap).toContain(`${env.RAW_RETENTION_DAYS} days`);
  });

  it("still states that no IP address is stored", () => {
    expect(dataMap).toContain("IP address");
  });
});
