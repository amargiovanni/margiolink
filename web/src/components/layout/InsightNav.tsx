export interface InsightNavItem {
  id: string;
  label: string;
}

export function InsightNav({ items }: { items: InsightNavItem[] }) {
  return (
    <nav
      aria-label="Link insights"
      className="sticky top-17 z-10 -mx-4 overflow-x-auto border-y border-rule bg-surface/90 px-4 py-2 backdrop-blur sm:mx-0 sm:rounded-xl sm:border sm:px-2"
    >
      <ul className="flex min-w-max items-center gap-1">
        {items.map((item, index) => (
          <li key={item.id}>
            <a
              href={`#${item.id}`}
              className="inline-flex min-h-10 items-center gap-2 rounded-lg px-3 text-sm font-semibold text-ink-muted transition-colors hover:bg-surface-raised hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              <span className="font-mono text-[0.65rem] text-accent" aria-hidden="true">
                {String(index + 1).padStart(2, "0")}
              </span>
              {item.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
