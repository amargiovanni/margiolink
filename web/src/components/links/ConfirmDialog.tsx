import { useRef } from "react";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The dialog's title — name the exact object being destroyed (the slug,
   *  never "this link"), so a reader can tell what is about to be gone
   *  without trusting that they clicked the right row. */
  title: string;
  /** The consequence, in one sentence. */
  description: string;
  confirmLabel: string;
  onConfirm: () => void;
  /** Set while the confirmed action is in flight, so a slow request can't be
   *  fired twice by an impatient second click. */
  confirming?: boolean;
  /** Shown when the confirmed action itself failed — the dialog stays open
   *  (the caller controls `open`, not this component) so the message and a
   *  retry are both right there rather than the failure vanishing along
   *  with a dialog that already looked dismissed. */
  error?: string | null;
}

/** The one confirmation dialog for the one irreversible action in this
 *  dashboard. Cancel takes the default focus, via `Dialog`'s
 *  `onOpenAutoFocus` escape hatch: Radix's own default would otherwise focus
 *  its first focusable descendant, which is the dialog's "Close" button, not
 *  Cancel. Escape, an outside click and clicking Cancel are the same path:
 *  all three only ever call `onOpenChange(false)`, never `onConfirm`. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  onConfirm,
  confirming = false,
  error = null,
}: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      onOpenAutoFocus={(event) => {
        event.preventDefault();
        cancelRef.current?.focus();
      }}
    >
      {error && (
        <p
          role="alert"
          className="mb-2 rounded border border-critical/40 bg-critical/10 px-3 py-2 text-sm text-critical"
        >
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2 pt-2">
        <Button ref={cancelRef} type="button" variant="ghost" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button type="button" variant="danger" loading={confirming} onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </div>
    </Dialog>
  );
}
