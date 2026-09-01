import type { ReactNode } from "react";
import { cn } from "./cn";

export interface EmptyStateProps {
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

/** The placeholder for a list, chart or table with nothing to show yet.
 *  `action` takes a rendered element (typically a `<Button>`) rather than a
 *  label/onClick pair, so EmptyState never has to reimplement button
 *  semantics itself. */
export function EmptyState({ title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-2 rounded-lg border border-dashed border-rule px-6 py-12 text-center",
        className,
      )}
    >
      <p className="font-display text-lg text-ink">{title}</p>
      {description && <p className="max-w-sm text-sm text-ink-muted">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
