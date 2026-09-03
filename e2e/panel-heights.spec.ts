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

test.describe("the link detail page", () => {
  test("bounds the live feed and lets a keyboard scroll it", async ({
    authenticatedPage: page,
  }) => {
    await openLinkDetail(page);

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
    await openLinkDetail(page);

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

  /** The scroll container is a new interactive surface, and `a11y.spec.ts`'s
   *  page list does not include this page. Sweeping it here keeps the check
   *  next to the change that needed it. */
  test("has no serious accessibility violation", async ({ authenticatedPage: page }) => {
    await openLinkDetail(page);
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

test.describe("the overview", () => {
  test("does not stretch a short panel to its neighbour's height", async ({
    authenticatedPage: page,
  }) => {
    await page.goto("/app");

    const topLinks = page.getByRole("region", { name: "Top links" });
    const countries = page.getByRole("region", { name: "Clicks by country" });
    // Both populated before either is measured: a panel still loading is a
    // few lines tall, and "the short one is shorter" would then be true of
    // the wrong thing.
    await topLinks.getByRole("listitem").first().waitFor();
    await countries.locator("[data-bar]").first().waitFor();

    const [topBox, countryBox] = await boxesOf(page, topLinks, countries);

    // In the same grid row — the comparison is meaningless otherwise.
    expect(Math.abs(topBox.y - countryBox.y)).toBeLessThan(4);

    // Strictly shorter, not "no taller": under the old `stretch` the two were
    // exactly equal, so `toBeLessThanOrEqual` passed on the broken layout
    // too — checked, by reverting the fix and watching this test stay green.
    // On the e2e fixtures the gap is 258px against 828px, so the margin here
    // is not a coincidence being pinned.
    expect(topBox.height).toBeLessThan(countryBox.height);
  });
});
