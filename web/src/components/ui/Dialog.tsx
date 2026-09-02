import * as RadixDialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "./cn";

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Required — there is no way to construct a Dialog without an accessible
   *  name. Rendered in `Dialog.Title`, which Radix wires to the dialog via
   *  `aria-labelledby` on its own. */
  title: string;
  /** Optional visible description. When omitted, a visually hidden
   *  description falling back to the title is still rendered, because Radix
   *  otherwise warns on every render that `DialogContent` has no accessible
   *  description. */
  description?: string;
  children: ReactNode;
  className?: string;
  /** Escape hatch for the rare caller that needs to steer initial focus
   *  away from Radix's own default (the first focusable descendant, which
   *  is this component's own "Close" button) — `ConfirmDialog` (Task 10)
   *  uses this to put default focus on Cancel instead, since Radix's
   *  auto-focus happens on its own timing and isn't reliably beaten by a
   *  caller re-focusing from a plain effect after mount. Forwarded verbatim
   *  to `RadixDialog.Content`'s own `onOpenAutoFocus`; every other caller
   *  can leave it unset and keep the default behaviour. */
  onOpenAutoFocus?: (event: Event) => void;
}

/** Wraps Radix's Dialog for focus trapping, `aria-*` wiring, Escape-to-close
 *  and portal rendering — none of that is reimplemented here. Styling and
 *  the required `title` prop are what this component adds. */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  className,
  onOpenAutoFocus,
}: DialogProps) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-40 bg-surface-sunken/80" />
        <RadixDialog.Content
          onOpenAutoFocus={onOpenAutoFocus}
          className={cn(
            "fixed top-1/2 left-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border border-rule bg-surface-raised p-6 shadow-lg",
            className,
          )}
        >
          <div className="flex items-start justify-between gap-4">
            <RadixDialog.Title className="font-display text-lg text-ink">{title}</RadixDialog.Title>
            <RadixDialog.Close asChild>
              <button
                type="button"
                aria-label="Close"
                className="shrink-0 rounded text-ink-muted hover:text-ink"
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            </RadixDialog.Close>
          </div>
          {description ? (
            <RadixDialog.Description className="mt-1 text-sm text-ink-muted">
              {description}
            </RadixDialog.Description>
          ) : (
            <RadixDialog.Description className="sr-only">{title}</RadixDialog.Description>
          )}
          <div className="mt-4">{children}</div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
