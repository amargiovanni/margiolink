import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("health endpoint", () => {
  it("answers 200 with ok:true", async () => {
    const res = await SELF.fetch("https://link.test/_health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});
