import { formatCount } from "../../lib/format";

export function RankedBars({
  slices,
  label,
  valueLabel = "Clicks",
  color = "var(--color-series-1)",
}: {
  slices: { value: string; clicks: number; uniques: number }[];
  label: string;
  valueLabel?: string;
  color?: string;
}) {
  if (slices.length === 0) {
    return <p className="py-6 text-center text-sm text-ink-faint">No data for this period.</p>;
  }

  const max = Math.max(...slices.map((s) => s.clicks), 1);

  return (
    <ul aria-label={label} className="flex flex-col gap-2">
      {slices.map((slice) => (
        <li key={slice.value} className="grid grid-cols-[1fr_auto] items-center gap-3">
          <div className="min-w-0">
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate text-sm">{slice.value}</span>
              {/* Direct label: never make a reader estimate a length. */}
              <span className="shrink-0 text-sm tabular text-ink-muted">
                {formatCount(slice.clicks)}
              </span>
            </div>
            {/* 4px rounded ends per spec §6.4 — not a pill: "rounded", not
                "rounded-full". */}
            <div className="mt-1 h-1.5 rounded bg-surface-sunken">
              <div
                data-bar
                className="h-full rounded"
                style={{ width: `${(slice.clicks / max) * 100}%`, background: color }}
                title={`${slice.value}: ${slice.clicks} ${valueLabel.toLowerCase()}, ${slice.uniques} unique`}
              />
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
