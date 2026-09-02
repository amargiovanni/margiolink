import { cn } from "./cn";

export interface SkeletonProps {
  className?: string;
}

/** A loading placeholder shape. Purely decorative — `aria-hidden` keeps it
 *  out of the accessibility tree so assistive technology is not made to
 *  announce a shape with no content, and the pulse respects
 *  `prefers-reduced-motion` through the global rule in app.css that turns
 *  every animation near-instant. */
export function Skeleton({ className }: SkeletonProps) {
  return (
    <div aria-hidden="true" className={cn("animate-pulse rounded bg-surface-sunken", className)} />
  );
}
