import type { Hono } from "hono";
import type { Env } from "../types";

function privacyHtml(retentionDays: string, domain: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Privacy notice</title>
<style>
:root { color-scheme: light dark; --bg: #fbfbfd; --fg: #16161a; --muted: #6b6b76; }
@media (prefers-color-scheme: dark) { :root { --bg: #0d0d11; --fg: #f2f2f5; --muted: #9a9aa5; } }
body { margin: 0 auto; max-width: 44rem; padding: 48px 24px; background: var(--bg); color: var(--fg);
  font: 16px/1.65 system-ui, -apple-system, "Segoe UI", sans-serif; }
h1 { font-size: 1.6rem; margin-bottom: .25em; }
h2 { font-size: 1.1rem; margin-top: 2em; }
p, li { color: var(--muted); }
strong { color: var(--fg); }
</style>
</head>
<body>
<h1>Privacy notice</h1>
<p>This page explains what ${domain} records when you follow a short link.</p>

<h2>What is recorded</h2>
<p>When a short link is opened we record the time, the country, region, city
and time zone your request was routed from, which datacenter served the
request, your network operator, the type of device, operating system and
browser, your preferred language, the site that referred you, and any
campaign parameters in the link.</p>

<h2>What is not recorded</h2>
<p><strong>Your IP address is never stored</strong>, in any form, and neither is
your full browser user-agent string. To tell one visitor from another without
identifying anyone, a short code is derived from your IP address, browser and
the link, using a key that changes at midnight UTC. <strong>In the worst case,
a visitor's code changes within 24 hours</strong>, so activity cannot be linked
across days. No tracking cookie is set, and the only cookie a visitor may
receive is a short-lived, strictly necessary one that remembers they entered
the correct password for a protected link — it lasts ten minutes, is scoped to
that link alone, and is not used for measurement.</p>

<h2>Why</h2>
<p>The legal basis is <strong>legitimate interest</strong> under Article 6(1)(f)
GDPR: measuring how the operator's own links perform. The data is pseudonymous,
there is no profiling, and no decision is made about any individual.</p>

<h2>How long</h2>
<p>Individual records are deleted after <strong>${retentionDays} days</strong>.
Only aggregate counts, which identify nobody, are kept beyond that.</p>

<h2>Your rights</h2>
<p>Because no identifier persists beyond 24 hours, the operator cannot locate
records relating to a specific person, and Article 11 GDPR applies. For any
question about this notice, contact the operator of ${domain}.</p>
</body>
</html>`;
}

export function registerPublicRoutes(app: Hono<{ Bindings: Env }>): void {
  app.get("/privacy", (c) => c.html(privacyHtml(c.env.RAW_RETENTION_DAYS, c.env.SHORT_DOMAIN)));

  app.get("/robots.txt", (c) =>
    c.text("User-agent: *\nDisallow: /\n", 200, { "content-type": "text/plain; charset=utf-8" }),
  );

  // RFC 9116. The CRA's Annex I Part II requires a coordinated vulnerability
  // disclosure policy; this is its machine-readable pointer, and SECURITY.md is
  // the policy itself.
  //
  // `Expires` is deliberately a fixed date rather than one computed at request
  // time. A date that renews itself never expires, which is exactly what the
  // field exists to prevent — a stale file that still claims to be current.
  // Refresh it when the policy is reviewed.
  app.get("/.well-known/security.txt", (c) =>
    c.text(
      [
        "Contact: https://github.com/amargiovanni/margiolink/security/advisories/new",
        "Expires: 2027-09-01T00:00:00.000Z",
        "Policy: https://github.com/amargiovanni/margiolink/blob/main/SECURITY.md",
        "Preferred-Languages: en, it",
        `Canonical: https://${c.env.SHORT_DOMAIN}/.well-known/security.txt`,
        "",
      ].join("\n"),
      200,
      { "content-type": "text/plain; charset=utf-8" },
    ),
  );
}
