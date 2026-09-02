import { test as base, type Page } from "@playwright/test";

/**
 * Fixed, fake, no-production-meaning test credentials — the same values
 * `seed.ts` logs in with and CI writes into `.dev.vars` before the Worker
 * starts (see `.github/workflows/ci.yml`). Never the developer's real
 * `.dev.vars`: CI has no such file, and a suite that needed one could not run
 * there.
 *
 * `HASH_SECRET` deliberately is NOT here — nothing in this suite reads it
 * directly, and the value CI writes must independently satisfy
 * `src/lib/secrets.ts`'s 32-character minimum (discovered empirically: the
 * brief's first suggested value was 28 characters and made every redirect and
 * every login fail with a 500. See the Task 15 report.).
 */
export const CREDENTIALS = {
  username: process.env.E2E_ADMIN_USER ?? "e2e",
  password: process.env.E2E_ADMIN_PASSWORD ?? "e2e-password-not-a-secret",
};

/** Playwright's own `webServer.url` (playwright.config.ts) and `seed.ts`'s
 *  API calls both need this same origin — centralised here rather than
 *  hardcoded twice. */
export const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:8787";

/**
 * Signs in through the real form — not by seeding a storage state — so every
 * spec that needs a session also gets one real pass through the login flow.
 * Waits for the URL rather than for a specific element: `auth.spec.ts` pins
 * the exact destination itself, so this helper only needs "sign-in
 * finished", which every other spec can treat as an implementation detail.
 */
export async function login(page: Page): Promise<void> {
  await page.goto("/app/login");
  await page.getByLabel("Username").fill(CREDENTIALS.username);
  await page.getByLabel("Password").fill(CREDENTIALS.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => url.pathname === "/app");
}

/**
 * Every spec except `auth.spec.ts` wants a page that is already signed in —
 * `auth.spec.ts` is the one place the login flow itself, and the
 * unauthenticated redirect, are the thing under test, so it deliberately uses
 * the plain `page` fixture instead of this one.
 */
export const test = base.extend<{ authenticatedPage: Page }>({
  authenticatedPage: async ({ page }, use) => {
    await login(page);
    await use(page);
  },
});

export { expect } from "@playwright/test";
