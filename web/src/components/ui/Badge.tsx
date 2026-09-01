import type { ReactNode } from "react";
import { cn } from "./cn";

export type BadgeTone = "neutral" | "good" | "warning" | "critical";

export interface BadgeProps {
  tone?: BadgeTone;
  children: ReactNode;
  className?: string;
}

const TONE_CLASSES: Record<BadgeTone, string> = {
  neutral: "border-rule text-ink-muted",
  good: "border-good text-good",
  warning: "border-warning text-warning",
  critical: "border-critical text-critical",
};

/** A status tone is never the only signal — every caller pairs it with a
 *  word (the children), never a bare dot, which is what keeps this
 *  accessible to anyone who cannot distinguish the colours. */
export function Badge({ tone = "neutral", children, className }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium",
        TONE_CLASSES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
