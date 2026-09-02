import { Fragment } from "react";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** The bounded, known maximum a `dow_hour` dimension query can ever return:
 *  7 days × 24 hours. Callers request exactly this many rows so the API's
 *  `ORDER BY clicks DESC … LIMIT ?` never truncates a cell this grid would
 *  otherwise render — a cell absent from the response is genuinely zero,
 *  but only once the request itself could not have dropped it. */
export const HEATMAP_CELLS = DAYS.length * 24;
const RAMP = [
  "var(--color-ramp-1)",
  "var(--color-ramp-2)",
  "var(--color-ramp-3)",
  "var(--color-ramp-4)",
  "var(--color-ramp-5)",
];

// The `uniques` field is unused here, but the API's DimensionSlice shape
// carries it on every dimension, dow_hour included — the prop type must
// accept the real shape rather than a narrower one the caller cannot satisfy.
export function Heatmap({
  slices,
}: {
  slices: { value: string; clicks: number; uniques: number }[];
}) {
  const byCell = new Map(slices.map((s) => [s.value, s.clicks]));
  const max = Math.max(...slices.map((s) => s.clicks), 1);

  return (
    <div className="overflow-x-auto">
      <div className="grid min-w-[34rem] grid-cols-[auto_repeat(24,minmax(0,1fr))] gap-[2px]">
        <span />
        {Array.from({ length: 24 }, (_, hour) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: the 24-hour header is static — it never reorders, grows or shrinks, so the hour is a stable identity, not just a position.
          <span key={`hour-${hour}`} className="text-center text-[10px] tabular text-ink-faint">
            {hour % 6 === 0 ? hour : ""}
          </span>
        ))}

        {DAYS.map((day, dow) => (
          <Fragment key={day}>
            <span className="pr-2 text-right text-[11px] text-ink-faint">{day.slice(0, 3)}</span>
            {Array.from({ length: 24 }, (_, hour) => {
              const key = `${dow}-${String(hour).padStart(2, "0")}`;
              const clicks = byCell.get(key) ?? 0;
              // Zero is the surface, not the ramp's first step: an hour with no
              // clicks should read as absent rather than as a small value.
              const step = clicks === 0 ? null : Math.min(4, Math.floor((clicks / max) * 5));
              return (
                <div
                  data-cell
                  key={key}
                  role="img"
                  aria-label={`${day} ${String(hour).padStart(2, "0")}:00 — ${clicks} clicks`}
                  title={`${day} ${String(hour).padStart(2, "0")}:00 — ${clicks} clicks`}
                  className="aspect-square rounded-[2px]"
                  style={{ background: step === null ? "var(--color-surface-sunken)" : RAMP[step] }}
                />
              );
            })}
          </Fragment>
        ))}
      </div>
    </div>
  );
}
