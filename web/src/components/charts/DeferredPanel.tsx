import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { Button } from "../ui/Button";

/** Reserve enough space to keep lower charts below the viewport while they
 * wait. A real button also makes every panel reachable without scrolling or
 * IntersectionObserver, including keyboard and assistive-technology users.
 */
export function DeferredPanel({
  title,
  children,
  headingLevel = 2,
}: {
  title: string;
  children: ReactNode;
  headingLevel?: 2 | 3;
}) {
  const [loaded, setLoaded] = useState(() => typeof IntersectionObserver === "undefined");
  const container = useRef<HTMLDivElement>(null);
  const reveal = useCallback(() => {
    // A keyboard user's focus may scroll this placeholder into view before
    // Enter is pressed. Keep focus in the panel when its button is replaced.
    if (container.current?.contains(document.activeElement)) container.current.focus();
    setLoaded(true);
  }, []);
  useEffect(() => {
    if (loaded || !container.current) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) reveal();
    });
    observer.observe(container.current);
    return () => observer.disconnect();
  }, [loaded, reveal]);
  const Heading = headingLevel === 3 ? "h3" : "h2";
  return (
    <div ref={container} tabIndex={-1} className="empty:hidden" data-deferred-panel={title}>
      {loaded ? (
        children
      ) : (
        <div className="flex min-h-64 flex-col items-start gap-4 rounded-lg border border-rule bg-surface-raised p-5 sm:p-6">
          <Heading className="font-display text-xl font-semibold tracking-tight">{title}</Heading>
          <p className="text-sm text-ink-muted">Loads when in view, or open it now.</p>
          <Button variant="ghost" onClick={reveal}>{`Load ${title}`}</Button>
        </div>
      )}
    </div>
  );
}
