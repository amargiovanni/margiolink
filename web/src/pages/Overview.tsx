import { useMemo, useState } from "react";
import { ChartFrame } from "../components/charts/ChartFrame";
import { Heatmap } from "../components/charts/Heatmap";
import { RankedBars } from "../components/charts/RankedBars";
import { StatTile } from "../components/charts/StatTile";
import { TimeSeries } from "../components/charts/TimeSeries";
import { WorldMap } from "../components/charts/WorldMap";
import { PeriodPicker } from "../components/PeriodPicker";
import { useDimension, useSummary, useTimeseries } from "../lib/queries";
import { granularityFor, type PeriodId, rangeFor } from "../lib/ranges";

const UNIQUES_HINT =
  "A visitor returning on several days is counted once per day — the privacy design rotates their code at midnight.";

function toTable(
  columnLabel: string,
  slices: { value: string; clicks: number; uniques: number }[],
) {
  return {
    columns: [columnLabel, "Clicks", "Uniques"],
    rows: slices.map((slice) => [slice.value, slice.clicks, slice.uniques]),
  };
}

/** One `ChartFrame` + `RankedBars` panel for a single dimension — same shape
 *  as `LinkDetail`'s `DimensionPanel`, kept local rather than shared since
 *  this page has no optional/withFlags variants to justify the extra prop
 *  surface a shared component would need. */
function DimensionPanel({
  title,
  query,
}: {
  title: string;
  query: ReturnType<typeof useDimension>;
}) {
  return (
    <ChartFrame title={title} table={toTable(title, query.data?.slices ?? [])}>
      {query.isError ? (
        <p role="alert" className="py-6 text-center text-sm text-critical">
          Could not load this breakdown.
        </p>
      ) : query.isPending ? (
        <p className="py-6 text-center text-sm text-ink-muted">Loading…</p>
      ) : (
        <RankedBars slices={query.data.slices} label={title} />
      )}
    </ChartFrame>
  );
}

/** Bot share as a fraction of *every* recorded hit, `bots / (clicks +
 *  bots)` — `summary.clicks` already excludes bots (`SUM(CASE WHEN is_bot =
 *  0 ...)`), so dividing by `clicks` alone would use the wrong denominator
 *  and could read over 100%. `--color-warning` and the word "high" appear
 *  together, never colour alone, once the share passes 50% — "more than
 *  half of all recorded traffic was automated". Built by hand rather than
 *  through `StatTile`: that component formats its number with `formatCount`
 *  and has no way to append "%" or to switch on a threshold, and this page
 *  is not the place to grow it a prop surface for one bespoke tile. */
function BotShareTile({
  bots,
  clicks,
  previousBots,
  previousClicks,
}: {
  bots: number;
  clicks: number;
  previousBots: number;
  previousClicks: number;
}) {
  const total = clicks + bots;
  const share = total === 0 ? 0 : Math.round((bots / total) * 100);
  const previousTotal = previousClicks + previousBots;
  const previousShare = previousTotal === 0 ? 0 : Math.round((previousBots / previousTotal) * 100);
  const high = share > 50;

  return (
    <div className="rounded-lg border border-rule bg-surface-raised p-4">
      <p className="text-sm text-ink-muted">Bot share</p>
      <output className="mt-2 flex items-baseline gap-2 font-display text-4xl leading-none tabular">
        <span className={high ? "text-warning" : undefined}>{share}%</span>
        {high ? <span className="text-sm font-sans text-warning">high</span> : null}
      </output>
      <p className="mt-2 text-sm text-ink-faint">vs {previousShare}% previous period</p>
      <p className="mt-1 text-xs text-ink-faint">
        {bots} bot hits of {total} total.
      </p>
    </div>
  );
}

/** The overview page — spec §6.1's landing screen: the period picker, the
 *  four-tile KPI row, the time series, then a two-column grid of dimension
 *  breakdowns, then the full-width heatmap.
 *
 * Only clicks and uniques carry a `spark`: `useSummary` gives every tile its
 * delta, but the only per-bucket source is `useTimeseries`, whose `bucket,
 * clicks, uniques` shape and `is_bot = 0` query make a bot series impossible
 * by construction and carry no per-bucket country count at all. Countries
 * reached and bot share pass no `spark` rather than a fabricated two-point
 * line drawn from `current`/`previous` — see the task brief. */
export default function Overview() {
  const [periodId, setPeriodId] = useState<PeriodId>("7d");

  const { from, to } = rangeFor(periodId);
  const range = useMemo(() => ({ from, to }), [from, to]);
  const granularity = granularityFor(from, to);

  const summaryQuery = useSummary(range);
  const timeseriesQuery = useTimeseries(range, granularity);
  const countryQuery = useDimension(range, "country");
  const deviceQuery = useDimension(range, "device");
  const channelQuery = useDimension(range, "referrer_type");
  const hourlyQuery = useDimension(range, "dow_hour", 100);

  const buckets = timeseriesQuery.data?.buckets ?? [];
  const clickSpark = timeseriesQuery.isSuccess ? buckets.map((b) => b.clicks) : undefined;
  const uniqueSpark = timeseriesQuery.isSuccess ? buckets.map((b) => b.uniques) : undefined;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="font-display text-3xl text-ink">Overview</h1>
        <PeriodPicker value={periodId} onChange={setPeriodId} />
      </header>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {summaryQuery.isError ? (
          <p role="alert" className="text-sm text-critical sm:col-span-4">
            Could not load summary stats.
          </p>
        ) : summaryQuery.isPending ? (
          <p className="text-sm text-ink-muted sm:col-span-4">Loading summary…</p>
        ) : (
          <>
            <StatTile
              label="Clicks"
              value={summaryQuery.data.current.clicks}
              previous={summaryQuery.data.previous.clicks}
              spark={clickSpark}
            />
            <StatTile
              label="Unique visitors"
              value={summaryQuery.data.current.uniques}
              previous={summaryQuery.data.previous.uniques}
              spark={uniqueSpark}
              hint={UNIQUES_HINT}
            />
            <StatTile
              label="Countries reached"
              value={summaryQuery.data.current.countries}
              previous={summaryQuery.data.previous.countries}
            />
            <BotShareTile
              bots={summaryQuery.data.current.bots}
              clicks={summaryQuery.data.current.clicks}
              previousBots={summaryQuery.data.previous.bots}
              previousClicks={summaryQuery.data.previous.clicks}
            />
          </>
        )}
      </div>

      <ChartFrame
        title="Clicks over time"
        series={[
          { label: "Clicks", color: "var(--color-series-1)" },
          { label: "Uniques", color: "var(--color-series-2)" },
        ]}
        table={{
          columns: ["Bucket", "Clicks", "Uniques"],
          rows: buckets.map((bucket) => [bucket.bucket, bucket.clicks, bucket.uniques]),
        }}
      >
        {timeseriesQuery.isError ? (
          <p role="alert" className="py-6 text-center text-sm text-critical">
            Could not load the time series.
          </p>
        ) : timeseriesQuery.isPending ? (
          <p className="py-6 text-center text-sm text-ink-muted">Loading…</p>
        ) : (
          <TimeSeries buckets={buckets} granularity={granularity} />
        )}
      </ChartFrame>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartFrame
          title="Clicks by country"
          table={toTable("Country", countryQuery.data?.slices ?? [])}
        >
          {countryQuery.isError ? (
            <p role="alert" className="py-6 text-center text-sm text-critical">
              Could not load the map.
            </p>
          ) : countryQuery.isPending ? (
            <p className="py-6 text-center text-sm text-ink-muted">Loading…</p>
          ) : (
            <WorldMap slices={countryQuery.data.slices} />
          )}
        </ChartFrame>

        <DimensionPanel title="Devices" query={deviceQuery} />
        <DimensionPanel title="Channels" query={channelQuery} />
      </div>

      <ChartFrame
        title="Activity by hour"
        description="Clicks by day of week and hour."
        table={toTable("Hour", hourlyQuery.data?.slices ?? [])}
      >
        {hourlyQuery.isError ? (
          <p role="alert" className="py-6 text-center text-sm text-critical">
            Could not load the heatmap.
          </p>
        ) : hourlyQuery.isPending ? (
          <p className="py-6 text-center text-sm text-ink-muted">Loading…</p>
        ) : (
          <Heatmap slices={hourlyQuery.data.slices} />
        )}
      </ChartFrame>
    </div>
  );
}
