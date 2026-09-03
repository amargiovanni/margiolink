import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

/**
 * The landing page at `/`, in a real browser through the real asset router.
 *
 * `test/routes/landing.test.ts` already checks the built document — that it
 * exists, that its images resolve, that it is indexable. None of that answers
 * the question this file exists for: **is it actually what `/` serves?**
 *
 * That answer is not in the Worker's code. Cloudflare serves a matching
 * static asset before the Worker runs, and with the default
 * `html_handling: "auto-trailing-slash"` the file it serves at `/` is the
 * asset root's `index.html` — which is why the landing is called
 * `index.html` and the dashboard shell was renamed `app.html`. No unit test
 * in this repository can see that behaviour, because the vitest pool invokes
 * the Worker's `fetch` handler and reproduces none of the router in front of
 * it. `wrangler dev` does emulate it, so this suite — which runs against a
 * real `wrangler dev` — is the only place the arrangement is verified end to
 * end. If the two documents' names are ever swapped back, the first
 * assertion below fails and the reason is written above it.
 *
 * These tests use the plain `page` fixture, not `authenticatedPage`: the
 * landing is for people who have never signed in, and testing it from a
 * signed-in session would quietly stop checking that.
 */

test.describe("the landing page", () => {
  test("is what the bare domain serves, not the dashboard shell", async ({ page }) => {
    const response = await page.goto("/");

    expect(response?.status()).toBe(200);
    await expect(page).toHaveTitle(/MargioLink/);

    // The shell would have an empty <div id="root"> and nothing else; the
    // landing has its content in the markup.
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Count the click");
    await expect(page.locator("#root")).toHaveCount(0);
  });

  test("says it is free and open source, and links to the repository", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByText("Free and open source · MIT")).toBeVisible();
    await expect(page.getByRole("link", { name: "GitHub", exact: true }).first()).toHaveAttribute(
      "href",
      /github\.com\/amargiovanni\/margiolink/,
    );
  });

  test("reaches the pages it points at", async ({ page }) => {
    await page.goto("/");

    // Not `page.click()` on each: following four links in one test would
    // reload the page three times for no extra coverage. What matters is
    // that the destinations answer, which is a request each.
    for (const path of ["/privacy", "/.well-known/security.txt", "/app"]) {
      const response = await page.request.get(path);
      expect(response.status(), `${path} answered ${response.status()}`).toBe(200);
    }
  });

  test("shows its screenshots rather than three broken images", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const broken = await page.evaluate(() =>
      [...document.querySelectorAll("img")]
        .filter((image) => !image.complete || image.naturalWidth === 0)
        .map((image) => image.getAttribute("src") ?? "(no src)"),
    );

    // Anti-vacuity: with no images at all, "none of them are broken" is true
    // and meaningless.
    expect(await page.locator("img").count()).toBeGreaterThanOrEqual(3);
    expect(broken, `broken images: ${broken.join(", ")}`).toEqual([]);
  });

  /**
   * The reveal animations start from `opacity: 0`, gated behind a `js` class
   * that `index.html`'s inline bootstrap adds and removes again if the module
   * never loads. Get that wrong and the page is blank below the fold — for
   * everyone, silently. So: the sections are visible.
   */
  test("shows every section once the script has run", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    for (const id of ["record", "rotation", "dashboard", "features", "run", "open"]) {
      const section = page.locator(`#${id}`);
      await section.scrollIntoViewIfNeeded();
      await expect(section).toBeVisible();
      await expect(section.getByRole("heading").first()).toBeVisible();
    }
  });

  test("remembers a theme choice the way the dashboard does", async ({ page }) => {
    await page.goto("/");

    const toggle = page.getByRole("button", { name: /theme/i });
    await expect(toggle).toBeVisible();

    await toggle.click();
    // Both pages read and write the same `margiolink:theme` key, so a choice
    // made here is the choice the dashboard opens with.
    const stored = await page.evaluate(() => localStorage.getItem("margiolink:theme"));
    expect(stored === "light" || stored === "dark").toBe(true);
    await expect(page.locator("html")).toHaveAttribute("data-theme", stored as string);

    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", stored as string);
  });
});

/**
 * Same sweep `a11y.spec.ts` runs over the dashboard, applied to the one page
 * most people will actually see, in both themes. A marketing page is not
 * exempt from EN 301 549 — if anything it is the page most likely to be read
 * by somebody who has never used the product and cannot be assumed to be
 * anything.
 */
function formatViolations(
  violations: Awaited<ReturnType<AxeBuilder["analyze"]>>["violations"],
  label: string,
): string {
  return violations
    .map(
      (violation) =>
        `[${label}] ${violation.id} (${violation.impact}): ${violation.help}\n` +
        violation.nodes.map((node) => `  - ${node.target.join(" ")}`).join("\n"),
    )
    .join("\n\n");
}

async function assertHeadingContract(page: Page, label: string): Promise<void> {
  const info = await page.evaluate(() => {
    const levels = [...document.querySelectorAll("h1, h2, h3, h4, h5, h6")].map((element) =>
      Number(element.tagName[1]),
    );
    const h1Count = levels.filter((level) => level === 1).length;
    let deepestSoFar = 1;
    let skippedTo: number | null = null;
    for (const level of levels) {
      if (level > deepestSoFar + 1) {
        skippedTo = level;
        break;
      }
      deepestSoFar = Math.max(deepestSoFar, level);
    }
    return { h1Count, skippedTo };
  });

  expect(info.h1Count, `${label}: expected exactly one <h1>, found ${info.h1Count}`).toBe(1);
  expect(
    info.skippedTo,
    `${label}: a heading jumped to h${info.skippedTo} with no intervening level`,
  ).toBeNull();
}

for (const theme of ["light", "dark"] as const) {
  test(`the landing page is accessible in the ${theme} theme`, async ({ page }) => {
    await page.addInitScript(
      ([key, value]) => {
        try {
          localStorage.setItem(key, value);
        } catch {
          // The emulated colour scheme below still applies.
        }
      },
      ["margiolink:theme", theme] as const,
    );
    await page.emulateMedia({ colorScheme: theme });

    await page.goto("/");
    await page.waitForLoadState("networkidle");
    // Reveal animations run on intersection; scrolling to the end means axe
    // measures contrast on sections that have finished arriving rather than
    // on transparent ones.
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(800);

    const results = await new AxeBuilder({ page }).analyze();
    const serious = results.violations.filter(
      (violation) => violation.impact === "serious" || violation.impact === "critical",
    );

    expect(serious, formatViolations(serious, `landing/${theme}`)).toEqual([]);
    await assertHeadingContract(page, `landing/${theme}`);
  });
}
