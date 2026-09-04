import type { Hono } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { issueLinkToken, verifyLinkToken } from "../auth/link-token";
import { clearLoginFailures, reserveLoginAttempt } from "../auth/rate-limit";
import { findBySlug, type LinkRow } from "../db/links";
import { recordClick } from "../ingest/record-click";
import { ipHash, verifyPassword } from "../lib/crypto";
import { buildRequestContext } from "../lib/request-context";
import { requireHashSecret } from "../lib/secrets";
import { normaliseSlug } from "../lib/slug";
import type { Env } from "../types";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(title)}</title>
<style>
:root { color-scheme: light dark; --bg: #fbfbfd; --fg: #16161a; --muted: #6b6b76; --card: #fff; --border: #e3e3e8; --accent: #4338ca; }
@media (prefers-color-scheme: dark) {
  :root { --bg: #0d0d11; --fg: #f2f2f5; --muted: #9a9aa5; --card: #17171d; --border: #2a2a33; --accent: #a5b4fc; }
}
* { box-sizing: border-box; }
body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px;
  background: var(--bg); color: var(--fg);
  font: 16px/1.55 system-ui, -apple-system, "Segoe UI", sans-serif; }
main { width: 100%; max-width: 26rem; background: var(--card); border: 1px solid var(--border);
  border-radius: 14px; padding: 28px; }
h1 { margin: 0 0 8px; font-size: 1.25rem; }
p { margin: 0 0 20px; color: var(--muted); }
label { display: block; font-weight: 600; margin-bottom: 6px; font-size: .9rem; }
input { width: 100%; padding: 11px 13px; font-size: 1rem; border-radius: 9px;
  border: 1px solid var(--border); background: var(--bg); color: var(--fg); }
input:focus-visible, button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
button { width: 100%; margin-top: 16px; padding: 11px; font-size: 1rem; font-weight: 600;
  border: 0; border-radius: 9px; background: var(--accent); color: #fff; cursor: pointer; }
.error { color: #b91c1c; font-weight: 600; margin: 0 0 14px; }
@media (prefers-color-scheme: dark) { .error { color: #fca5a5; } }
</style>
</head>
<body><main>${body}</main></body>
</html>`;
}

/**
 * `slug` must be the slug from the stored `links` row, not the one parsed out
 * of the URL. It is the only attacker-influenced value this file emits into
 * HTML, and taking it from the row keeps the reason it is safe local to this
 * file instead of resting on `findBySlug` having matched.
 */
function passwordPage(slug: string, error: "wrong" | "throttled" | null): string {
  const message =
    error === "wrong"
      ? "Wrong password. Try again."
      : error === "throttled"
        ? "Too many attempts. Try again in a few minutes."
        : null;

  return page(
    "Password required",
    `<h1>This link is protected</h1>
     <p>Enter the password to continue.</p>
     ${message ? `<p class="error" role="alert">${escapeHtml(message)}</p>` : ""}
     <form method="post" action="/${escapeHtml(slug)}">
       <label for="password">Password</label>
       <input id="password" name="password" type="password" autocomplete="current-password"
              maxlength="200" autofocus required>
       <button type="submit">Continue</button>
     </form>`,
  );
}

function noticePage(title: string, message: string): string {
  return page(title, `<h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p>`);
}

function isExpired(link: LinkRow, now: number): boolean {
  return link.expires_at !== null && link.expires_at <= now;
}

function cookieName(slug: string): string {
  return `ml_pw_${slug}`;
}

/**
 * Throttle key for a password submission.
 *
 * The daily IP hash alone would let failures against one link lock a visitor
 * out of every other protected link, so the slug is part of the key. It shares
 * the `login_attempts` table with the admin login; the admin key is
 * `ipHash(...)` with no suffix, so the two namespaces cannot collide.
 */
function passwordThrottleKey(ip: string, slug: string): string {
  return `${ip}:${slug}`;
}

export function registerRedirect(app: Hono<{ Bindings: Env }>): void {
  app.get("/:slug", async (c) => {
    // Before anything else, including the lookup: a request whose click cannot
    // be hashed securely, and whose password cookie cannot be trusted, is
    // refused rather than served with the security and privacy controls off.
    const secret = requireHashSecret(c.env);

    const slug = normaliseSlug(c.req.param("slug"));
    const link = await findBySlug(c.env.DB, slug);

    if (!link || link.deleted_at !== null) {
      return c.text("Not found", 404);
    }

    const now = Math.floor(Date.now() / 1000);
    const context = buildRequestContext(c.req.raw);
    const record = (outcome: Parameters<typeof recordClick>[1]["outcome"]) =>
      c.executionCtx.waitUntil(
        recordClick(c.env, { linkId: link.id, slug, outcome, context, now }),
      );

    if (link.is_active === 0) {
      record("inactive");
      return c.html(noticePage("Link disabled", "This link is no longer active."), 410);
    }

    if (isExpired(link, now)) {
      record("expired");
      return link.expired_url
        ? c.redirect(link.expired_url, 302)
        : c.html(noticePage("Link expired", "This link is no longer available."), 410);
    }

    if (link.password_hash) {
      const token = getCookie(c, cookieName(slug));
      const allowed = token ? await verifyLinkToken(secret, slug, token, now) : false;
      if (!allowed) {
        record("password_required");
        return c.html(passwordPage(link.slug, null), 401);
      }
    }

    record("redirect");
    return c.redirect(link.target_url, 302);
  });

  app.post("/:slug", async (c) => {
    // See the guard in the GET handler above; the same reasoning applies to the
    // token this handler is about to mint.
    const secret = requireHashSecret(c.env);

    const slug = normaliseSlug(c.req.param("slug"));
    const link = await findBySlug(c.env.DB, slug);

    if (!link || link.deleted_at !== null || !link.password_hash || !link.password_salt) {
      return c.text("Not found", 404);
    }

    const now = Math.floor(Date.now() / 1000);
    const context = buildRequestContext(c.req.raw);
    const recordFailure = () =>
      c.executionCtx.waitUntil(
        recordClick(c.env, { linkId: link.id, slug, outcome: "password_failed", context, now }),
      );

    const body = await c.req.parseBody();
    const submitted = typeof body.password === "string" ? body.password : "";
    if (submitted.length > 200) {
      recordFailure();
      return c.html(passwordPage(link.slug, "wrong"), 400);
    }

    // This endpoint is unauthenticated and every accepted submission performs
    // an expensive password derivation. Reserving the attempt first makes the
    // throttle atomic and keeps locked-out callers away from that work.
    const throttleKey = passwordThrottleKey(await ipHash(secret, context.ip, now), slug);
    const limit = await reserveLoginAttempt(c.env.DB, throttleKey, now);
    if (!limit.allowed) {
      // `password_failed` rather than a new outcome value: the schema's set is
      // consumed by the dashboard, and this is a failed password attempt.
      recordFailure();
      return c.html(passwordPage(link.slug, "throttled"), 429, {
        "retry-after": String(limit.retryAfter),
      });
    }

    const correct = await verifyPassword(submitted, link.password_salt, link.password_hash);

    if (!correct) {
      recordFailure();
      return c.html(passwordPage(link.slug, "wrong"), 401);
    }

    await clearLoginFailures(c.env.DB, throttleKey);

    setCookie(c, cookieName(slug), await issueLinkToken(secret, slug, now), {
      path: `/${slug}`,
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
      maxAge: 600,
    });

    c.executionCtx.waitUntil(
      recordClick(c.env, { linkId: link.id, slug, outcome: "redirect", context, now }),
    );
    return c.redirect(link.target_url, 302);
  });
}
