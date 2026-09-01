const HOUR = 3600;
const DAY = 86_400;

export const PERIODS = [
  { id: "24h", label: "24 hours", seconds: DAY },
  { id: "7d", label: "7 days", seconds: 7 * DAY },
  { id: "30d", label: "30 days", seconds: 30 * DAY },
  { id: "90d", label: "90 days", seconds: 90 * DAY },
  { id: "12m", label: "12 months", seconds: 365 * DAY },
] as const;

export type PeriodId = (typeof PERIODS)[number]["id"];

/** Snapped to the hour so a refresh does not shift every bucket by a few
 *  seconds and invalidate the cache for no reason. */
export function rangeFor(id: PeriodId, nowSeconds = Math.floor(Date.now() / 1000)) {
  const period = PERIODS.find((p) => p.id === id) ?? PERIODS[1];
  const to = Math.floor(nowSeconds / HOUR) * HOUR;
  return { from: to - period.seconds, to };
}

/** Keeps the column count readable: at most ~48 hourly, ~90 daily, then weekly. */
export function granularityFor(from: number, to: number): "hour" | "day" | "week" {
  const span = to - from;
  if (span <= 2 * DAY) return "hour";
  if (span <= 90 * DAY) return "day";
  return "week";
}
