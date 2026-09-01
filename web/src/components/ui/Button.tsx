import { Loader2 } from "lucide-react";
import type { ButtonHTMLAttributes } from "react";
import { forwardRef } from "react";
import { cn } from "./cn";

export type ButtonVariant = "primary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Sets `aria-busy` and disables the button so assistive technology, not
   *  only sighted users watching a spinner, learns that the action is
   *  in flight. */
  loading?: boolean;
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: "bg-accent text-accent-ink hover:opacity-90",
  ghost: "border border-rule bg-transparent text-ink hover:bg-surface-raised",
  // No token pairs `critical` with an accessible on-fill text colour the way
  // `accent-ink` pairs with `accent`, so danger stays an outline treatment
  // (critical border and text on the ambient surface) rather than a solid
  // fill — the same pattern Login.tsx and RequireSession.tsx already use
  // for critical text elsewhere in this app.
  danger: "border border-critical bg-transparent text-critical hover:bg-critical/10",
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: "gap-1.5 rounded px-3 py-1.5 text-sm",
  md: "gap-2 rounded px-4 py-2 text-sm",
};

/** Always a real `<button>` — never a styled div or anchor — so focus,
 *  keyboard activation (Enter/Space) and the accessibility tree all come
 *  from the browser for free. Focus styling is the global `:focus-visible`
 *  ring from app.css; this component never overrides it. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", loading = false, disabled, className, children, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      aria-busy={loading || undefined}
      disabled={disabled || loading}
      className={cn(
        "inline-flex items-center justify-center font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60",
        VARIANT_CLASSES[variant],
        SIZE_CLASSES[size],
        className,
      )}
      {...props}
    >
      {loading && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
      {children}
    </button>
  );
});
