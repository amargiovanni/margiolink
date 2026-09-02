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

/** A period belongs on the picker only if its own *comparison* window — the
 *  immediately preceding span of equal length every KPI delta is measured
 *  against (`rangeFor`'s caller subtracts `span` from `from` — see
 *  `useSummary` in `lib/queries.ts`) — also falls inside the deployment's
 *  retention window. A period whose own span fits but whose comparison
 *  window does not is not merely imprecise: raw `clicks` holds nothing
 *  there, `previous` reads as zero against data that was simply deleted,
 *  and `formatDelta` turns that into a false "new" with a green up-arrow
 *  (`lib/format.ts`). Hence `2 * period.seconds`, not `period.seconds`.
 *
 *  `retentionDays` is `GET /api/meta`'s `retentionDays` (`useMeta`), never a
 *  literal here — a deployment that raises `RAW_RETENTION_DAYS` gets the
 *  longer periods back with no code change, and one that lowers it loses
 *  them the same way. */
export function periodsFor(retentionDays: number) {
  return PERIODS.filter((period) => 2 * period.seconds <= retentionDays * DAY);
}

/** The line a picker shows near itself when the deployment's retention
 *  window has dropped one or more periods off the full list — `null` when
 *  nothing was dropped, so a caller renders nothing rather than a note that
 *  states nothing useful. A picker that used to offer more and silently
 *  offers less, with no explanation, is its own small false statement. */
export function droppedPeriodsNote(retentionDays: number): string | null {
  if (periodsFor(retentionDays).length === PERIODS.length) return null;
  return `Periods whose comparison window would fall outside the ${retentionDays}-day retention window aren't offered.`;
}

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
