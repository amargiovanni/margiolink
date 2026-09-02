import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

async function loginCookie(): Promise<string> {
  const res = await SELF.fetch("https://link.test/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "correct-horse-battery-staple" }),
  });
  return (res.headers.get("set-cookie") ?? "").split(";")[0] as string;
}

describe("GET /api/meta", () => {
  it("requires a session", async () => {
    const res = await SELF.fetch("https://link.test/api/meta");
    expect(res.status).toBe(401);
  });

  it("returns the retention window as a number, not the environment's string", async () => {
    const cookie = await loginCookie();
    const res = await SELF.fetch("https://link.test/api/meta", { headers: { cookie } });
    const body = (await res.json()) as { retentionDays: unknown };

    // `typeof` alone fails on "180" (RAW_RETENTION_DAYS's own string type in
    // wrangler config) and would pass a broken `String(...)` conversion right
    // back through — pinning the numeric value too catches that in one test.
    expect(typeof body.retentionDays).toBe("number");
    expect(body.retentionDays).toBe(180);
  });

  it("returns the configured short domain", async () => {
    const cookie = await loginCookie();
    const res = await SELF.fetch("https://link.test/api/meta", { headers: { cookie } });
    const body = (await res.json()) as { shortDomain: string };
    expect(body.shortDomain).toBe("link.test");
  });
});
