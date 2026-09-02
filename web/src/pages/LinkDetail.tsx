import { useMemo, useState } from "react";
import { useParams } from "react-router";
import { ChartFrame } from "../components/charts/ChartFrame";
import { Heatmap } from "../components/charts/Heatmap";
import { LiveFeed } from "../components/charts/LiveFeed";
import { RankedBars } from "../components/charts/RankedBars";
import { StatTile } from "../components/charts/StatTile";
import { TimeSeries } from "../components/charts/TimeSeries";
import { CopyButton } from "../components/links/CopyButton";
import { QrPanel } from "../components/links/QrPanel";
import { ApiError } from "../lib/api";
import { useDimension, useLink, useSummary, useTimeseries } from "../lib/queries";
import { granularityFor, PERIODS, type PeriodId, rangeFor } from "../lib/ranges";

type Slice = { value: string; clicks: number; uniques: number };
type DimensionQuery = ReturnType<typeof useDimension>;

/** Converts an ISO-3166-1 alpha-2 code into its regional-indicator flag
 *  glyph (e.g. "IT" -> "🇮🇹"). Anything that is not exactly two letters —
 *  including the API's "unknown" fallback for a missing value — yields no
 *  glyph at all rather than a nonsense one. */
function flagEmoji(code: string): string {
  if (!/^[A-Za-z]{2}$/.test(code)) return "";
  const points = [...code.toUpperCase()].map((letter) => 0x1f1e6 + (letter.charCodeAt(0) - 65));
  return String.fromCodePoint(...points);
}

function toTable(columnLabel: string, slices: Slice[]) {
  return {
    columns: [columnLabel, "Clicks", "Uniques"],
    rows: slices.map((slice) => [slice.value, slice.clicks, slice.uniques]),
  };
}

/** One `ChartFrame` + `RankedBars` panel for a single dimension.
 *
 * `optional` panels (the three UTM ones) render nothing at all until the
 * query has *successfully* resolved with at least one slice — an empty
 * campaign panel on every link for a reader who has never used UTM tags is
 * noise, and showing it during loading or on an error would say "there is
 * data here" before that is actually known to be true. */
function DimensionPanel({
  title,
  description,
  query,
  withFlags,
  optional,
}: {
  title: string;
  description?: string;
  query: DimensionQuery;
  withFlags?: boolean;
  optional?: boolean;
}) {
  if (optional && !(query.isSuccess && query.data.slices.length > 0)) return null;

  const rawSlices = query.data?.slices ?? [];
  const slices = withFlags
    ? rawSlices.map((slice) => ({
        ...slice,
        value: [flagEmoji(slice.value), slice.value].filter(Boolean).join(" "),
      }))
    : rawSlices;

  return (
    <ChartFrame title={title} description={description} table={toTable(title, slices)}>
      {query.isError ? (
        <p role="alert" className="py-6 text-center text-sm text-critical">
          Could not load this breakdown.
        </p>
      ) : query.isPending ? (
        <p className="py-6 text-center text-sm text-ink-muted">Loading…</p>
      ) : (
        <RankedBars slices={slices} label={title} />
      )}
    </ChartFrame>
  );
}

/** The link detail page — spec §6.1's "ricchissima" screen: every dimension
 *  the API exposes as a ranked list, plus the hour-by-weekday heatmap, the
 *  live feed, the QR code and the outcome breakdown.
 *
 * Every stats query below carries `linkId` — see Step 0 in the task brief.
 * Without it, this page would show every link's numbers under one link's
 * name, which is a false statement about the product's own data rather than
 * a missing feature. */
export default function LinkDetail() {
  const { id } = useParams<{ id: string }>();
  const linkId = Number(id);
  const [periodId, setPeriodId] = useState<PeriodId>("7d");

  const linkQuery = useLink(linkId);

  const { from, to } = rangeFor(periodId);
  const range = useMemo(() => ({ from, to, linkId }), [from, to, linkId]);
  const granularity = granularityFor(from, to);

  const summaryQuery = useSummary(range);
  const timeseriesQuery = useTimeseries(range, granularity);

  // dow_hour has at most 168 possible cells (7 days × 24 hours); the
  // dimension endpoint caps `limit` at 100, so a very active link can still
  // lose its least-frequent hours off a long window. That cap predates this
  // page and applies to every dimension, not just this one — raising it is
  // outside this task's scope, so the heatmap simply asks for as many rows
  // as the endpoint will give it.
  const hourlyQuery = useDimension(range, "dow_hour", 100);

  const countryQuery = useDimension(range, "country");
  const cityQuery = useDimension(range, "city");
  const deviceQuery = useDimension(range, "device");
  const osQuery = useDimension(range, "os");
  const browserQuery = useDimension(range, "browser");
  const languageQuery = useDimension(range, "language");
  const networkQuery = useDimension(range, "asn_org");
  const channelQuery = useDimension(range, "referrer_type");
  const referrerQuery = useDimension(range, "referrer_host");
  const campaignQuery = useDimension(range, "utm_campaign");
  const sourceUtmQuery = useDimension(range, "utm_source");
  const mediumQuery = useDimension(range, "utm_medium");
  const scanQuery = useDimension(range, "source");
  const outcomeQuery = useDimension(range, "outcome");

  if (linkQuery.isError) {
    const notFound = linkQuery.error instanceof ApiError && linkQuery.error.status === 404;
    return (
      <div className="flex flex-col items-center gap-2 py-16 text-center">
        <p className="font-display text-xl text-ink">
          {notFound ? "That link does not exist." : "Could not load this link."}
        </p>
        {!notFound && <p className="text-sm text-ink-muted">Try again.</p>}
      </div>
    );
  }

  if (linkQuery.isPending) {
    return <p className="text-sm text-ink-muted">Loading link…</p>;
  }

  const { link } = linkQuery.data;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-3xl text-ink">{link.slug}</h1>
          <div className="flex items-center gap-1 text-sm text-ink-muted">
            <span>{link.shortUrl}</span>
            <CopyButton value={link.shortUrl} label={`Copy short link for ${link.slug}`} />
          </div>
        </div>

        <fieldset aria-label="Period" className="m-0 flex flex-wrap gap-1 border-0 p-0">
          {PERIODS.map((period) => (
            <button
              key={period.id}
              type="button"
              aria-pressed={period.id === periodId}
              onClick={() => setPeriodId(period.id)}
              className={`rounded border px-3 py-1.5 text-sm transition-colors ${
                period.id === periodId
                  ? "border-accent bg-accent text-accent-ink"
                  : "border-rule text-ink-muted hover:text-ink"
              }`}
            >
              {period.label}
            </button>
          ))}
        </fieldset>
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
            />
            <StatTile
              label="Unique visitors"
              value={summaryQuery.data.current.uniques}
              previous={summaryQuery.data.previous.uniques}
            />
            <StatTile
              label="Bot traffic"
              value={summaryQuery.data.current.bots}
              previous={summaryQuery.data.previous.bots}
            />
            <StatTile
              label="Countries reached"
              value={summaryQuery.data.current.countries}
              previous={summaryQuery.data.previous.countries}
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
          rows: (timeseriesQuery.data?.buckets ?? []).map((bucket) => [
            bucket.bucket,
            bucket.clicks,
            bucket.uniques,
          ]),
        }}
      >
        {timeseriesQuery.isError ? (
          <p role="alert" className="py-6 text-center text-sm text-critical">
            Could not load the time series.
          </p>
        ) : timeseriesQuery.isPending ? (
          <p className="py-6 text-center text-sm text-ink-muted">Loading…</p>
        ) : (
          <TimeSeries buckets={timeseriesQuery.data.buckets} granularity={granularity} />
        )}
      </ChartFrame>

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

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <DimensionPanel title="Countries" query={countryQuery} withFlags />
        <DimensionPanel title="Cities" query={cityQuery} />
        <DimensionPanel title="Devices" query={deviceQuery} />
        <DimensionPanel title="Operating systems" query={osQuery} />
        <DimensionPanel title="Browsers" query={browserQuery} />
        <DimensionPanel title="Languages" query={languageQuery} />
        <DimensionPanel title="Networks" query={networkQuery} />
        <DimensionPanel title="Channels" query={channelQuery} />
        <DimensionPanel title="Referrers" query={referrerQuery} />
        <DimensionPanel title="Campaigns" query={campaignQuery} optional />
        <DimensionPanel title="Sources" query={sourceUtmQuery} optional />
        <DimensionPanel title="Mediums" query={mediumQuery} optional />
        <DimensionPanel title="Scans vs clicks" query={scanQuery} />
        <DimensionPanel
          title="Outcomes"
          description="How many hit an expired link or failed a password."
          query={outcomeQuery}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section
          aria-labelledby="live-feed-heading"
          className="rounded-lg border border-rule bg-surface-raised p-4"
        >
          <h3 id="live-feed-heading" className="mb-4 font-display text-lg leading-tight">
            Live feed
          </h3>
          <LiveFeed linkId={linkId} />
        </section>

        <section
          aria-labelledby="qr-heading"
          className="rounded-lg border border-rule bg-surface-raised p-4"
        >
          <h3 id="qr-heading" className="mb-4 font-display text-lg leading-tight">
            QR code
          </h3>
          <QrPanel linkId={linkId} slug={link.slug} />
        </section>
      </div>
    </div>
  );
}
