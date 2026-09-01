import { Link as RouterLink } from "react-router";
import { hexToRgb, readableTextColor } from "../../lib/contrast";
import { formatCount } from "../../lib/format";
import type { Link, Tag } from "../../lib/queries";
import { Sparkline } from "../charts/Sparkline";
import { Badge } from "../ui/Badge";
import { CopyButton } from "./CopyButton";

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
 *  The row's action menu (Edit, QR code, Deactivate, Delete) is not part of
 *  this task: Edit and QR have nowhere to go yet, and wiring Deactivate or
 *  Delete without a confirmation step would trade a menu for an
 *  accidental-data-loss trap. Rendering four inert items to "look finished"
 *  was worse than not rendering the menu at all — a later task adds it back
 *  once each item has somewhere real to go. See the comment further below,
 *  at the point the trigger used to sit, for how those tasks should wire
 *  it and why `disabled` isn't the mechanism. */
export function LinkRow({ link, sparkline }: LinkRowProps) {
  const clicks = sparkline?.reduce((sum, value) => sum + value, 0) ?? null;

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
          {!link.isActive && <Badge tone="warning">Inactive</Badge>}
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

        {/* The action menu (Edit, QR code, Deactivate, Delete) belongs
         *  here. Task 10 reintroduces it with Edit and QR wired; Task 11
         *  adds Deactivate and Delete behind a confirmation dialog.
         *
         *  When an item in that menu is genuinely unavailable rather than
         *  simply not built yet (e.g. Delete when the viewer lacks
         *  permission, or Activate on a link that's already active), mark
         *  it with `aria-disabled="true"` plus `onSelect={(e) =>
         *  e.preventDefault()}` — NOT Radix's `disabled` prop. `disabled`
         *  drops the item from the roving-focus group entirely
         *  (`focusable: !disabled`), so inside a `role="menu"`'s
         *  application mode a screen reader never encounters it at all,
         *  while a sighted user still sees it greyed out. `aria-disabled`
         *  keeps the item in the arrow-key cycle and announces it as
         *  unavailable — true for a permission gate, but not true here:
         *  an unbuilt feature isn't "unavailable to you", it doesn't
         *  exist yet, and announcing otherwise would tell the user
         *  something false about the product. That's why this menu is
         *  absent rather than present-and-disabled until Task 10/11 give
         *  its items somewhere real to go. */}
      </div>
    </div>
  );
}
