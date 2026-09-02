import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { MoreHorizontal, Pencil, Power, QrCode, RotateCcw, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link as RouterLink, useNavigate } from "react-router";
import { hexToRgb, readableTextColor } from "../../lib/contrast";
import { formatCount } from "../../lib/format";
import type { Link, Tag } from "../../lib/queries";
import { useDeleteLink, useRestoreLink, useUpdateLink } from "../../lib/queries";
import { Sparkline } from "../charts/Sparkline";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { ConfirmDialog } from "./ConfirmDialog";
import { CopyButton } from "./CopyButton";
import { LinkDialog } from "./LinkDialog";

/** The tag colour is picked by the user and stored in the database — there is
 *  no validated-palette rule that can (or should) govern it. What *is*
 *  binding: the badge always carries the tag's name as text, so the colour
 *  stays decorative, and whatever colour the user picked, the text drawn on
 *  it must still be readable — `readableTextColor` guarantees that against
 *  any background (see `lib/contrast.ts`), rather than assuming one. */
function TagBadge({ tag }: { tag: Tag }) {
  const rgb = hexToRgb(tag.color);
  // An unparsable colour falls back to the design system's own neutral
  // badge rather than an inline style built from a value we could not
  // validate.
  if (!rgb) return <Badge>{tag.name}</Badge>;
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
      style={{ backgroundColor: tag.color, color: readableTextColor(rgb) }}
    >
      {tag.name}
    </span>
  );
}

const MENU_ITEM_CLASSNAME =
  "flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm text-ink outline-none data-[highlighted]:bg-surface-sunken";

/** Restore has no confirmation to hold its error the way Delete's does —
 *  it is a single-click, no-dialog action, matching Deactivate/Activate's
 *  own precedent for a reversible one. A failure still has to be said
 *  somewhere, so it surfaces as a toast (same idiom as `LinkDialog`'s own
 *  copy-confirmation toast) rather than nowhere at all. */
const RESTORE_ERROR_TOAST_MS = 4000;

export interface LinkRowProps {
  link: Link;
  /** The last 7 daily click counts for this link, oldest first. `null`
   *  means the sparklines query has not resolved — still loading, or
   *  failed — which is not the same thing as a real `number[]` of zeros: a
   *  link that genuinely had no clicks in the window is a legitimate
   *  all-zero array, produced by the caller only once that query actually
   *  succeeds. Collapsing "unknown" into zero would show a false "0
   *  clicks" that reads as identical to a real one. */
  sparkline: number[] | null;
}

/** One row of the working list. Below `sm` this renders as a two-line
 *  stacked card (identity, then destination+sparkline+clicks+copy); above
 *  `sm` the same markup becomes a grid with columns via `sm:contents` on the
 *  last group, so there is no separate mobile/desktop markup to keep in
 *  sync and no `<table>` — these are navigational cards, not tabular data.
 *
 *  The row's action menu (Edit, QR code, Deactivate, Delete) uses Radix's
 *  `DropdownMenu` with every item always present and reachable — never
 *  Radix's `Item disabled` prop. `disabled` also sets `focusable: !disabled`
 *  in the roving-focus group behind the menu, and that group's arrow-key
 *  handler cycles only focusable entries: inside a `role="menu"`'s
 *  application mode, that is the *only* interaction a screen reader uses, so
 *  a `disabled` item is invisible to it while a sighted user still sees it
 *  greyed out. There is currently no item in this menu that is genuinely
 *  unavailable to the viewer (a permission they lack, Activate on an
 *  already-active link) — if one is added later, mark it with
 *  `aria-disabled="true"` plus `onSelect={(e) => e.preventDefault()}`,
 *  which keeps it in the roving-focus set and announces it correctly,
 *  rather than `disabled`. */
export function LinkRow({ link, sparkline }: LinkRowProps) {
  const clicks = sparkline?.reduce((sum, value) => sum + value, 0) ?? null;
  const isDeleted = link.deletedAt !== null;
  const navigate = useNavigate();
  const updateMutation = useUpdateLink();
  const deleteMutation = useDeleteLink();
  const restoreMutation = useRestoreLink();
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const restoreErrorTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(restoreErrorTimer.current), []);

  function handleToggleActive() {
    updateMutation.mutate({ id: link.id, isActive: !link.isActive });
  }

  function handleRestore() {
    restoreMutation.mutate(link.id, {
      onError: () => {
        setRestoreError(`Could not restore ${link.slug}. Try again.`);
        clearTimeout(restoreErrorTimer.current);
        restoreErrorTimer.current = setTimeout(() => setRestoreError(null), RESTORE_ERROR_TOAST_MS);
      },
    });
  }

  function handleOpenDelete() {
    setDeleteError(null);
    setDeleteOpen(true);
  }

  function handleConfirmDelete() {
    setDeleteError(null);
    // `useDeleteLink`'s own `onSuccess` invalidates the links list; closing
    // the confirmation here only needs to happen once the delete actually
    // succeeds — a failed delete leaves the dialog open, with the failure
    // surfaced right there (rather than nowhere at all) and the mutation's
    // own error state available to a future retry.
    deleteMutation.mutate(link.id, {
      onSuccess: () => setDeleteOpen(false),
      onError: () => setDeleteError("Could not delete this link. Try again."),
    });
  }

  return (
    <div className="flex flex-col gap-2 border-b border-rule py-3 last:border-b-0 sm:grid sm:grid-cols-[minmax(0,1fr)_auto_auto_auto] sm:items-center sm:gap-4">
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <RouterLink
            to={`/links/${link.id}`}
            className="font-display text-base text-ink hover:underline"
          >
            {link.slug}
          </RouterLink>
          {isDeleted && <Badge tone="critical">Deleted</Badge>}
          {!isDeleted && !link.isActive && <Badge tone="warning">Inactive</Badge>}
          {link.tags.map((tag) => (
            <TagBadge key={tag.id} tag={tag} />
          ))}
        </div>
        <p className="truncate text-sm text-ink-muted">{link.targetUrl}</p>
      </div>

      <div className="flex items-center justify-between gap-3 sm:contents">
        {sparkline ? (
          <Sparkline values={sparkline} label={`${link.slug}, clicks over the last 7 days`} />
        ) : (
          <span className="text-sm text-ink-faint" aria-hidden="true">
            —
          </span>
        )}

        <p className="text-sm text-ink tabular-nums">
          {clicks === null ? "Clicks unavailable" : `${formatCount(clicks)} clicks, last 7 days`}
        </p>

        <CopyButton value={link.shortUrl} label={`Copy short link for ${link.slug}`} />

        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <Button variant="ghost" size="sm" aria-label={`Actions for ${link.slug}`}>
              <MoreHorizontal className="size-4" aria-hidden="true" />
            </Button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              align="end"
              className="min-w-40 rounded border border-rule bg-surface-raised p-1 shadow-lg"
            >
              {isDeleted ? (
                // A deleted link's identity is frozen except for one way
                // back: restoring it. Edit, QR code, Deactivate and Delete
                // all assume a link that still resolves, so none of them
                // belong on a row that no longer does.
                <DropdownMenu.Item onSelect={handleRestore} className={MENU_ITEM_CLASSNAME}>
                  <RotateCcw className="size-4" aria-hidden="true" />
                  Restore
                </DropdownMenu.Item>
              ) : (
                <>
                  <DropdownMenu.Item
                    onSelect={() => setEditOpen(true)}
                    className={MENU_ITEM_CLASSNAME}
                  >
                    <Pencil className="size-4" aria-hidden="true" />
                    Edit
                  </DropdownMenu.Item>
                  <DropdownMenu.Item
                    onSelect={() => navigate(`/links/${link.id}`)}
                    className={MENU_ITEM_CLASSNAME}
                  >
                    <QrCode className="size-4" aria-hidden="true" />
                    QR code
                  </DropdownMenu.Item>
                  <DropdownMenu.Item onSelect={handleToggleActive} className={MENU_ITEM_CLASSNAME}>
                    <Power className="size-4" aria-hidden="true" />
                    {link.isActive ? "Deactivate" : "Activate"}
                  </DropdownMenu.Item>
                  <DropdownMenu.Item
                    onSelect={handleOpenDelete}
                    className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm text-critical outline-none data-[highlighted]:bg-critical/10"
                  >
                    <Trash2 className="size-4" aria-hidden="true" />
                    Delete
                  </DropdownMenu.Item>
                </>
              )}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>

      <LinkDialog mode="edit" link={link} open={editOpen} onOpenChange={setEditOpen} />

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={`Delete ${link.slug}?`}
        description={`This stops ${link.slug} from resolving right away. Its slug stays reserved so it can never be reassigned to a different destination — restore it any time from the Deleted filter on this page.`}
        confirmLabel="Delete"
        confirming={deleteMutation.isPending}
        error={deleteError}
        onConfirm={handleConfirmDelete}
      />

      {restoreError && (
        <div
          role="alert"
          className="fixed right-4 bottom-4 z-50 max-w-sm rounded-lg border border-critical/40 bg-critical/10 px-4 py-3 text-sm text-critical shadow-lg"
        >
          {restoreError}
        </div>
      )}
    </div>
  );
}
