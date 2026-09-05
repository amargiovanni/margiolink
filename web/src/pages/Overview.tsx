import { useMemo } from "react";
import { Link as RouterLink } from "react-router";
import { ChartFrame, chartStatus } from "../components/charts/ChartFrame";
import { DeferredPanel } from "../components/charts/DeferredPanel";
import { HEATMAP_CELLS, Heatmap } from "../components/charts/Heatmap";
import { RankedBars } from "../components/charts/RankedBars";
import { StatTile } from "../components/charts/StatTile";
import { TimeSeries } from "../components/charts/TimeSeries";
import { WorldMap } from "../components/charts/WorldMap";
import { PageHeader } from "../components/layout/PageHeader";
import { PeriodPicker } from "../components/PeriodPicker";
import { formatCount } from "../lib/format";
import { type Range, useDimension, useSummary, useTimeseries, useTopLinks } from "../lib/queries";
import { granularityFor, rangeFor } from "../lib/ranges";
import { usePeriodSelection } from "../lib/usePeriodSelection";

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
function DimensionPanel({ title, range, name }: { title: string; range: Range; name: string }) {
  const query = useDimension(range, name);
  return (
    <ChartFrame
      title={title}
      table={toTable(title, query.data?.slices ?? [])}
      status={chartStatus(query)}
      errorMessage="Could not load this breakdown."
    >
      {query.isError ? (
        <p role="alert" className="py-6 text-center text-sm text-critical">
          Could not load this breakdown.
        </p>
      ) : query.isPending ? (
        <p className="py-6 text-center text-sm text-ink-muted">Loading…</p>
      ) : (
        <RankedBars slices={query.data.slices} label={title} limit={6} />
      )}
    </ChartFrame>
  );
}

/** The overview page's headline panel: links ranked by click count within
 *  the selected period, each row a real link to its detail page (the
 *  ranking excludes soft-deleted links server-side, so every row here
 *  always has one). Built by hand rather than through `RankedBars`: that
 *  component's rows are plain text, with no way to make the label a link,
 *  and this panel's whole point is to route a reader straight to the link
 *  the bar is about. */
function TopLinksPanel({ range }: { range: Range }) {
  const query = useTopLinks(range);
  const links = query.data?.links ?? [];
  const max = Math.max(...links.map((l) => l.clicks), 1);

  return (
    <ChartFrame
      title="Top links"
      table={{
        columns: ["Link", "Clicks", "Uniques"],
        rows: links.map((l) => [l.title || l.slug, l.clicks, l.uniques]),
      }}
      status={chartStatus(query)}
      errorMessage="Could not load top links."
    >
      {query.isError ? (
        <p role="alert" className="py-6 text-center text-sm text-critical">
          Could not load top links.
        </p>
      ) : query.isPending ? (
        <p className="py-6 text-center text-sm text-ink-muted">Loading…</p>
      ) : links.length === 0 ? (
        <p className="py-6 text-center text-sm text-ink-faint">No clicks in this period.</p>
      ) : (
        <ul aria-label="Top links" className="flex flex-col gap-2">
          {links.map((link) => (
            <li key={link.id} className="grid grid-cols-[1fr_auto] items-center gap-3">
              <div className="min-w-0">
                <div className="flex items-baseline justify-between gap-2">
                  <RouterLink
                    to={`/links/${link.id}`}
                    className="truncate text-sm text-ink hover:text-accent hover:underline"
                  >
                    {link.title || link.slug}
                  </RouterLink>
                  {/* Direct label: never make a reader estimate a bar's length. */}
                  <span className="shrink-0 text-sm tabular text-ink-muted">
                    {formatCount(link.clicks)}
                  </span>
                </div>
                {/* 4px rounded ends per spec §6.4 — "rounded", not "rounded-full". */}
                <div className="mt-1 h-1.5 rounded bg-surface-sunken">
                  <div
                    data-bar
                    className="h-full rounded"
                    style={{
                      width: `${(link.clicks / max) * 100}%`,
                      background: "var(--color-series-1)",
                    }}
                    title={`${link.title || link.slug}: ${link.clicks} clicks, ${link.uniques} unique`}
                  />
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </ChartFrame>
  );
}

function CountryPanel({ range }: { range: Range }) {
  const countryQuery = useDimension(range, "country");
  return (
    <ChartFrame
      title="Clicks by country"
      table={toTable("Country", countryQuery.data?.slices ?? [])}
      status={chartStatus(countryQuery)}
      errorMessage="Could not load the map."
    >
      {countryQuery.isError ? (
        <p role="alert" className="py-6 text-center text-sm text-critical">
          Could not load the map.
        </p>
      ) : countryQuery.isPending ? (
        <p className="py-6 text-center text-sm text-ink-muted">Loading…</p>
      ) : (
        <WorldMap slices={countryQuery.data.slices} listLimit={6} />
      )}
    </ChartFrame>
  );
}

function HourlyPanel({ range }: { range: Range }) {
  const hourlyQuery = useDimension(range, "dow_hour", HEATMAP_CELLS);
  return (
    <ChartFrame
      title="Activity by hour"
      description="Clicks by day of week and hour."
      table={toTable("Hour", hourlyQuery.data?.slices ?? [])}
      status={chartStatus(hourlyQuery)}
      errorMessage="Could not load the heatmap."
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
    <div className="rounded-lg border border-rule bg-surface-raised p-5 shadow-sm">
      <p className="text-xs font-semibold tracking-wide text-ink-muted">Bot share</p>
      <output className="mt-4 flex items-baseline gap-2 font-display text-4xl leading-none font-semibold tracking-tight tabular sm:text-5xl">
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
  const { periodId, setPeriodId, periods, periodNote, metaQuery } = usePeriodSelection("7d");

  const { from, to } = rangeFor(periodId);
  const range = useMemo(() => ({ from, to }), [from, to]);
  const granularity = granularityFor(from, to);

  const summaryQuery = useSummary(range);
  const timeseriesQuery = useTimeseries(range, granularity);

  const buckets = timeseriesQuery.data?.buckets ?? [];
  const clickSpark = timeseriesQuery.isSuccess ? buckets.map((b) => b.clicks) : undefined;
  const uniqueSpark = timeseriesQuery.isSuccess ? buckets.map((b) => b.uniques) : undefined;

  return (
    <div className="flex flex-col gap-8 lg:gap-10">
      <PageHeader
        eyebrow="Analytics workspace"
        title="Overview"
        description="See what changed and what deserves attention, then trace where your traffic came from."
        actions={
          <div className="flex max-w-full flex-col items-start gap-1 sm:items-end">
            {metaQuery.isError ? (
              <p role="alert" className="text-xs text-critical">
                Could not load the retention window. Showing the last 7 days only.
              </p>
            ) : metaQuery.isPending ? (
              <p className="text-xs text-ink-muted">Loading period options…</p>
            ) : (
              <>
                <PeriodPicker value={periodId} onChange={setPeriodId} periods={periods} />
                {periodNote && <p className="max-w-xl text-xs text-ink-faint">{periodNote}</p>}
              </>
            )}
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:gap-4">
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
              featured
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
        status={chartStatus(timeseriesQuery)}
        errorMessage="Could not load the time series."
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

      {/* `items-start`, not the grid's default `stretch`: these panels hold
          ranked lists of very different lengths — five top links beside
          twenty countries — and stretching the short one to match the tall
          one pads it with a few hundred pixels of nothing. A card is as tall
          as what is in it. */}
      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[0.82fr_1.18fr]">
        <DeferredPanel title="Top links">
          <TopLinksPanel range={range} />
        </DeferredPanel>

        <DeferredPanel title="Clicks by country">
          <CountryPanel range={range} />
        </DeferredPanel>
      </div>

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
        <DeferredPanel title="Devices">
          <DimensionPanel title="Devices" range={range} name="device" />
        </DeferredPanel>
        <DeferredPanel title="Channels">
          <DimensionPanel title="Channels" range={range} name="referrer_type" />
        </DeferredPanel>
      </div>

      <DeferredPanel title="Activity by hour">
        <HourlyPanel range={range} />
      </DeferredPanel>
    </div>
  );
}
