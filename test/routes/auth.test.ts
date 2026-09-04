import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

const CREDENTIALS = { username: "admin", password: "correct-horse-battery-staple" };

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM admin_sessions").run();
  await env.DB.prepare("DELETE FROM login_attempts").run();
});

async function login(body: unknown, headers: Record<string, string> = {}) {
  return SELF.fetch("https://link.test/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function sessionCookie(res: Response): string {
  return (res.headers.get("set-cookie") ?? "").split(";")[0] as string;
}

describe("POST /api/auth/login", () => {
  it("accepts the configured credentials and sets a hardened cookie", async () => {
    const res = await login(CREDENTIALS);

    expect(res.status).toBe(200);
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("__Host-ml_session=");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Path=/");
    expect(cookie).not.toContain("Domain=");
  });

  it("rejects a wrong password without revealing which field was wrong", async () => {
    const res = await login({ username: "admin", password: "nope" });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "invalid_credentials" });
  });

  it("rejects a wrong username with the same response", async () => {
    const res = await login({ username: "root", password: CREDENTIALS.password });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "invalid_credentials" });
  });

  it("rejects a malformed body with 400", async () => {
    const res = await login({ username: "admin" });
    expect(res.status).toBe(400);
  });

  it("rejects oversized credentials before comparing them", async () => {
    const res = await login({ username: "admin", password: "x".repeat(201) });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_body" });
  });

  it("locks out after eight failures and answers 429 with Retry-After", async () => {
    const headers = { "cf-connecting-ip": "198.51.100.7" };
    for (let i = 0; i < 8; i++) {
      await login({ username: "admin", password: "nope" }, headers);
    }
    const res = await login(CREDENTIALS, headers);
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  it("clears the failure counter after a successful login", async () => {
    const headers = { "cf-connecting-ip": "198.51.100.8" };
    for (let i = 0; i < 3; i++) {
      await login({ username: "admin", password: "nope" }, headers);
    }
    await login(CREDENTIALS, headers);
    const { results } = await env.DB.prepare("SELECT * FROM login_attempts").all();
    expect(results).toHaveLength(0);
  });
});

describe("session lifecycle", () => {
  it("reaches an authenticated route with the cookie", async () => {
    const cookie = sessionCookie(await login(CREDENTIALS));
    const res = await SELF.fetch("https://link.test/api/auth/sessions", { headers: { cookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { sessions: unknown[] };
    expect(body.sessions).toHaveLength(1);
  });

  it("logs out and invalidates the cookie", async () => {
    const cookie = sessionCookie(await login(CREDENTIALS));

    const logout = await SELF.fetch("https://link.test/api/auth/logout", {
      method: "POST",
      headers: { cookie },
    });
    expect(logout.status).toBe(200);

    const after = await SELF.fetch("https://link.test/api/auth/sessions", { headers: { cookie } });
    expect(after.status).toBe(401);
  });

  it("revokes every session at once", async () => {
    const first = sessionCookie(await login(CREDENTIALS));
    const second = sessionCookie(await login(CREDENTIALS));

    const res = await SELF.fetch("https://link.test/api/auth/sessions", {
      method: "DELETE",
      headers: { cookie: second },
    });
    expect(res.status).toBe(200);

    const check = await SELF.fetch("https://link.test/api/auth/sessions", {
      headers: { cookie: first },
    });
    expect(check.status).toBe(401);
  });

  it("revokes a single session by id, leaving the others intact", async () => {
    const first = sessionCookie(await login(CREDENTIALS));
    const second = sessionCookie(await login(CREDENTIALS));

    const list = await SELF.fetch("https://link.test/api/auth/sessions", {
      headers: { cookie: second },
    });
    const { sessions } = (await list.json()) as { sessions: { id: string; current: boolean }[] };
    const other = sessions.find((s) => !s.current);
    if (!other) throw new Error("expected a non-current session in the list");

    const res = await SELF.fetch(`https://link.test/api/auth/sessions/${other.id}`, {
      method: "DELETE",
      headers: { cookie: second },
    });
    expect(res.status).toBe(200);

    const revoked = await SELF.fetch("https://link.test/api/auth/sessions", {
      headers: { cookie: first },
    });
    expect(revoked.status).toBe(401);

    const current = await SELF.fetch("https://link.test/api/auth/sessions", {
      headers: { cookie: second },
    });
    expect(current.status).toBe(200);
  });

  it("answers 404 for an unknown session id", async () => {
    const cookie = sessionCookie(await login(CREDENTIALS));

    const res = await SELF.fetch("https://link.test/api/auth/sessions/does-not-exist", {
      method: "DELETE",
      headers: { cookie },
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });

  it("rejects a forged cookie", async () => {
    const res = await SELF.fetch("https://link.test/api/auth/sessions", {
      headers: { cookie: `__Host-ml_session=${"a".repeat(64)}` },
    });
    expect(res.status).toBe(401);
  });
});
