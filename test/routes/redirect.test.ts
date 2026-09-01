import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { createLink, updateLink } from "../../src/db/links";
import { hashPassword, randomSalt } from "../../src/lib/crypto";

const NOW_SECONDS = () => Math.floor(Date.now() / 1000);

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM clicks").run();
  await env.DB.prepare("DELETE FROM links").run();
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
