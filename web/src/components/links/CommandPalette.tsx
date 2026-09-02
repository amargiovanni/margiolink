import * as RadixDialog from "@radix-ui/react-dialog";
import { Command } from "cmdk";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { useLinks } from "../../lib/queries";
import { SECTIONS } from "../layout/PrimaryNav";

const ITEM_CLASSNAME =
  "cursor-pointer rounded px-2 py-2 text-sm text-ink data-[selected=true]:bg-surface-sunken";
const GROUP_CLASSNAME = "px-2 py-1 text-xs text-ink-faint [&_[cmdk-group-items]]:mt-1";

// `event.target` reports the host element rather than the actual field for
// a Shadow-DOM web component (event retargeting), which would defeat this
// check. Not exploitable today — this app has no web components — but worth
// remembering if one is ever introduced here.
function isRichTextEditor(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && target.isContentEditable;
}

/** The recent-links section is its own component, rendered only inside
 *  `RadixDialog.Content` (which Radix does not mount at all while the dialog
 *  is closed), so its `useLinks()` call — and the request it fires — only
 *  happens once the palette is actually opened, not on every keystroke
 *  anywhere else in the app. */
function RecentLinksGroup({ onSelect }: { onSelect: (to: string) => void }) {
  const recentLinksQuery = useLinks({ limit: 5, offset: 0 });
  const recentLinks = recentLinksQuery.data?.links ?? [];
  if (recentLinks.length === 0) return null;
  return (
    <Command.Group heading="Recent links" className={GROUP_CLASSNAME}>
      {recentLinks.map((link) => (
        <Command.Item
          key={link.id}
          // cmdk filters on `value`, not on the rendered children — a
          // `value` built from the id (as this once was) meant typing a
          // link's actual title matched nothing. This is the text a person
          // would actually type: the title when there is one, always
          // including the slug too (which is unique, so this also can't
          // collide across two links sharing a title).
          value={`${link.title ?? ""} ${link.slug}`.trim()}
          onSelect={() => onSelect(`/links/${link.id}`)}
          className={ITEM_CLASSNAME}
        >
          {link.title || link.slug}
        </Command.Item>
      ))}
    </Command.Group>
  );
}

/** Reachable from anywhere via ⌘K (Ctrl+K off a Mac) — spec §6.1: "Creation
 *  from anywhere via ⌘K". Built directly on Radix's Dialog primitives rather
 *  than `cmdk`'s own `Command.Dialog` convenience wrapper: that wrapper
 *  names its `Content` with a bare `aria-label` and renders no accessible
 *  description, which is exactly the gap `Dialog.tsx` (Task 4) closes for
 *  every other dialog in this app by always rendering a `Title` and a
 *  `Description` — visually hidden here, since neither needs to be seen. */
export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key.toLowerCase() !== "k" || !(event.metaKey || event.ctrlKey)) return;
      // Ctrl+Shift+K opens Firefox's Web Console — not ours to take. A
      // plain Alt/Option+K carries no meaning here either, so leave any
      // modified-beyond-the-two-we-bind combination alone.
      if (event.shiftKey || event.altKey) return;
      // A plain <input>/<textarea>/<select> has no competing meaning for
      // ⌘K/Ctrl+K — taking it there is exactly what makes a command palette
      // useful (Linear, GitHub and Slack all do this too): you reach for it
      // mid-typing, including from this app's own links-page search box,
      // which is why this does NOT also exclude form fields in general. A
      // rich-text editor is the one real exception, since Ctrl/Cmd+K
      // conventionally means "insert link" there — that's the only field
      // this shortcut steps aside for.
      if (isRichTextEditor(event.target)) return;
      event.preventDefault();
      setOpen((value) => !value);
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  function go(to: string) {
    setOpen(false);
    navigate(to);
  }

  return (
    <RadixDialog.Root open={open} onOpenChange={setOpen}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-40 bg-surface-sunken/80" />
        <RadixDialog.Content className="fixed top-24 left-1/2 z-50 w-full max-w-lg -translate-x-1/2 overflow-hidden rounded-lg border border-rule bg-surface-raised shadow-lg">
          <RadixDialog.Title className="sr-only">Command palette</RadixDialog.Title>
          <RadixDialog.Description className="sr-only">
            Jump to a section, a recent link, or create a new one.
          </RadixDialog.Description>
          <Command label="Command palette" className="flex flex-col">
            <Command.Input
              autoFocus
              placeholder="Jump to a link or section…"
              className="border-b border-rule bg-transparent px-4 py-3 text-sm text-ink outline-none placeholder:text-ink-faint"
            />
            <Command.List className="max-h-80 overflow-y-auto p-2">
              <Command.Empty className="px-2 py-6 text-center text-sm text-ink-faint">
                No results found.
              </Command.Empty>

              <Command.Group heading="Actions" className={GROUP_CLASSNAME}>
                <Command.Item onSelect={() => go("/links?new=1")} className={ITEM_CLASSNAME}>
                  New link
                </Command.Item>
              </Command.Group>

              <Command.Group heading="Go to" className={GROUP_CLASSNAME}>
                {SECTIONS.map((section) => (
                  <Command.Item
                    key={section.to}
                    onSelect={() => go(section.to)}
                    className={ITEM_CLASSNAME}
                  >
                    {section.label}
                  </Command.Item>
                ))}
              </Command.Group>

              <RecentLinksGroup onSelect={go} />
            </Command.List>
          </Command>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
