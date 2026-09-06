export function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-2.5">
      <span
        aria-hidden="true"
        className="grid size-9 shrink-0 place-items-center rounded-xl bg-accent font-display text-lg font-semibold text-accent-ink shadow-[0_8px_24px_color-mix(in_srgb,var(--color-accent)_24%,transparent)]"
      >
        M
      </span>
      <span className={compact ? "sr-only" : "font-display text-lg font-semibold tracking-tight"}>
        MargioLink
      </span>
    </span>
  );
}
