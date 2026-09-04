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
supported campaign labels in the link. Campaign source, medium and name are
accepted only as short letters/digits labels; free-form term and content
parameters are not recorded.</p>

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

<h2>Who is responsible</h2>
<p>The data controller for this service is <strong>Andrea Margiovanni</strong>,
reachable at <a href="mailto:andrea@margiovanni.it">andrea@margiovanni.it</a>.
Write there with any question about this notice, or about the data described
below.</p>

<h2>Why</h2>
<p>The legal basis is <strong>legitimate interest</strong> under Article 6(1)(f)
GDPR: measuring how the controller's own links perform. The data is
pseudonymous, there is no profiling, and no decision is made about any
individual.</p>

<h2>How long</h2>
<p>Individual records are deleted after <strong>${retentionDays} days</strong>.
Daily totals and coarse aggregate counts may be kept beyond that. City, network
operator, referring host and campaign breakdowns are recorded only when at
least three clicks share a value for one link and day, and those breakdowns are
also deleted after <strong>${retentionDays} days</strong>.</p>

<h2>Your rights</h2>
<p>You have the right to ask what is held about you, to have it corrected or
erased, to object to this processing, and to complain to a supervisory
authority — in Italy, the <a href="https://www.garanteprivacy.it">Garante per
la protezione dei dati personali</a>.</p>
<p>One consequence of the design above is worth stating plainly: because no
identifier persists beyond the current UTC day, the controller genuinely cannot
locate the records relating to a specific person, even when asked. Article 11
GDPR covers this — the controller is not obliged to collect extra information
purely to make you identifiable, and doing so would defeat the protection.
Write to <a href="mailto:andrea@margiovanni.it">andrea@margiovanni.it</a>
anyway if you have a question; that limit is about lookup, not about
answering.</p>
</body>
</html>`;
}

export function registerPublicRoutes(app: Hono<{ Bindings: Env }>): void {
  /**
   * The dashboard shell.
   *
   * `/app.html`, not `/index.html`: Cloudflare's asset router serves a
   * matching file before this Worker runs, and at `/` that file is the asset
   * root's `index.html` — which is the public landing page (`web/index.html`,
   * see `web/vite.config.ts`'s two build inputs). The shell is a separate
   * document precisely so the bare domain never serves the dashboard to
   * someone who is not signed in.
   *
   * The asset router already answers `/app` with `app.html` on its own
   * (`html_handling` defaults to "auto-trailing-slash", which serves
   * `foo.html` at `/foo`). This route is what covers everything below it —
   * `/app/links/12` matches no file, falls through to the Worker, and needs
   * the shell so the SPA's router can take over.
   */
  const shell = (c: { env: Env; req: { url: string } }) =>
    c.env.ASSETS.fetch(new Request(new URL("/app.html", c.req.url)));

  app.get("/app", (c) => shell(c));
  app.get("/app/*", (c) => shell(c));

  app.get("/privacy", (c) => c.html(privacyHtml(c.env.RAW_RETENTION_DAYS, c.env.SHORT_DOMAIN)));

  /**
   * Short links stay out of search indexes; the landing page does not.
   *
   * `Disallow: /` used to be the whole file, from when the root answered
   * nothing. Now `/` is the public landing page (`web/index.html`) and is the
   * one path here worth indexing, so it is allowed back — and only it.
   * `Allow: /$` matches the root and nothing below it, and the longest
   * matching rule wins for the crawlers that implement the standard, so a
   * short link is still disallowed by the shorter, broader rule.
   *
   * The dashboard shell carries its own `noindex` meta tag as well
   * (`web/app.html`), because robots.txt asks rather than tells.
   */
  app.get("/robots.txt", (c) =>
    c.text("User-agent: *\nAllow: /$\nDisallow: /\n", 200, {
      "content-type": "text/plain; charset=utf-8",
    }),
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
        "Contact: mailto:andrea@margiovanni.it",
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
