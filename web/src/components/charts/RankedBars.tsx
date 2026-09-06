import { formatCount } from "../../lib/format";

export function RankedBars({
  slices,
  label,
  valueLabel = "Clicks",
  color = "var(--color-series-1)",
  limit,
}: {
  slices: { value: string; clicks: number; uniques: number }[];
  label: string;
  valueLabel?: string;
  color?: string;
  limit?: number;
}) {
  if (slices.length === 0) {
    return <p className="py-6 text-center text-sm text-ink-faint">No data for this period.</p>;
  }

  const max = Math.max(...slices.map((s) => s.clicks), 1);
  const visible = limit === undefined ? slices : slices.slice(0, limit);

  return (
    <div>
      <ul aria-label={label} className="flex flex-col gap-2.5">
        {visible.map((slice) => (
          <li key={slice.value} className="grid grid-cols-[1fr_auto] items-center gap-3">
            <div className="min-w-0">
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate text-sm font-medium">{slice.value}</span>
                <span className="shrink-0 text-sm tabular text-ink-muted">
                  {formatCount(slice.clicks)}
                </span>
              </div>
              <div className="mt-1.5 h-1 rounded-full bg-surface-sunken">
                <div
                  data-bar
                  className="h-full rounded-full"
                  style={{ width: `${(slice.clicks / max) * 100}%`, background: color }}
                  title={`${slice.value}: ${slice.clicks} ${valueLabel.toLowerCase()}, ${slice.uniques} unique`}
                />
              </div>
            </div>
          </li>
        ))}
      </ul>
      {visible.length < slices.length ? (
        <p className="mt-4 border-t border-rule pt-3 text-xs text-ink-faint">
          Showing top {visible.length} of {slices.length}. Use Table for the full breakdown.
        </p>
      ) : null}
    </div>
  );
}
