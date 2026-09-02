import { expect, test } from "@playwright/test";
import { login } from "./fixtures";

/**
 * `BrowserRouter basename="/app"` (`web/src/main.tsx`) prepends `/app` to
 * every navigation target itself. Two call sites used to pass a target that
 * already carried it — `RequireSession`'s post-401 redirect and `Login`'s
 * post-sign-in redirect — producing `/app/app/...`, a URL matching no route
 * in `App.tsx`. The 401 case is the dangerous one: it sent an unauthenticated
 * visitor into the protected catch-all route, which itself 401s and redirects
 * back here — an infinite loop. Fixed in `2236979`.
 *
 * 599 tests stayed green through this because every other test file in the
 * suite mounts a router with no basename at all, which resolves a doubled
 * target to something that merely looks plausible. Nothing in `jsdom` ever
 * exercises real browser navigation, so nothing there could catch a loop.
 */

test.describe("navigation — the basename-doubling defects (2236979)", () => {
  test("signs in and lands on the overview, at exactly /app", async ({ page }) => {
    await login(page);

    expect(new URL(page.url()).pathname).toBe("/app");
    await expect(page.getByRole("heading", { name: "Overview", level: 1 })).toBeVisible();
  });

  test("redirects an unauthenticated visitor to sign-in once, not in a loop", async ({ page }) => {
    const navigations: string[] = [];
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) navigations.push(frame.url());
    });

    await page.goto("/app/links");
    await page.waitForURL((url) => url.pathname === "/app/login");

    // The final URL alone proves nothing: the original bug could reach
    // /app/login and keep navigating past it. Let the loop's failure mode a
    // real window to show itself, then confirm nothing happened after.
    const countAtLogin = navigations.length;
    await page.waitForTimeout(1500);

    expect(
      navigations.length,
      `kept navigating after reaching /app/login: ${navigations.join(" -> ")}`,
    ).toBe(countAtLogin);
    // 4 is not an arbitrary number: a correct run produces exactly 3
    // (`framenavigated` fires twice for the initial /app/links — Chromium
    // reporting both the goto and BrowserRouter's own initial route match —
    // then once more for the redirect to /app/login), confirmed by logging
    // `navigations` across two independent runs before this bound was
    // written. 4 leaves one navigation of headroom above that, not more —
    // the doubled-basename bug this test pins does not produce "one extra"
    // navigation, it produces a redirect loop that keeps firing
    // `framenavigated` continuously for the whole 1500ms window above, so a
    // real regression here climbs into the tens, not to 5. A bound this
    // tight is only safe because the "nothing navigated after reaching
    // /app/login" check above it already proves the count has settled —
    // this one is purely "and it settled at a small number", not the test's
    // only defence against a loop.
    expect(
      navigations.length,
      `expected a small, bounded number of navigations; saw: ${navigations.join(" -> ")}`,
    ).toBeLessThanOrEqual(4);
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  });

  test("signing out returns to /app/login", async ({ page }) => {
    await login(page);
    await page.goto("/app/settings");

    await page.getByRole("button", { name: "Sign out" }).click();
    await page.waitForURL((url) => url.pathname === "/app/login");
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  });

  test("a mistyped path shows the not-found page, not a development placeholder", async ({
    page,
  }) => {
    await login(page);
    await page.goto("/app/lnks");

    await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Back to overview" })).toBeVisible();
  });
});
