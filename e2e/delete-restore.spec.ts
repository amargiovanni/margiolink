import { expect, test } from "./fixtures";

/**
 * Finding 3 of the final whole-branch review: the delete confirmation
 * described a deletion that does not happen, and the reversal it actually
 * performs (`useRestoreLink`, the Deleted status filter) was reachable from
 * nowhere in the interface. Both halves were fixed in the same pass — this
 * is the browser proof that reachability, not just the API, actually works:
 * jsdom can assert a mutation fired, but only a real Radix `Select` and a
 * real Radix `DropdownMenu`, driven the way a person actually would, can
 * prove the Deleted filter and the Restore action are reachable at all.
 */

const RESTORE_SLUG = "e2e-restore-fixture";

interface LinkSummary {
  id: number;
  slug: string;
  deletedAt: number | null;
}

/** Same idiom as `artefacts.spec.ts`'s `findExistingLink` — `/api/links` has
 *  no hard-delete endpoint, so a slug this spec created on a previous run
 *  stays taken by that row forever, and finding-and-normalising it is the
 *  only idempotent option on a second run against the same persistent
 *  local D1. */
async function findExistingLink(
  page: import("@playwright/test").Page,
  slug: string,
): Promise<LinkSummary | null> {
  const query = `search=${encodeURIComponent(slug)}&limit=10`;
  const active = await page.request.get(`/api/links?${query}&status=all`);
  const activeBody = (await active.json()) as { links: LinkSummary[] };
  const foundActive = activeBody.links.find((link) => link.slug === slug);
  if (foundActive) return foundActive;
  const deleted = await page.request.get(`/api/links?${query}&status=deleted`);
  const deletedBody = (await deleted.json()) as { links: LinkSummary[] };
  return deletedBody.links.find((link) => link.slug === slug) ?? null;
}

/** Guarantees the fixture link exists and is *not* currently deleted, via
 *  the API — so this test always starts from a known state and does its
 *  own deleting through the real UI, rather than the delete itself being
 *  fixture setup this test cannot see happen. */
async function ensureActiveFixture(page: import("@playwright/test").Page): Promise<void> {
  const existing = await findExistingLink(page, RESTORE_SLUG);
  if (!existing) {
    await page.request.post("/api/links", {
      data: { targetUrl: "https://example.com/restore-fixture", slug: RESTORE_SLUG },
    });
    return;
  }
  if (existing.deletedAt) {
    await page.request.post(`/api/links/${existing.id}/restore`);
  }
}

test.describe("delete and restore — the unreachable-reversal defect (Important 3)", () => {
  test("deleting a link through the confirmation names what actually happens, and it is found and restored from the Deleted filter", async ({
    authenticatedPage: page,
  }) => {
    await ensureActiveFixture(page);

    await page.goto("/app/links");
    await page.getByRole("searchbox", { name: /search/i }).fill(RESTORE_SLUG);
    await expect(page.getByText(RESTORE_SLUG)).toBeVisible();

    // Delete through the real confirmation — the exact copy this branch's
    // fix rewrote — not by calling the API directly, so this also proves
    // the confirmation's own text in a real browser.
    await page.getByRole("button", { name: `Actions for ${RESTORE_SLUG}` }).click();
    await page.getByRole("menuitem", { name: "Delete" }).click();

    const confirmDialog = page.getByRole("dialog", { name: `Delete ${RESTORE_SLUG}?` });
    await expect(confirmDialog).toBeVisible();
    // The three claims Important 3 named as false, now corrected: it names
    // the slug, says it stops resolving (not "permanently deletes"), names
    // the reserved slug, and names the way back.
    await expect(confirmDialog).toContainText(RESTORE_SLUG);
    await expect(confirmDialog).toContainText("from resolving");
    await expect(confirmDialog).toContainText("stays reserved");
    await expect(confirmDialog).toContainText("Deleted filter");
    await expect(confirmDialog).not.toContainText("permanently");
    await expect(confirmDialog).not.toContainText("cannot be undone");

    await confirmDialog.getByRole("button", { name: "Delete" }).click();
    await expect(confirmDialog).toBeHidden();

    // Gone from the default (non-deleted) view — the working list's own
    // "all" status excludes deleted rows.
    await expect(page.getByText(RESTORE_SLUG)).toBeHidden();

    // Found under the Deleted filter, which did not exist before this fix.
    await page.getByRole("combobox", { name: "Status" }).click();
    await page.getByRole("option", { name: "Deleted" }).click();
    await expect(page.getByText(RESTORE_SLUG)).toBeVisible();

    // Restored — `useRestoreLink`, wired to a menu item for the first time
    // in this fix — with no confirmation, matching Deactivate/Activate's
    // own single-click precedent for a reversible action.
    await page.getByRole("button", { name: `Actions for ${RESTORE_SLUG}` }).click();
    await page.getByRole("menuitem", { name: "Restore" }).click();
    await expect(page.getByText(RESTORE_SLUG)).toBeHidden();

    // Back under the active list.
    await page.getByRole("combobox", { name: "Status" }).click();
    await page.getByRole("option", { name: "All statuses" }).click();
    await expect(page.getByText(RESTORE_SLUG)).toBeVisible();
  });
});
