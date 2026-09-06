import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./fixtures";

/**
 * Two panels that were the wrong height, and neither could be seen from
 * jsdom.
 *
 * 1. **The live feed had no bound.** It renders the last fifty clicks, and
 *    with no scroll container that is thousands of pixels of page — enough to
 *    push everything under it out of reach, and (before the grid stopped
 *    stretching) enough to drag the QR panel beside it to the same height.
 * 2. **Short panels stretched to their tallest neighbour.** A CSS grid's
 *    default `align-items: stretch` made "Top links" — five rows — as tall as
 *    "Clicks by country" — twenty rows and a map — leaving a card that was
 *    mostly empty.
 *
 * Both are pure layout: the DOM was correct in each case, which is why a
 * component suite with no cascade and no box model reported everything fine.
 * Both were found by photographing the pages (`npm run screenshots`).
 *
 * The assertions are geometric and generous: they pin the property that was
 * wrong (a bound exists; a short card is shorter than a tall one) rather than
 * a specific pixel height, so a restyle does not have to come back here.
 */

const PRIMARY_SLUG = "e2e-primary";

/**
 * Both boxes read in one frame.
 *
 * Two separate `boundingBox()` calls are two round trips, and anything that
 * resizes between them — a KPI tile finishing its query, a font swapping in —
 * shifts the second reading relative to the first. The overview test caught
 * exactly that: the two panels are in the same grid row and their `y` still
 * differed by 26px on one run in two. Reading both inside one `evaluate` is
 * one layout, so the comparison is of two boxes that actually coexisted.
 */
async function boxesOf(
  page: import("@playwright/test").Page,
  first: import("@playwright/test").Locator,
  second: import("@playwright/test").Locator,
): Promise<[DOMRect, DOMRect]> {
  const [a, b] = await Promise.all([first.elementHandle(), second.elementHandle()]);
  if (!a || !b) throw new Error("boxesOf: one of the panels is not in the DOM");
  return page.evaluate(
    ([one, two]) => [one.getBoundingClientRect().toJSON(), two.getBoundingClientRect().toJSON()],
    [a, b] as const,
  );
}

/** The live feed is on a link's detail page, and the seed's link ids are not
 *  fixed across runs — so this walks in from the list the way a reader does,
 *  rather than guessing a URL. */
async function openLinkDetail(page: import("@playwright/test").Page): Promise<void> {
  await page.goto("/app/links");
  await page.getByRole("link", { name: PRIMARY_SLUG, exact: true }).first().click();
  await page.waitForURL(/\/app\/links\/\d+$/);
}

/** Capture the response before navigation so this also works if a larger
 * viewport intersects the panel immediately. Scroll its stable wrapper rather
 * than waiting for a list which does not mount until the panel is requested. */
async function openLiveFeed(page: import("@playwright/test").Page): Promise<void> {
  const loaded = page.waitForResponse(
    (response) => new URL(response.url()).pathname === "/api/stats/live" && response.ok(),
  );
  await openLinkDetail(page);
  await page.locator('[data-deferred-panel="Live feed"]').scrollIntoViewIfNeeded();
  await loaded;
  await page.getByRole("list", { name: "Recent clicks" }).getByRole("listitem").first().waitFor();
}

test.describe("the link detail page", () => {
  test("bounds the live feed and lets a keyboard scroll it", async ({
    authenticatedPage: page,
  }) => {
    await openLiveFeed(page);

    const feed = page.getByRole("list", { name: "Recent clicks" });
    await feed.waitFor();

    // Anti-vacuity: a bound is trivially satisfied by an empty list. The seed
    // fires 48 clicks at this link, so the feed has more rows than fit.
    const rows = await feed.getByRole("listitem").count();
    expect(rows).toBeGreaterThan(10);

    const { clientHeight, scrollHeight } = await feed.evaluate((element) => ({
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
    }));

    // Bounded…
    expect(clientHeight).toBeLessThan(600);
    // …and actually scrollable rather than clipped.
    expect(scrollHeight).toBeGreaterThan(clientHeight);

    // A scrollable region whose rows hold nothing focusable must be focusable
    // itself, or the content below the fold is unreachable without a mouse.
    await feed.focus();
    await expect(feed).toBeFocused();
    await page.keyboard.press("End");
    await expect.poll(async () => feed.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  });

  test("leaves the QR panel its own height rather than the live feed's", async ({
    authenticatedPage: page,
  }) => {
    await openLiveFeed(page);

    const qr = page.getByRole("region", { name: "QR code" });
    const live = page.getByRole("region", { name: "Live feed" });
    // Both panels have to have finished loading before either is measured:
    // the QR is a canvas and the feed is a fetch, and a feed still showing
    // "Loading recent activity…" is one line tall, which would make this pass
    // for entirely the wrong reason.
    await qr.getByRole("img").waitFor();
    await live.getByRole("listitem").first().waitFor();

    const [qrBox, liveBox] = await boxesOf(page, qr, live);

    // Side by side at this viewport — otherwise the heights below are
    // measuring a single column and prove nothing.
    expect(Math.abs(qrBox.y - liveBox.y)).toBeLessThan(4);
    expect(qrBox.height).toBeLessThan(liveBox.height);
  });

  /** Keep a dedicated sweep after the populated scroll container mounts,
   * alongside the complete deferred-panel sweep in a11y.spec.ts. */
  test("has no serious accessibility violation", async ({ authenticatedPage: page }) => {
    await openLiveFeed(page);
    await page.getByRole("region", { name: "QR code" }).waitFor();

    const results = await new AxeBuilder({ page }).analyze();
    const serious = results.violations.filter(
      (violation) => violation.impact === "serious" || violation.impact === "critical",
    );
    expect(
      serious,
      serious.map((violation) => `${violation.id}: ${violation.help}`).join("\n"),
    ).toEqual([]);
  });
});

test.describe("the panel grids", () => {
  /**
   * This one asserts a computed style rather than two heights, and the reason
   * is worth writing down.
   *
   * The obvious test — "Top links" is shorter than "Clicks by country" — needs
   * both panels to have data, and on CI neither does. `request.cf` under
   * `wrangler dev --local` is fetched once per process from a fixed source
   * (see `e2e/seed.ts`'s module comment), and on a runner it yields no usable
   * country, so the country panel draws nothing and the top-links panel ranks
   * fixtures that earlier specs have since deleted. Two empty cards are the
   * same height whether or not the grid stretches them, which makes the
   * geometric assertion pass for the wrong reason there and time out waiting
   * for content that never arrives.
   *
   * So the overview is checked at the level where the defect actually lived:
   * the grid's own `align-items`, resolved by a real browser from the real
   * cascade — something jsdom cannot do either. The *behavioural* version of
   * this assertion is the QR/live-feed test above, which has content on every
   * runner and does compare heights.
   */
  test("let each card keep its own height instead of stretching", async ({
    authenticatedPage: page,
  }) => {
    const gridOf = (locator: import("@playwright/test").Locator) =>
      locator.evaluate((element) => {
        const item = element.closest("[data-deferred-panel]");
        const grid = item?.parentElement;
        if (!grid) return null;
        const style = window.getComputedStyle(grid);
        return { display: style.display, alignItems: style.alignItems };
      });

    const topLinksLoaded = page.waitForResponse(
      (response) => new URL(response.url()).pathname === "/api/stats/top-links" && response.ok(),
    );
    await page.goto("/app");
    await page.locator('[data-deferred-panel="Top links"]').scrollIntoViewIfNeeded();
    await topLinksLoaded;
    const topLinks = page.getByRole("region", { name: "Top links" });
    await topLinks.waitFor();
    await expect(topLinks.getByText("Loading…", { exact: true })).toHaveCount(0);
    const overviewGrid = await gridOf(topLinks);

    // Anti-vacuity: if the panel wrapper's parent is not the grid, this test
    // is measuring the wrong element and should say so rather than pass.
    expect(overviewGrid?.display).toBe("grid");
    expect(overviewGrid?.alignItems).toBe("flex-start");

    const countriesLoaded = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        url.pathname === "/api/stats/dimension" &&
        url.searchParams.get("name") === "country" &&
        url.searchParams.has("linkId") &&
        response.ok()
      );
    });
    await openLinkDetail(page);
    await page.locator('[data-deferred-panel="Countries"]').scrollIntoViewIfNeeded();
    await countriesLoaded;
    const countries = page.getByRole("region", { name: "Countries" });
    await countries.waitFor();
    await expect(countries.getByText("Loading…", { exact: true })).toHaveCount(0);
    const dimensionGrid = await gridOf(countries);

    expect(dimensionGrid?.display).toBe("grid");
    expect(dimensionGrid?.alignItems).toBe("flex-start");
  });
});
