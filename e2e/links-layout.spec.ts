import { expect, test } from "./fixtures";

/**
 * The links list is a CSS grid above `sm`, and its row had one more cell than
 * it had columns.
 *
 * `LinkRow` declares `sm:grid-cols-[minmax(0,1fr)_auto_auto_auto]` — four
 * columns — and then places five children into it: the identity block, and
 * four more spliced in by `sm:contents` (sparkline, click count, copy button,
 * actions menu). Grid auto-placement put the fifth on an implicit second row,
 * in the first column, which is `minmax(0,1fr)` — so under every single link
 * sat a full-width bordered bar with an ellipsis floating in the middle of
 * it. Fixed by declaring the fifth column.
 *
 * Nothing in the unit suite could see it. `LinkRow.test.tsx` renders this
 * component in jsdom, which parses the class attribute and lays nothing out;
 * the row's five children were all present and correctly labelled, which is
 * everything a DOM assertion can ask. It took a screenshot of the real page
 * (`npm run screenshots`) for anyone to notice, and it takes a real browser
 * to keep noticing — hence this file rather than another jsdom test.
 *
 * The assertion is geometric on purpose: it does not name the grid template,
 * the class, or the number of columns, so a future redesign that reaches the
 * same result differently keeps passing, and any regression that puts the
 * menu back on its own line fails whatever the cause.
 */
test.describe("the links list row", () => {
  test("keeps the actions menu inside the row rather than on a line of its own", async ({
    authenticatedPage: page,
  }) => {
    // The `sm:` grid needs a viewport at least 640px wide; Playwright's
    // "Desktop Chrome" is 1280×720, so this holds — asserted rather than
    // assumed, because below the breakpoint the row is a flex column and
    // every expectation here would be meaningless.
    const viewport = page.viewportSize();
    expect(viewport?.width ?? 0).toBeGreaterThanOrEqual(640);

    await page.goto("/app/links");

    const actions = page.getByRole("button", { name: /^Actions for / }).first();
    await actions.waitFor();

    // Whichever link the seed happens to list first: the row's slug is in the
    // menu button's own accessible name, so this test needs no fixture
    // constant of its own.
    const label = await actions.getAttribute("aria-label");
    expect(label).toMatch(/^Actions for /);
    const slug = (label as string).replace("Actions for ", "");

    const identity = page.getByRole("link", { name: slug, exact: true });
    const identityBox = await identity.boundingBox();
    const actionsBox = await actions.boundingBox();

    // Anti-vacuity: a null box would make every comparison below pass by
    // never running.
    expect(identityBox).not.toBeNull();
    expect(actionsBox).not.toBeNull();
    if (!identityBox || !actionsBox) return;

    // To the right of the identity block, not underneath it. This is the one
    // that failed before the fix: the wrapped menu started at the same x as
    // the slug.
    expect(actionsBox.x).toBeGreaterThan(identityBox.x + identityBox.width);

    // On the same visual line, within one line-height of the slug's centre.
    const identityCentre = identityBox.y + identityBox.height / 2;
    const actionsCentre = actionsBox.y + actionsBox.height / 2;
    expect(Math.abs(actionsCentre - identityCentre)).toBeLessThan(identityBox.height * 2);

    // An icon button, not a bar spanning the list. Before the fix this was
    // the full width of the first column — hundreds of pixels.
    expect(actionsBox.width).toBeLessThan(80);
  });
});

test.describe("the mobile app chrome", () => {
  test("keeps brand and creation action above the bottom navigation", async ({
    authenticatedPage: page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/app");

    const nav = page.getByRole("navigation", { name: "Primary" });
    const newLink = page.getByRole("link", { name: "New link" });
    await nav.waitFor();

    const [navBox, actionBox] = await Promise.all([nav.boundingBox(), newLink.boundingBox()]);
    expect(navBox).not.toBeNull();
    expect(actionBox).not.toBeNull();
    if (!navBox || !actionBox) return;

    expect(actionBox.y + actionBox.height).toBeLessThan(navBox.y);
    await expect(page.locator("html")).toHaveJSProperty("scrollWidth", 390);
  });
});
