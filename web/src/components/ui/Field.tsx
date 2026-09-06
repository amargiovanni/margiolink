import { cloneElement, isValidElement, type ReactElement } from "react";
import { cn } from "./cn";

export interface FieldProps {
  /** Must match the `id` on the wrapped control — Field does not invent one,
   *  so the label's `htmlFor` and the generated description ids always line
   *  up with the control the caller actually rendered. */
  id: string;
  label: string;
  hint?: string;
  error?: string;
  className?: string;
  /** The control to wire up. Field clones it to add `id`, `aria-invalid` and
   *  `aria-describedby`, so a caller cannot forget any of the three or drift
   *  the child's `id` out of sync with the label's `htmlFor` and the
   *  generated description ids. */
  children: ReactElement<Record<string, unknown>>;
}

/** Wraps any input with a label, an optional hint and an optional error,
 *  wiring `aria-invalid`/`aria-describedby` onto the control itself. Both
 *  the hint and the error, when present, are referenced by
 *  `aria-describedby` (space-separated) and the error additionally carries
 *  `role="alert"` — the alert announces the change the moment it appears,
 *  the description makes it findable afterwards when a screen-reader user
 *  navigates back to the control. */
export function Field({ id, label, hint, error, children, className }: FieldProps) {
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy =
    [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(" ") || undefined;

  const control = isValidElement(children)
    ? cloneElement(children, {
        id,
        "aria-invalid": error ? true : undefined,
        "aria-describedby": describedBy,
      })
    : children;

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-xs font-semibold tracking-wide text-ink-muted">
        {label}
      </label>
      {control}
      {hint && (
        <p id={hintId} className="text-sm text-ink-faint">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="text-sm text-critical">
          {error}
        </p>
      )}
    </div>
  );
}
