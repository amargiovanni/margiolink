import { scaleLinear } from "d3-scale";
import { area as d3Area, line as d3Line } from "d3-shape";
import { type KeyboardEvent, type PointerEvent, useRef, useState } from "react";
import { formatCount } from "../../lib/format";
import { EmptyState } from "../ui/EmptyState";

export interface TimeSeriesBucket {
  bucket: string;
  clicks: number;
  uniques: number;
}

export type TimeSeriesGranularity = "hour" | "day" | "week";

// Fixed internal coordinate system. `preserveAspectRatio="none"` plus a CSS
// width of 100% lets the SVG stretch to its container without distorting the
// 2px stroke widths drawn at these coordinates.
const WIDTH = 640;
const HEIGHT = 240;
const MARGIN = { top: 12, right: 12, bottom: 24, left: 44 };
const PLOT_WIDTH = WIDTH - MARGIN.left - MARGIN.right;
const PLOT_HEIGHT = HEIGHT - MARGIN.top - MARGIN.bottom;
const MAX_X_LABELS = 8;
// The overlay's horizontal position/width as percentages of the container.
// Because `preserveAspectRatio="none"` scales x uniformly by
// containerWidthPx / WIDTH, a plain CSS percentage lines the HTML overlay up
// exactly with the plot area with no JS measurement needed. Vertical needs
// no such conversion: `style={{ height: HEIGHT }}` on the <svg> makes the
// vertical scale factor exactly 1, so top/height below are plain pixels.
const PLOT_LEFT_PCT = (MARGIN.left / WIDTH) * 100;
const PLOT_RIGHT_PCT = (MARGIN.right / WIDTH) * 100;

/** Bucket strings come straight from the API's SQL expressions: "day" and
 *  "week" are `date(...)` (YYYY-MM-DD), "hour" is `strftime('%Y-%m-%dT%H:00')`
 *  — both parseable, but the hour form carries no timezone designator so it
 *  is treated as local time, which is what the API's ts column already is
 *  for display purposes here. */
function labelFor(bucket: string, granularity: TimeSeriesGranularity): string {
  const date = new Date(bucket);
  if (Number.isNaN(date.getTime())) return bucket;
  if (granularity === "hour") {
    return date.toLocaleTimeString(undefined, { hour: "numeric" });
  }
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Two series, clicks and uniques, on one y-scale — spec §6.4 forbids a
 *  second axis, and a shared scale is the honest choice since uniques is
 *  always a subset of clicks. Uniques is drawn over clicks (the second
 *  categorical slot, on top) since it is always the smaller of the two and
 *  would otherwise sit hidden beneath clicks' fill.
 *
 *  The plot itself is a plain, hidden-from-AT `<svg>`; the accessible summary
 *  lives on a sibling element, and the interactive crosshair control is a
 *  plain HTML overlay outside the `<svg>` entirely — see the comment above
 *  the returned JSX for why they're kept apart rather than nested. */
export function TimeSeries({
  buckets,
  granularity,
}: {
  buckets: TimeSeriesBucket[];
  granularity: TimeSeriesGranularity;
}) {
  const plotRef = useRef<HTMLDivElement>(null);
  // null means "no explicit interaction yet" — the crosshair still renders
  // (a static crosshair does not need `prefers-reduced-motion` gating per
  // spec §6.4), defaulting to the most recent bucket, but a fresh pointer
  // hover or arrow press takes over from there.
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  if (buckets.length === 0) {
    return (
      <EmptyState
        title="No clicks in this period."
        description="Nothing was recorded for the selected range."
      />
    );
  }

  // `buckets[0]` is provably defined past the `length === 0` guard above;
  // `noUncheckedIndexedAccess` cannot see that control-flow fact through an
  // array index, hence the assertions below.
  const first = buckets[0] as TimeSeriesBucket;
  const safeIndex = clamp(activeIndex ?? buckets.length - 1, 0, buckets.length - 1);
  const active = buckets[safeIndex] as TimeSeriesBucket;

  const totalClicks = buckets.reduce((sum, b) => sum + b.clicks, 0);
  const peak = buckets.reduce((max, b) => (b.clicks > max.clicks ? b : max), first);
  const periodLabel =
    buckets.length === 1
      ? labelFor(first.bucket, granularity)
      : `${labelFor(first.bucket, granularity)} to ${labelFor(buckets.at(-1)?.bucket ?? first.bucket, granularity)}`;
  const summary = `${formatCount(totalClicks)} clicks between ${periodLabel}, peaking at ${formatCount(peak.clicks)} clicks on ${labelFor(peak.bucket, granularity)}`;

  const maxValue = Math.max(...buckets.map((b) => Math.max(b.clicks, b.uniques)), 1);
  // A single bucket makes an index domain of [0, 0], which scaleLinear maps
  // entirely to one edge and which can feed NaN into a path — pin the
  // divisor to at least 1 so the domain never collapses to zero width.
  const x = scaleLinear()
    .domain([0, Math.max(buckets.length - 1, 1)])
    .range([0, PLOT_WIDTH]);
  const y = scaleLinear().domain([0, maxValue]).range([PLOT_HEIGHT, 0]);

  const lineFor = (key: "clicks" | "uniques") =>
    d3Line<TimeSeriesBucket>()
      .x((_, i) => x(i))
      .y((b) => y(b[key]))(buckets) ?? undefined;

  const areaFor = (key: "clicks" | "uniques") =>
    d3Area<TimeSeriesBucket>()
      .x((_, i) => x(i))
      .y0(PLOT_HEIGHT)
      .y1((b) => y(b[key]))(buckets) ?? undefined;

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((t) => Math.round(maxValue * t));
  // Thinned so labels never collide: at most eight, chosen by index.
  const labelStride = Math.max(1, Math.ceil(buckets.length / MAX_X_LABELS));

  function moveActive(delta: number) {
    setActiveIndex((prev) => clamp((prev ?? buckets.length - 1) + delta, 0, buckets.length - 1));
  }

  function indexFromClientX(clientX: number): number | null {
    const rect = plotRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return null;
    const fraction = clamp((clientX - rect.left) / rect.width, 0, 1);
    return Math.round(fraction * Math.max(buckets.length - 1, 1));
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const index = indexFromClientX(event.clientX);
    if (index !== null) setActiveIndex(index);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      moveActive(-1);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      moveActive(1);
    }
  }

  const activeLabel = labelFor(active.bucket, granularity);
  const activeValueText = `${activeLabel}: ${formatCount(active.clicks)} clicks, ${formatCount(active.uniques)} uniques`;

  return (
    <div className="relative">
      {/* The chart's summary lives on its own element, and the interactive
          control below is a plain HTML overlay entirely outside the <svg> —
          not a "slider inside a role=img" nesting. role="img" carries the
          ARIA "children presentational" trait: a focusable descendant of a
          role="img" element can legally be flattened out of the
          accessibility tree by an implementation, or announced strangely.
          The conflict-resolution exception that would rescue this is only
          reliably defined for `presentation`/`none`, not `img`, across
          assistive technologies — so the summary, the decorative graphic,
          and the interactive control are kept as three independent
          siblings rather than betting on that nesting working. */}
      <span role="img" aria-label={summary} className="sr-only" />

      {/* Purely decorative and, as a whole, hidden from assistive
          technology — the overlay below is the chart's one and only
          accessible entry point to its values. */}
      <svg
        aria-hidden="true"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="none"
        className="w-full"
        style={{ height: HEIGHT }}
      >
        <g transform={`translate(${MARGIN.left},${MARGIN.top})`}>
          {/* y axis: gridlines + labels at four steps */}
          <g data-axis="y">
            {yTicks.map((tick, i) => (
              // Keyed by step index, not the rounded value: a small maxValue
              // (e.g. 3) rounds two of the four steps to the same integer,
              // and two ticks legitimately sharing a displayed value must
              // not collide as React keys.
              // biome-ignore lint/suspicious/noArrayIndexKey: yTicks is a fixed-length (5) array of fractions of maxValue, recomputed whole on every render — index is a stable, correct identity here, not a stand-in for a missing one.
              <g key={i} transform={`translate(0,${y(tick)})`}>
                <line x1={0} x2={PLOT_WIDTH} stroke="var(--color-rule)" strokeWidth={1} />
                <text
                  x={-8}
                  dy="0.32em"
                  textAnchor="end"
                  fontSize={10}
                  fill="var(--color-ink-faint)"
                >
                  {formatCount(tick)}
                </text>
              </g>
            ))}
          </g>

          {/* x axis: labels thinned to at most eight, chosen by index */}
          <g data-axis="x">
            {buckets.map((bucket, i) =>
              i % labelStride === 0 ? (
                <text
                  key={bucket.bucket}
                  x={x(i)}
                  y={PLOT_HEIGHT + 16}
                  textAnchor="middle"
                  fontSize={10}
                  fill="var(--color-ink-faint)"
                >
                  {labelFor(bucket.bucket, granularity)}
                </text>
              ) : null,
            )}
          </g>

          {/* clicks, drawn first so uniques sits on top of it */}
          <path
            data-area="clicks"
            d={areaFor("clicks")}
            fill="var(--color-series-1)"
            opacity={0.12}
          />
          <path
            data-line="clicks"
            d={lineFor("clicks")}
            fill="none"
            stroke="var(--color-series-1)"
            strokeWidth={2}
            strokeLinecap="round"
          />

          {/* uniques, in the second categorical slot, over clicks */}
          <path
            data-area="uniques"
            d={areaFor("uniques")}
            fill="var(--color-series-2)"
            opacity={0.12}
          />
          <path
            data-line="uniques"
            d={lineFor("uniques")}
            fill="none"
            stroke="var(--color-series-2)"
            strokeWidth={2}
            strokeLinecap="round"
          />

          {/* Static crosshair — no animation, so no prefers-reduced-motion
              gating is required per spec §6.4. */}
          <line
            x1={x(safeIndex)}
            x2={x(safeIndex)}
            y1={0}
            y2={PLOT_HEIGHT}
            stroke="var(--color-ink-faint)"
            strokeWidth={1}
          />
        </g>
      </svg>

      {/* The interactive layer, and the chart's only accessible entry point
          — a plain HTML control, not an SVG descendant, so it can never end
          up nested inside the (aria-hidden) graphic above. Percentages
          align it with the plot area; see the PLOT_LEFT_PCT/PLOT_RIGHT_PCT
          comment above. A pointer maps its x position to the nearest
          bucket; left/right arrows do the same from the keyboard, which is
          the only way these numbers are reachable without a pointer.
          role="slider" carries an automatically announced aria-valuetext,
          so a value change while focused is read out without a separate
          live region. */}
      <div
        ref={plotRef}
        data-plot
        tabIndex={0}
        role="slider"
        aria-label={`${granularity === "hour" ? "Hourly" : granularity === "day" ? "Daily" : "Weekly"} clicks and uniques`}
        aria-valuemin={0}
        aria-valuemax={buckets.length - 1}
        aria-valuenow={safeIndex}
        aria-valuetext={activeValueText}
        className="absolute cursor-crosshair"
        style={{
          left: `${PLOT_LEFT_PCT}%`,
          right: `${PLOT_RIGHT_PCT}%`,
          top: MARGIN.top,
          height: PLOT_HEIGHT,
        }}
        onPointerMove={onPointerMove}
        onKeyDown={onKeyDown}
      />

      {/* Visible tooltip mirroring the slider's aria-valuetext, for sighted
          pointer and keyboard users. It carries no ARIA role of its own and
          is hidden from assistive technology: the ARIA APG slider pattern
          has AT announce aria-valuetext automatically when it changes on a
          focused slider, so a second live region echoing the same text
          would double-announce every arrow press. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute top-2 right-2 rounded border border-rule bg-surface-raised px-2 py-1 text-xs tabular text-ink-muted"
      >
        {activeValueText}
      </div>
    </div>
  );
}
