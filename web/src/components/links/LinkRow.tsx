import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { MoreVertical, Pencil, Power, QrCode, Trash2 } from "lucide-react";
import { Link as RouterLink } from "react-router";
import { formatCount } from "../../lib/format";
import type { Link, Tag } from "../../lib/queries";
import { Sparkline } from "../charts/Sparkline";
import { Badge } from "../ui/Badge";
import { CopyButton } from "./CopyButton";

const MENU_ITEM_CLASSES =
  "flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm text-ink outline-none data-[highlighted]:bg-surface-sunken";

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const match = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  const digits = match?.[1];
  if (!digits) return null;
  const value = Number.parseInt(digits, 16);
  return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 };
}

/** The tag colour is picked by the user and stored in the database — there is
 *  no validated-palette rule that can (or should) govern it. What *is*
 *  binding: the badge always carries the tag's name as text, so the colour
 *  stays decorative, and whatever colour the user picked, the text drawn on
 *  it must still be readable. WCAG relative luminance decides between black
 *  and white text for that background, rather than assuming one. */
function readableTextColor(rgb: { r: number; g: number; b: number }): "black" | "white" {
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b);
  return luminance > 0.55 ? "black" : "white";
}

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
  /** The last 7 daily click counts for this link, oldest first — absent
   *  (rather than all-zero) when the sparklines query has not resolved yet. */
  sparkline: number[];
}

/** One row of the working list. Below `sm` this renders as a three-line
 *  stacked card (identity, destination, sparkline+actions); above `sm` the
 *  same markup becomes a grid with columns via `sm:contents` on the last
 *  group, so there is no separate mobile/desktop markup to keep in sync and
 *  no `<table>` — these are navigational cards, not tabular data. */
export function LinkRow({ link, sparkline }: LinkRowProps) {
  const clicks = sparkline.reduce((sum, value) => sum + value, 0);

  return (
    <div className="flex flex-col gap-2 border-b border-rule py-3 last:border-b-0 sm:grid sm:grid-cols-[minmax(0,1fr)_auto_auto_auto_auto] sm:items-center sm:gap-4">
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
        <Sparkline values={sparkline} label={`${link.slug}, clicks over the last 7 days`} />

        <p className="text-sm text-ink tabular-nums">{formatCount(clicks)} clicks</p>

        <CopyButton value={link.shortUrl} label={`Copy short link for ${link.slug}`} />

        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button
              type="button"
              aria-label={`Actions for ${link.slug}`}
              className="rounded p-2 text-ink-muted hover:bg-surface-raised hover:text-ink"
            >
              <MoreVertical className="size-4" aria-hidden="true" />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              align="end"
              className="min-w-40 overflow-hidden rounded border border-rule bg-surface-raised p-1 shadow-lg"
            >
              {/* Deactivate and Delete are real, destructive mutations
               *  (useUpdateLink, useDeleteLink already exist) but wiring
               *  them here without a confirmation step would trade an
               *  accessible menu for an accidental-data-loss trap. That
               *  confirmation needs the Dialog primitive, which this task
               *  does not own — see the report's concerns. Edit and QR need
               *  UI (a dialog, a QR renderer) that likewise belongs to later
               *  tasks. All four are rendered, per spec, and left inert,
               *  same as the header's "New link" button. */}
              <DropdownMenu.Item className={MENU_ITEM_CLASSES}>
                <Pencil className="size-4" aria-hidden="true" />
                Edit
              </DropdownMenu.Item>
              <DropdownMenu.Item className={MENU_ITEM_CLASSES}>
                <QrCode className="size-4" aria-hidden="true" />
                QR code
              </DropdownMenu.Item>
              <DropdownMenu.Item className={MENU_ITEM_CLASSES}>
                <Power className="size-4" aria-hidden="true" />
                {link.isActive ? "Deactivate" : "Activate"}
              </DropdownMenu.Item>
              <DropdownMenu.Item className={`${MENU_ITEM_CLASSES} text-critical`}>
                <Trash2 className="size-4" aria-hidden="true" />
                Delete
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>
    </div>
  );
}
