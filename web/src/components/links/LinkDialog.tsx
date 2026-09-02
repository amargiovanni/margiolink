import { useEffect, useRef, useState } from "react";
import type { Link } from "../../lib/queries";
import { Dialog } from "../ui/Dialog";
import { LinkForm } from "./LinkForm";

export type LinkDialogProps =
  | { mode: "create"; open: boolean; onOpenChange: (open: boolean) => void }
  | { mode: "edit"; link: Link; open: boolean; onOpenChange: (open: boolean) => void };

const TOAST_MS = 4000;

/** Create and edit share one dialog and one form (`LinkForm`) — only the
 *  title and the initial values differ. The toast confirming a fresh copy
 *  lives here rather than inside `LinkForm`, and is rendered as a sibling of
 *  `Dialog` rather than inside it: `Dialog`'s content unmounts the instant
 *  `onOpenChange(false)` runs, and a confirmation that vanished with the
 *  dialog it was celebrating would defeat the point of showing it. */
export function LinkDialog(props: LinkDialogProps) {
  const { open, onOpenChange, mode } = props;
  const link = mode === "edit" ? props.link : undefined;
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(toastTimer.current), []);

  function showToast(message: string) {
    setToast(message);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), TOAST_MS);
  }

  async function handleDone(createdLink?: Link) {
    onOpenChange(false);
    if (!createdLink) return;

    // Creating a link and then hunting for a copy button is the single most
    // repeated action in this product (brief, Step 3) — so the short URL is
    // copied immediately, best-effort, the same way `CopyButton` treats a
    // missing `navigator.clipboard` as a fact to announce rather than a
    // silent no-op.
    if (navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(createdLink.shortUrl);
        showToast(`Copied ${createdLink.shortUrl} to the clipboard.`);
        return;
      } catch {
        // Falls through to the "created without copy" message below.
      }
    }
    showToast("Link created — copy it from the list.");
  }

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={onOpenChange}
        title={mode === "create" ? "New link" : `Edit ${link?.slug}`}
      >
        <LinkForm mode={mode} link={link} onDone={handleDone} />
      </Dialog>
      {toast && (
        <div
          role="status"
          aria-live="polite"
          className="fixed right-4 bottom-4 z-50 max-w-sm rounded-lg border border-rule bg-surface-raised px-4 py-3 text-sm text-ink shadow-lg"
        >
          {toast}
        </div>
      )}
    </>
  );
}
