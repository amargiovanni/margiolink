import * as RadixTooltip from "@radix-ui/react-tooltip";
import type { ReactNode } from "react";
import { cn } from "./cn";

export interface TooltipProps {
  content: ReactNode;
  children: ReactNode;
  className?: string;
}

/** Wraps Radix's Tooltip, which shows on hover and on keyboard focus alike
 *  and manages its own `aria-describedby` wiring to the trigger. Each
 *  `Tooltip` renders its own `Provider` — cheap, and it keeps the primitive
 *  usable on its own without a caller having to mount a provider at the
 *  app root first. */
export function Tooltip({ content, children, className }: TooltipProps) {
  return (
    <RadixTooltip.Provider delayDuration={200}>
      <RadixTooltip.Root>
        <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
        <RadixTooltip.Portal>
          <RadixTooltip.Content
            sideOffset={6}
            className={cn(
              "rounded border border-rule bg-surface-raised px-2 py-1 text-xs text-ink shadow-lg",
              className,
            )}
          >
            {content}
            <RadixTooltip.Arrow className="fill-surface-raised" />
          </RadixTooltip.Content>
        </RadixTooltip.Portal>
      </RadixTooltip.Root>
    </RadixTooltip.Provider>
  );
}
