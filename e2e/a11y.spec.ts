import AxeBuilder from "@axe-core/playwright";
import type { Page, Request } from "@playwright/test";
import { expect, login, test } from "./fixtures";

/**
 * The machine-checkable half of spec §6.2, run against a real Chromium
 * rather than `jsdom` — `web/src/a11y.test.tsx` already sweeps every page for
 * the properties axe does not check (one `<h1>`, no skipped heading level,
 * every chart inside a named region); this file re-asserts exactly those
 * three, in a real browser, and adds what only a real browser can see: an
 * actual rendered colour-contrast failure.
 *
 * Light mode is not optional here. `4286bc1` fixed a contrast defect that
 * existed only in light mode, because `--color-good`/`--color-warning`/
 * `--color-critical` had been left to inherit the `@theme` block's dark
 * values instead of being stepped independently for the pale surface —
 * exactly the class of bug a cascade-blind test runner cannot see.
 */

const PRIMARY_SLUG = "e2e-primary";
const THEME_KEY = "margiolink:theme";

interface StaticPage {
  name: string;
  path: string;
  authenticated: boolean;
  ready: (page: Page) => Promise<unknown>;
}

const PAGES: StaticPage[] = [
  {
    name: "Login",
    path: "/app/login",
    authenticated: false,
    ready: (page) => page.getByRole("button", { name: "Sign in" }).waitFor(),
  },
  {
    name: "Overview",
    path: "/app",
    authenticated: true,
    ready: (page) => page.getByText("Clicks by country").waitFor(),
  },
  {
    name: "Links",
    path: "/app/links",
    authenticated: true,
    ready: (page) => page.getByRole("link", { name: PRIMARY_SLUG }).waitFor(),
  },
  {
    name: "Tags",
    path: "/app/tags",
    authenticated: true,
    ready: (page) => page.getByText("Launch", { exact: true }).waitFor(),
  },
  {
    name: "Settings",
    path: "/app/settings",
    authenticated: true,
    ready: (page) => page.getByRole("button", { name: "Sign out" }).waitFor(),
  },
];

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

async function assertNoSeriousViolations(page: Page, label: string): Promise<void> {
  const results = await new AxeBuilder({ page }).analyze();
  const serious = results.violations.filter(
    (violation) => violation.impact === "serious" || violation.impact === "critical",
  );
  expect(serious, formatViolations(serious, label)).toEqual([]);
}

/** §6.2's heading contract — axe's own `heading-order` rule is a best
 *  practice, not a WCAG failure, so it does not surface at "serious" or
 *  "critical" impact and the filter above would let a skip straight through.
 *  Ported from `web/src/a11y.test.tsx`'s jsdom version of the same check. */
async function assertHeadingContract(page: Page, label: string): Promise<void> {
  const info = await page.evaluate(() => {
    const levels = Array.from(document.querySelectorAll("h1, h2, h3, h4, h5, h6")).map((el) =>
      Number(el.tagName[1]),
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

/** Every composite chart mark (`data-line`/`data-area`/`data-cell`/`data-bar`
 *  — the same vocabulary `web/src/a11y.test.tsx` uses) must sit inside a
 *  `<section>` with an accessible name. `Sparkline`'s own `<svg role="img">`
 *  is exempt, same reasoning as the jsdom version: it self-names and sits
 *  beside a number rather than standing as its own analytical view. */
async function assertChartsAreNamed(page: Page, label: string): Promise<void> {
  const problems = await page.evaluate(() => {
    const marks = Array.from(
      document.querySelectorAll("[data-line], [data-area], [data-cell], [data-bar]"),
    ).filter((el) => !el.closest("svg[role='img']"));

    const bad: string[] = [];
    for (const mark of marks) {
      const section = mark.closest("section");
      if (!section) {
        bad.push(`chart mark outside any <section>: ${mark.outerHTML.slice(0, 120)}`);
        continue;
      }
      const label = section.getAttribute("aria-label")?.trim();
      const labelledBy = section.getAttribute("aria-labelledby");
      const byId = labelledBy
        ?.split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent?.trim() ?? "")
        .filter(Boolean)
        .join(" ");
      if (!label && !byId) {
        bad.push(`chart's <section> has no accessible name: ${section.outerHTML.slice(0, 120)}`);
      }
    }
    return bad;
  });

  expect(problems, `${label}\n${problems.join("\n")}`).toEqual([]);
}

async function sweep(page: Page, label: string): Promise<void> {
  const pending = new Set<Request>();
  const started = (request: Request) => {
    if (new URL(request.url()).pathname.startsWith("/api/stats/")) pending.add(request);
  };
  const finished = (request: Request) => pending.delete(request);
  page.on("request", started);
  page.on("requestfinished", finished);
  page.on("requestfailed", finished);
  // Exercise every deferred chart before axe and structural checks. Otherwise
  // laziness would silently turn this into a placeholders-only audit.
  await page.locator("[data-deferred-panel]").evaluateAll((panels) => {
    for (const panel of panels) {
      const button = Array.from(panel.querySelectorAll("button")).find((button) =>
        button.textContent?.startsWith("Load "),
      );
      button?.click();
    }
  });
  await expect(page.getByRole("button", { name: /^Load / })).toHaveCount(0);
  await expect.poll(() => pending.size).toBe(0);
  page.off("request", started);
  page.off("requestfinished", finished);
  page.off("requestfailed", finished);
  await expect(page.getByText("Loading…", { exact: true })).toHaveCount(0);
  if (label.startsWith("Overview") || label.startsWith("LinkDetail")) {
    await expect(page.locator('[data-deferred-panel="Activity by hour"] [data-cell]')).toHaveCount(
      168,
    );
  }

  await assertNoSeriousViolations(page, label);
  await assertHeadingContract(page, label);
  await assertChartsAreNamed(page, label);
}

for (const theme of ["light", "dark"] as const) {
  test.describe(`${theme} theme`, () => {
    test.beforeEach(async ({ page }) => {
      await page.addInitScript(
        ([key, value]) => {
          try {
            localStorage.setItem(key, value);
          } catch {
            // A private window or blocked site data — the page already
            // treats this as "follow the system" rather than an error; the
            // sweep below runs against whatever theme that resolves to.
          }
        },
        [THEME_KEY, theme] as const,
      );
    });

    for (const target of PAGES) {
      test(`${target.name} has no serious/critical axe violations and keeps the heading/chart contract`, async ({
        page,
      }) => {
        if (target.authenticated) {
          await login(page);
          if (target.path !== "/app") await page.goto(target.path);
        } else {
          await page.goto(target.path);
        }

        await target.ready(page);
        await sweep(page, `${target.name} (${theme})`);
      });
    }

    test(`LinkDetail (${theme}) has no serious/critical axe violations and keeps the heading/chart contract`, async ({
      page,
    }) => {
      await login(page);

      await page.goto("/app/links");
      await page.getByRole("link", { name: PRIMARY_SLUG }).click();
      await page.waitForURL(/\/app\/links\/\d+$/);
      await page.getByRole("heading", { level: 1, name: PRIMARY_SLUG }).waitFor();

      await sweep(page, `LinkDetail (${theme})`);
    });
  });
}
