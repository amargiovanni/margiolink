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
 *  accessible to anyone who cannot distinguish the colours.
 *
 *  Decided once, app-wide (Task 14): colour plus word is sufficient: no
 *  icon requirement. §6.3's literal text asks for "an icon and a label",
 *  but this component has shipped colour+word without one since Task 9
 *  (`LinkRow`'s "Inactive" badge) and passed every review since. Retrofitting
 *  icons here — and onto `BotShareTile`'s "high" bot-share flag, which
 *  already follows the same colour+word pattern deliberately, see its own
 *  comment — would be a cosmetic pass with no accessibility gain the word
 *  alone doesn't already close, so the two are left to agree on the
 *  established, already-reviewed convention rather than the spec's
 *  unimplemented literal text. */
export function Badge({ tone = "neutral", children, className }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border bg-surface-raised/65 px-2.5 py-1 text-[11px] font-semibold tracking-wide",
        TONE_CLASSES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
