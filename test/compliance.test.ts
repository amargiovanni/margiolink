import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import dataMap from "../compliance/data-map.md?raw";

describe("data map", () => {
  it("describes every column of the clicks table", async () => {
    const { results } = await env.DB.prepare("PRAGMA table_info(clicks)").all<{ name: string }>();
    const undocumented = results
      .map((column) => column.name)
      .filter((name) => !dataMap.includes(`\`${name}\``));

    expect(
      undocumented,
      `columns missing from compliance/data-map.md: ${undocumented.join(", ")}`,
    ).toEqual([]);
  });

  it("records the retention window that the code actually enforces", () => {
    expect(dataMap).toContain(`${env.RAW_RETENTION_DAYS} days`);
  });

  it("still states that no IP address is stored", () => {
    expect(dataMap).toContain("IP address");
  });
});
