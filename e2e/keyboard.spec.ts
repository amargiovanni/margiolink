import { expect, test } from "./fixtures";

/**
 * The period picker's focus ring could never render: `peer-focus-visible:*`
 * was applied to the `<label>`, but the peer (the `<input>`) is that label's
 * *child*, not its sibling — Tailwind's `peer-*` variant compiles to a
 * general sibling combinator (`~`), which cannot select a parent from a
 * descendant no matter how the classes are arranged. Fixed in `acb7738` with
 * `has-[:focus-visible]:*`, the one selector relationship that runs the
 * other way. `jsdom` has no CSS cascade, so no test in the unit suite could
 * ever have seen the ring fail to render — only `getComputedStyle` against a
 * real browser layout can.
 *
 * The rest of this file is the general keyboard contract §6.2 promises for
 * the command palette, the create-link dialog and the one destructive action
 * in the dashboard — reached and operated with no `page.click`.
 */

// PERIODS in web/src/lib/ranges.ts — kept as a literal count here rather than
// imported, so this file has no dependency on web/'s module graph.
const PERIOD_COUNT = 5;

// `page.keyboard.press("ControlOrMeta+K")` does NOT open the palette —
// verified interactively: `ControlOrMeta` is a valid token for a
// `modifiers: string[]` option (e.g. on `locator.click`), but Playwright's
// combo-string parser for `keyboard.press()` doesn't recognise it as a
// modifier, so the key event carries neither `ctrlKey` nor `metaKey` and
// `CommandPalette.tsx`'s own listener never fires. The platform-specific
// combo below is the documented workaround and is what the app itself
// checks for (`event.metaKey || event.ctrlKey`).
const OPEN_PALETTE_SHORTCUT = process.platform === "darwin" ? "Meta+K" : "Control+K";

async function tabUntil(
  page: import("@playwright/test").Page,
  predicate: () => Promise<boolean>,
  maxPresses: number,
): Promise<boolean> {
  for (let i = 0; i < maxPresses; i++) {
    await page.keyboard.press("Tab");
    if (await predicate()) return true;
  }
  return false;
}

test.describe("keyboard access — the focus defects (acb7738)", () => {
  test("every period option shows a real, visible focus ring when reached by Tab", async ({
    authenticatedPage: page,
  }) => {
    await page.goto("/app");
    await expect(page.getByRole("radiogroup", { name: "Period" })).toBeVisible();

    const reached = await tabUntil(
      page,
      () => page.evaluate(() => Boolean(document.activeElement?.closest('[role="radiogroup"]'))),
      20,
    );
    expect(reached, "Tab never reached the period picker").toBe(true);

    for (let i = 0; i < PERIOD_COUNT; i++) {
      const outline = await page.evaluate(() => {
        const active = document.activeElement as HTMLElement | null;
        const box = active?.closest("label");
        if (!box) return null;
        const style = getComputedStyle(box);
        return {
          width: style.outlineWidth,
          color: style.outlineColor,
          styleProp: style.outlineStyle,
        };
      });

      expect(outline, "the focused radio's parent <label> was not found").not.toBeNull();
      // `outline-style` is the decisive property: Chromium's
      // `getComputedStyle` reports a non-zero `outline-width` (the "medium"
      // keyword's resolved length) and a non-transparent `outline-color`
      // (`currentColor`) even when no ring renders at all, as long as
      // `outline-style` stays at its initial `none` — confirmed by Step 8
      // of the task brief: reintroducing `peer-focus-visible:*` here (a
      // selector that can never match, since the peer is the label's child,
      // not its sibling) left width/color alone unchanged and passing,
      // while `outline-style` stayed "none". The brief's own two checks are
      // kept below because they are still true of a real ring; this is the
      // one that actually falls when the ring doesn't render.
      expect(outline?.styleProp, 'outline-style was "none" — no ring rendered').not.toBe("none");
      expect(outline?.width, `outline-width was "${outline?.width}"`).not.toBe("0px");
      expect(outline?.color, "outline-color was transparent").not.toBe("rgba(0, 0, 0, 0)");

      if (i < PERIOD_COUNT - 1) await page.keyboard.press("ArrowRight");
    }
  });

  test("reaches the command palette and the create-link dialog by keyboard alone", async ({
    authenticatedPage: page,
  }) => {
    // `login()` (e2e/fixtures.ts) already lands on /app — a second `goto`
    // here would force a full reload and risk pressing the shortcut before
    // CommandPalette's `useEffect` has attached its keydown listener.
    await expect(page.getByRole("heading", { name: "Overview", level: 1 })).toBeVisible();

    await page.keyboard.press(OPEN_PALETTE_SHORTCUT);
    await expect(page.getByRole("dialog", { name: "Command palette" })).toBeVisible();

    // "New link" is the command palette's first item — cmdk highlights the
    // first visible item on open, with no arrow press needed.
    await page.keyboard.press("Enter");

    const createDialog = page.getByRole("dialog", { name: "New link" });
    await expect(createDialog).toBeVisible();
    // LinkDialog's onOpenAutoFocus puts focus on the first field rather than
    // Radix's own default (its Close button).
    await expect(page.getByLabel("Destination")).toBeFocused();

    await page.keyboard.type("https://example.com/e2e-keyboard-created");
    // A single-line <input> inside a <form> submits on Enter with no
    // separate keyboard path to the submit button needed.
    await page.keyboard.press("Enter");
    await expect(createDialog).toBeHidden();
    // The list refetches and a toast mounts right after creation (handleDone
    // in LinkDialog.tsx) — letting the network settle here, rather than
    // starting the keyboard-only row-menu walk immediately, is what made
    // this test flaky: a background re-render could remount the dropdown
    // mid-sequence and drop the roving focus this test depends on.
    await page.waitForLoadState("networkidle");

    // The freshly created link sorts first (newest created_at) — reachable
    // this way with a bounded, not exhaustive, Tab walk.
    const reachedRowMenu = await tabUntil(
      page,
      () =>
        page.evaluate(() =>
          Boolean(document.activeElement?.getAttribute("aria-label")?.startsWith("Actions for")),
        ),
      30,
    );
    expect(reachedRowMenu, "Tab never reached the new link's row action menu").toBe(true);

    await page.keyboard.press("Enter"); // opens the row's dropdown menu — focus lands on Edit
    // A fixed count of ArrowDown presses (Edit -> QR code -> Deactivate ->
    // Delete) was flaky: Radix's roving-focus update does not always land
    // before the next keydown fires. Pressing until Delete actually reports
    // focused — bounded, so a reordered or renamed menu still fails loudly
    // rather than hanging — is the same reasoning as `tabUntil` above.
    const deleteItem = page.getByRole("menuitem", { name: "Delete" });
    let deleteFocused = false;
    for (let i = 0; i < 6; i++) {
      if (await deleteItem.evaluate((el) => el === document.activeElement)) {
        deleteFocused = true;
        break;
      }
      await page.keyboard.press("ArrowDown");
      await page.waitForTimeout(100); // lets Radix's roving-focus update land
    }
    expect(deleteFocused, "ArrowDown never settled focus on the Delete menu item").toBe(true);

    let deleteRequested = false;
    page.on("request", (request) => {
      if (request.method() === "DELETE" && request.url().includes("/api/links/")) {
        deleteRequested = true;
      }
    });

    await page.keyboard.press("Enter"); // selects Delete, opening ConfirmDialog
    const confirmDialog = page.getByRole("dialog").filter({ hasText: "This cannot be undone." });
    await expect(confirmDialog).toBeVisible();
    // ConfirmDialog's onOpenAutoFocus puts default focus on Cancel, not
    // Radix's own default (this dialog's Close "×" button).
    await expect(page.getByRole("button", { name: "Cancel" })).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "Cancel" })).toBeHidden();
    expect(deleteRequested, "Escape must dismiss the confirmation, not confirm it").toBe(false);
  });

  test("walking the primary navigation never drops focus or lands on something unnamed", async ({
    authenticatedPage: page,
  }) => {
    await page.goto("/app");
    await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();

    const reachedNav = await tabUntil(
      page,
      () =>
        page.evaluate(() => Boolean(document.activeElement?.closest('nav[aria-label="Primary"]'))),
      10,
    );
    expect(reachedNav, "Tab never reached the primary navigation").toBe(true);

    const SECTION_COUNT = 4; // Overview, Links, Tags, Settings — PrimaryNav.SECTIONS
    for (let i = 0; i < SECTION_COUNT; i++) {
      const active = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body) return null;
        return { tag: el.tagName, name: el.getAttribute("aria-label") || el.textContent?.trim() };
      });

      expect(
        active,
        `focus left the document while walking the primary nav (step ${i})`,
      ).not.toBeNull();
      expect(active?.name, `nav item ${i} (${active?.tag}) has no accessible name`).toBeTruthy();

      if (i < SECTION_COUNT - 1) await page.keyboard.press("Tab");
    }
  });
});
