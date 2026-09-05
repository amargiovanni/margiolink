import type { FullConfig } from "@playwright/test";
import { BASE_URL, CREDENTIALS } from "./fixtures";

/**
 * Runs once, after Playwright's `webServer` has already answered `/_health`
 * (global setup always runs after `webServer` in Playwright's own task order),
 * and builds every fixture through the real HTTP API — never by touching D1
 * directly. That makes the seed itself a test of `/api/auth/login`,
 * `/api/links`, `/api/tags` and the redirect endpoint.
 *
 * **Idempotent across repeated runs against the same persistent local D1** —
 * `npm run e2e` run twice in a row, with nothing resetting the database
 * between them, must succeed both times, the same way CI's always-empty
 * runner does. `ensureTag`/`ensureLink` below find-and-reset rather than
 * blindly creating; see their own comments for why they take different
 * approaches (tags have a real hard delete, links do not).
 *
 * Two things this environment genuinely cannot fake, and does not pretend to:
 *
 * 1. **Country.** `request.cf` under `wrangler dev --local` is fetched once
 *    (from `https://workers.cloudflare.com/cf.json`, or a bundled fallback)
 *    and reused for every request in the process — confirmed by reading
 *    `miniflare`'s `setupCf` directly. There is no per-request override, so
 *    every seeded click carries the same country. The map and the country
 *    breakdown get one populated slice, not several — real, not empty, just
 *    not varied.
 * 2. **Day.** Every click's timestamp is `Math.floor(Date.now() / 1000)`,
 *    computed inside the Worker — nothing in the API lets a caller backdate
 *    it (correctly: an endpoint that did would let anyone forge history).
 *    Every seeded click lands in the current UTC day, so the heatmap
 *    (day-of-week × hour) lights up one row, not seven.
 *
 * What IS controllable from an HTTP client — user-agent and referrer — is
 * varied on purpose, so the device, browser and channel breakdowns have more
 * than one bucket to draw.
 */

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6_1) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1",
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36",
] as const;

// One host per referrer_type bucket `src/lib/referrer.ts` classifies, plus
// `null` for "direct" — so the Overview "Channels" panel has more than one
// bar to draw, not just "direct".
const REFERERS: (string | null)[] = [
  null,
  "https://www.google.com/search?q=short+links",
  "https://twitter.com/i/status/1",
  "https://mail.google.com/mail/u/0/",
];

const CLICK_COUNT = 48;
const PRIMARY_SLUG = "e2e-primary";
const ARCHIVED_SLUG = "e2e-archived";
const PROTECTED_SLUG = "e2e-protected";
const PROTECTED_PASSWORD = "e2e-link-password";

async function waitForHealth(): Promise<void> {
  const deadline = Date.now() + 30_000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${BASE_URL}/_health`);
      if (response.ok) return;
      lastError = new Error(`/_health answered ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(
    `The Worker never answered /_health at ${BASE_URL} — is playwright.config.ts's webServer up? Last error: ${String(lastError)}`,
  );
}

async function loginForCookie(): Promise<string> {
  const response = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(CREDENTIALS),
  });
  if (!response.ok) {
    throw new Error(
      `Seed login failed with ${response.status}: ${await response.text()}. ` +
        "playwright.config.ts's webServer should have passed CREDENTIALS to " +
        "wrangler dev as --var ADMIN_USER/--var ADMIN_PASSWORD — check its command.",
    );
  }
  const setCookie = response.headers.get("set-cookie");
  if (!setCookie) throw new Error("Seed login succeeded but set no session cookie.");
  // Only the name=value pair is needed on later requests — Path/HttpOnly/
  // Secure/SameSite are directives to the browser, not part of what gets sent back.
  return setCookie.split(";", 1)[0] ?? "";
}

async function api<T>(cookie: string, method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      cookie,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`${method} ${path} failed with ${response.status}: ${await response.text()}`);
  }
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

interface LinkSummary {
  id: number;
  slug: string;
  deletedAt: number | null;
}
interface LinksListResponse {
  links: LinkSummary[];
}
interface LinkResponse {
  link: LinkSummary;
}
interface TagSummary {
  id: number;
  name: string;
}
interface TagsListResponse {
  tags: TagSummary[];
}
interface TagResponse {
  tag: TagSummary;
}
interface LiveResponse {
  clicks: unknown[];
}

/**
 * Idempotent tag creation. `/api/tags` has a real hard `DELETE`
 * (`src/db/tags.ts`), so — unlike links, below — reset here really does mean
 * delete-then-create: find any tag with this name from a previous run
 * against this same persistent local D1, delete it, then create fresh. A
 * 409 after that delete is a genuine, unexplained duplicate and is left to
 * throw rather than swallowed — this seed running through the real API is
 * exactly what would catch a real duplicate-name bug in it.
 */
async function ensureTag(cookie: string, name: string, color: string): Promise<TagSummary> {
  const { tags } = await api<TagsListResponse>(cookie, "GET", "/api/tags");
  const existing = tags.find((tag) => tag.name === name);
  if (existing) await api(cookie, "DELETE", `/api/tags/${existing.id}`);
  const created = await api<TagResponse>(cookie, "POST", "/api/tags", { name, color });
  return created.tag;
}

async function findLinkBySlug(cookie: string, slug: string): Promise<LinkSummary | null> {
  const query = `search=${encodeURIComponent(slug)}&limit=10`;
  const active = await api<LinksListResponse>(cookie, "GET", `/api/links?${query}&status=all`);
  const foundActive = active.links.find((link) => link.slug === slug);
  if (foundActive) return foundActive;
  const deleted = await api<LinksListResponse>(cookie, "GET", `/api/links?${query}&status=deleted`);
  return deleted.links.find((link) => link.slug === slug) ?? null;
}

/**
 * Idempotent link creation — deliberately NOT delete-then-create, unlike
 * `ensureTag` above. `/api/links` has no hard-delete endpoint: `DELETE`
 * only soft-deletes (`softDeleteLink`, `src/db/links.ts`), and the `slug`
 * column's `UNIQUE` constraint has no `deleted_at` exception (confirmed by
 * reading `migrations/0001_init.sql` and interactively: creating a link,
 * soft-deleting it, then creating another with the same slug answers 409
 * `slug_taken` every time). A slug this suite creates once stays taken by
 * that row forever, so on a second run against the same persistent local D1
 * the only idempotent option is to find that row and restore-and-normalise
 * it in place rather than trying to recreate a duplicate.
 */
async function ensureLink(
  cookie: string,
  input: {
    slug: string;
    title: string;
    description?: string;
    targetUrl: string;
    password?: string;
  },
): Promise<LinkSummary> {
  const existing = await findLinkBySlug(cookie, input.slug);
  if (!existing) {
    const created = await api<LinkResponse>(cookie, "POST", "/api/links", input);
    return created.link;
  }
  if (existing.deletedAt) {
    await api(cookie, "POST", `/api/links/${existing.id}/restore`);
  }
  const updated = await api<LinkResponse>(cookie, "PATCH", `/api/links/${existing.id}`, {
    targetUrl: input.targetUrl,
    title: input.title,
    description: input.description ?? null,
    password: input.password,
    isActive: true,
  });
  return updated.link;
}

async function fireClick(slug: string, index: number): Promise<void> {
  const userAgent = USER_AGENTS[index % USER_AGENTS.length];
  const referer = REFERERS[index % REFERERS.length];
  const headers: Record<string, string> = { "user-agent": userAgent as string };
  if (referer) headers.referer = referer;
  // `redirect: "manual"` — a followed redirect would actually fetch
  // https://example.com/ forty-eight times for no reason this suite cares
  // about; the click is already recorded by the time the 302 comes back.
  await fetch(`${BASE_URL}/${slug}`, { headers, redirect: "manual" });
}

/** Confirms the fire-and-forget clicks above actually landed before handing
 *  control to the tests — `recordClick` runs inside `c.executionCtx.waitUntil`
 *  (src/routes/redirect.ts), so the redirect response returns before the D1
 *  write is guaranteed to have committed. Polling `/api/stats/live` (rather
 *  than assuming a fixed delay is long enough) makes the seed self-verifying:
 *  a suite that starts against a dashboard with no data in it fails here,
 *  with a clear cause, instead of failing confusingly in every spec. */
async function waitForClicksToLand(cookie: string, expected: number): Promise<void> {
  const deadline = Date.now() + 20_000;
  let seen = 0;
  while (Date.now() < deadline) {
    const live = await api<LiveResponse>(cookie, "GET", "/api/stats/live?limit=100");
    seen = live.clicks.length;
    if (seen >= expected) return;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(
    `Seeded ${expected} clicks but /api/stats/live only shows ${seen} after 20s — ` +
      "the dashboard would render empty states. See src/routes/redirect.ts's waitUntil.",
  );
}

export default async function globalSetup(_config: FullConfig): Promise<void> {
  await waitForHealth();
  const cookie = await loginForCookie();

  const tag = await ensureTag(cookie, "Launch", "#199e70");

  // Link 1: the CSV formula-injection fixture (artefacts.spec.ts, Step 5) —
  // its title starts with "=1+1", which a spreadsheet reads as a formula
  // unless the export neutralises it (fixed in b34c31d). Also the QR/live
  // dashboard fixture: every seeded click below lands on this link.
  const primary = await ensureLink(cookie, {
    targetUrl: "https://example.com/",
    slug: PRIMARY_SLUG,
    title: "=1+1 seasonal launch",
    description: "Seed fixture for the end-to-end suite.",
  });
  await api(cookie, "PUT", `/api/links/${primary.id}/tags`, { tagIds: [tag.id] });

  // Link 2: soft-deleted immediately — proves the working list and the CSV
  // export (both backed by /api/links' default "all" status, which excludes
  // deleted rows — src/db/links.ts) never show a deleted link back.
  // `ensureLink` guarantees this is active before the DELETE below runs
  // (restoring it first if a previous run left it soft-deleted), so this
  // DELETE always finds a live row to remove.
  const archived = await ensureLink(cookie, {
    targetUrl: "https://example.com/",
    slug: ARCHIVED_SLUG,
    title: "Archived before the suite ran",
  });
  await api(cookie, "DELETE", `/api/links/${archived.id}`);

  // Link 3: a real protected-link form flow. The browser spec intercepts the
  // external destination so it can prove the POST's 302 is followed under the
  // response CSP without making a network request to that destination.
  await ensureLink(cookie, {
    targetUrl: "https://example.com/e2e-protected-destination",
    slug: PROTECTED_SLUG,
    title: "Protected browser navigation fixture",
    password: PROTECTED_PASSWORD,
  });

  // Real clicks through the real redirect route — see the module comment for
  // what this can and cannot vary in this environment. These accumulate
  // across repeated runs against the same persistent local D1 rather than
  // being reset — real click history growing over time is the actual
  // product behaviour, not junk, and every assertion here only checks a
  // lower bound (waitForClicksToLand) or a specific row's own fields, never
  // an exact total.
  for (let i = 0; i < CLICK_COUNT; i++) {
    await fireClick(primary.slug, i);
  }

  await waitForClicksToLand(cookie, CLICK_COUNT);
  console.log(`[seed] ready: 3 links, 1 tag, ${CLICK_COUNT} clicks confirmed landed`);
}
