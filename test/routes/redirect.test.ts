import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { createLink, updateLink } from "../../src/db/links";
import { hashPassword, randomSalt } from "../../src/lib/crypto";

const NOW_SECONDS = () => Math.floor(Date.now() / 1000);

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM clicks").run();
  await env.DB.prepare("DELETE FROM links").run();
  await env.DB.prepare("DELETE FROM login_attempts").run();
});

async function clickRows() {
  const { results } = await env.DB.prepare("SELECT * FROM clicks ORDER BY id").all<
    Record<string, unknown>
  >();
  return results;
}

describe("GET /:slug", () => {
  it("redirects an active link and records the click", async () => {
    await createLink(env.DB, { slug: "go", targetUrl: "https://example.com/dest" }, NOW_SECONDS());

    const res = await SELF.fetch("https://link.test/go", { redirect: "manual" });

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://example.com/dest");

    const rows = await clickRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.outcome).toBe("redirect");
  });

  it("returns 404 for an unknown slug and records nothing", async () => {
    const res = await SELF.fetch("https://link.test/nope", { redirect: "manual" });
    expect(res.status).toBe(404);
    expect(await clickRows()).toHaveLength(0);
  });

  it("returns 404 for a soft-deleted link", async () => {
    const link = await createLink(
      env.DB,
      { slug: "gone", targetUrl: "https://e.com" },
      NOW_SECONDS(),
    );
    await env.DB.prepare("UPDATE links SET deleted_at = ? WHERE id = ?")
      .bind(NOW_SECONDS(), link.id)
      .run();

    const res = await SELF.fetch("https://link.test/gone", { redirect: "manual" });
    expect(res.status).toBe(404);
    expect(await clickRows()).toHaveLength(0);
  });

  it("returns 410 for a deactivated link and records the outcome", async () => {
    const link = await createLink(
      env.DB,
      { slug: "off", targetUrl: "https://e.com" },
      NOW_SECONDS(),
    );
    await updateLink(env.DB, link.id, { isActive: false }, NOW_SECONDS());

    const res = await SELF.fetch("https://link.test/off", { redirect: "manual" });

    expect(res.status).toBe(410);
    expect((await clickRows())[0]?.outcome).toBe("inactive");
  });

  it("redirects an expired link to its fallback URL", async () => {
    await createLink(
      env.DB,
      {
        slug: "old",
        targetUrl: "https://e.com",
        expiresAt: NOW_SECONDS() - 10,
        expiredUrl: "https://e.com/expired",
      },
      NOW_SECONDS(),
    );

    const res = await SELF.fetch("https://link.test/old", { redirect: "manual" });

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://e.com/expired");
    expect((await clickRows())[0]?.outcome).toBe("expired");
  });

  it("returns 410 for an expired link with no fallback", async () => {
    await createLink(
      env.DB,
      { slug: "old2", targetUrl: "https://e.com", expiresAt: NOW_SECONDS() - 10 },
      NOW_SECONDS(),
    );

    const res = await SELF.fetch("https://link.test/old2", { redirect: "manual" });
    expect(res.status).toBe(410);
    expect((await clickRows())[0]?.outcome).toBe("expired");
  });

  it("is case-insensitive on the slug", async () => {
    await createLink(env.DB, { slug: "case", targetUrl: "https://e.com" }, NOW_SECONDS());
    const res = await SELF.fetch("https://link.test/CASE", { redirect: "manual" });
    expect(res.status).toBe(302);
  });

  it("does not shadow the health endpoint", async () => {
    const res = await SELF.fetch("https://link.test/_health");
    expect(res.status).toBe(200);
  });
});

describe("password-protected links", () => {
  async function createProtected(password: string) {
    const salt = randomSalt();
    return createLink(
      env.DB,
      {
        slug: "secret",
        targetUrl: "https://example.com/private",
        passwordSalt: salt,
        passwordHash: await hashPassword(password, salt),
      },
      NOW_SECONDS(),
    );
  }

  it("shows the interstitial instead of redirecting", async () => {
    await createProtected("hunter2");

    const res = await SELF.fetch("https://link.test/secret", { redirect: "manual" });

    expect(res.status).toBe(401);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(await res.text()).toContain("<form");
    expect((await clickRows())[0]?.outcome).toBe("password_required");
  });

  it("rejects a wrong password and records the failure", async () => {
    await createProtected("hunter2");

    const res = await SELF.fetch("https://link.test/secret", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "password=wrong",
      redirect: "manual",
    });

    expect(res.status).toBe(401);
    const rows = await clickRows();
    expect(rows.at(-1)?.outcome).toBe("password_failed");
  });

  it("redirects on the correct password and sets an access cookie", async () => {
    await createProtected("hunter2");

    const res = await SELF.fetch("https://link.test/secret", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "password=hunter2",
      redirect: "manual",
    });

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://example.com/private");
    expect(res.headers.get("set-cookie")).toContain("ml_pw_secret=");
    expect((await clickRows()).at(-1)?.outcome).toBe("redirect");
  });

  it("posts the form back to the stored slug, not the one taken from the URL", async () => {
    await createProtected("hunter2");

    const res = await SELF.fetch("https://link.test/SECRET", { redirect: "manual" });

    expect(res.status).toBe(401);
    expect(await res.text()).toContain('action="/secret"');
  });

  it("lets a holder of a valid cookie through without asking again", async () => {
    await createProtected("hunter2");

    const first = await SELF.fetch("https://link.test/secret", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "password=hunter2",
      redirect: "manual",
    });
    const cookie = (first.headers.get("set-cookie") ?? "").split(";")[0] as string;

    const second = await SELF.fetch("https://link.test/secret", {
      headers: { cookie },
      redirect: "manual",
    });

    expect(second.status).toBe(302);
    expect(second.headers.get("location")).toBe("https://example.com/private");
  });
});

describe("the password interstitial is throttled", () => {
  async function createProtected(slug: string, password: string) {
    const salt = randomSalt();
    return createLink(
      env.DB,
      {
        slug,
        targetUrl: `https://example.com/${slug}`,
        passwordSalt: salt,
        passwordHash: await hashPassword(password, salt),
      },
      NOW_SECONDS(),
    );
  }

  function submit(slug: string, password: string) {
    return SELF.fetch(`https://link.test/${slug}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: `password=${password}`,
      redirect: "manual",
    });
  }

  it("answers 429 with Retry-After once the attempt budget is spent", async () => {
    await createProtected("guarded", "hunter2");

    const statuses: number[] = [];
    for (let i = 0; i < 9; i++) {
      statuses.push((await submit("guarded", `wrong${i}`)).status);
    }

    // Unauthenticated PBKDF2 at 100k iterations is both a brute-force oracle
    // and a CPU amplification vector, so attempts must stop being answered.
    expect(statuses).toContain(429);

    const locked = await submit("guarded", "wrong-again");
    expect(locked.status).toBe(429);
    expect(locked.headers.get("retry-after")).toMatch(/^\d+$/);
    // A throttled caller is told they were throttled, not that the password
    // they submitted was wrong — the request was never verified.
    expect(await locked.text()).toContain("Too many attempts");
  });

  it("refuses even the correct password while the throttle is tripped", async () => {
    await createProtected("guarded", "hunter2");
    for (let i = 0; i < 9; i++) await submit("guarded", `wrong${i}`);

    const res = await submit("guarded", "hunter2");

    expect(res.status).toBe(429);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("records the throttled attempt as password_failed, not a new outcome", async () => {
    await createProtected("guarded", "hunter2");
    for (let i = 0; i < 9; i++) await submit("guarded", `wrong${i}`);

    const outcomes = new Set((await clickRows()).map((row) => row.outcome));
    expect([...outcomes]).toEqual(["password_failed"]);
  });

  it("does not lock a different link out because of this one's failures", async () => {
    await createProtected("guarded", "hunter2");
    await createProtected("other", "hunter2");
    for (let i = 0; i < 9; i++) await submit("guarded", `wrong${i}`);

    const res = await submit("other", "hunter2");

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://example.com/other");
  });

  it("clears the budget once the correct password is accepted", async () => {
    await createProtected("guarded", "hunter2");
    for (let i = 0; i < 4; i++) await submit("guarded", `wrong${i}`);

    expect((await submit("guarded", "hunter2")).status).toBe(302);

    const statuses: number[] = [];
    for (let i = 0; i < 7; i++) {
      statuses.push((await submit("guarded", `wrong${i}`)).status);
    }
    expect(statuses).not.toContain(429);
  });
});
