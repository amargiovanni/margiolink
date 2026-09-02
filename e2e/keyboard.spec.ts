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
 * The first version of the test below asserting this was itself vacuous, and
 * this is worth recording permanently rather than only in the Task 15
 * report: reintroducing `peer-focus-visible:*` and re-running it *passed*.
 * Chromium's `getComputedStyle` reports a non-zero `outline-width` (the
 * `medium` keyword's resolved length) and a non-transparent `outline-color`
 * (`currentColor`) on the label regardless of whether `outline-style` is
 * `none` — i.e. regardless of whether any ring actually renders. Those were
 * the brief's own two specified checks. `outline-style !== "none"` is the
 * one that is actually decisive, added below alongside them; see Step 8 in
 * the task report for the verbatim before/after run. The lesson: a suite
 * written specifically to close vacuous assertions can still ship one of
 * its own, and the only way anyone finds out is by making it fail on
 * purpose before trusting it to pass for the right reason.
 *
 * The rest of this file is the general keyboard contract §6.2 promises for
 * the command palette, the create-link dialog and the one destructive action
 * in the dashboard — reached and operated with no `page.click`.
 */

// periodsFor(180) in web/src/lib/ranges.ts — kept as a literal count here
// rather than imported, so this file has no dependency on web/'s module
// graph. 4, not PERIODS' full 5: at the real deployment's 180-day
// RAW_RETENTION_DAYS (wrangler.jsonc), 12m's own comparison window falls
// entirely outside retention, so the picker never offers it — see I1 in the
// final review.
const PERIOD_COUNT = 4;

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
    // Delete) was flaky: Radix's roving-focus update runs asynchronously
    // after the keydown (its own effect, not synchronous with the event),
    // so a press fired before the previous one's update has landed reaches
    // whichever item was *still* focused and does nothing useful. A named
    // race, not a guess: removing the wait this comment used to describe as
    // "lets Radix's update land" and replacing it with nothing reproduced
    // the failure on 5 out of 5 stress-test runs — confirming it was
    // load-bearing — so it is named and waited for properly below instead
    // of padded with a fixed sleep, which would either not be long enough
    // on a slower runner or waste time on a faster one.
    const deleteItem = page.getByRole("menuitem", { name: "Delete" });
    let deleteFocused = false;
    for (let i = 0; i < 6; i++) {
      const focusedText = await page.evaluate(() => document.activeElement?.textContent ?? null);
      if (focusedText === "Delete") {
        deleteFocused = true;
        break;
      }
      await page.keyboard.press("ArrowDown");
      // Waits for the actual effect of the press — the focused item's text
      // changing — rather than a fixed delay: resolves the moment Radix's
      // update commits, whether that takes one frame or several.
      await page.waitForFunction(
        (previousText) => document.activeElement?.textContent !== previousText,
        focusedText,
      );
    }
    if (!deleteFocused) {
      deleteFocused = await deleteItem.evaluate((el) => el === document.activeElement);
    }
    expect(deleteFocused, "ArrowDown never settled focus on the Delete menu item").toBe(true);

    let deleteRequested = false;
    page.on("request", (request) => {
      if (request.method() === "DELETE" && request.url().includes("/api/links/")) {
        deleteRequested = true;
      }
    });

    await page.keyboard.press("Enter"); // selects Delete, opening ConfirmDialog
    const confirmDialog = page.getByRole("dialog").filter({ hasText: "from resolving" });
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
