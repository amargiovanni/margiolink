import { useMemo } from "react";
import { useParams } from "react-router";
import { ChartFrame, chartStatus } from "../components/charts/ChartFrame";
import { DeferredPanel } from "../components/charts/DeferredPanel";
import { HEATMAP_CELLS, Heatmap } from "../components/charts/Heatmap";
import { LiveFeed } from "../components/charts/LiveFeed";
import { RankedBars } from "../components/charts/RankedBars";
import { StatTile } from "../components/charts/StatTile";
import { TimeSeries } from "../components/charts/TimeSeries";
import { InsightNav } from "../components/layout/InsightNav";
import { PageHeader } from "../components/layout/PageHeader";
import { SectionHeading } from "../components/layout/SectionHeading";
import { CopyButton } from "../components/links/CopyButton";
import { QrPanel } from "../components/links/QrPanel";
import { PeriodPicker } from "../components/PeriodPicker";
import { Panel } from "../components/ui/Panel";
import { ApiError } from "../lib/api";
import { type Range, useDimension, useLink, useSummary, useTimeseries } from "../lib/queries";
import { granularityFor, rangeFor } from "../lib/ranges";
import { usePeriodSelection } from "../lib/usePeriodSelection";

type Slice = { value: string; clicks: number; uniques: number };

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
function LoadedDimensionPanel({
  title,
  description,
  range,
  name,
  withFlags,
  optional,
}: {
  title: string;
  description?: string;
  range: Range;
  name: string;
  withFlags?: boolean;
  optional?: boolean;
}) {
  const query = useDimension(range, name);
  if (optional && !(query.isSuccess && query.data.slices.length > 0)) return null;

  const rawSlices = query.data?.slices ?? [];
  const slices = withFlags
    ? rawSlices.map((slice) => ({
        ...slice,
        value: [flagEmoji(slice.value), slice.value].filter(Boolean).join(" "),
      }))
    : rawSlices;

  return (
    <ChartFrame
      title={title}
      description={description}
      headingLevel={3}
      table={toTable(title, slices)}
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
        <RankedBars slices={slices} label={title} limit={7} />
      )}
    </ChartFrame>
  );
}

function DimensionPanel(props: Parameters<typeof LoadedDimensionPanel>[0]) {
  return (
    <DeferredPanel title={props.title} headingLevel={3}>
      <LoadedDimensionPanel {...props} />
    </DeferredPanel>
  );
}

function HourlyPanel({ range }: { range: Range }) {
  const hourlyQuery = useDimension(range, "dow_hour", HEATMAP_CELLS);
  return (
    <ChartFrame
      title="Activity by hour"
      headingLevel={3}
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
  const { periodId, setPeriodId, periods, periodNote, metaQuery } = usePeriodSelection("7d");

  const linkQuery = useLink(linkId);

  const { from, to } = rangeFor(periodId);
  const range = useMemo(() => ({ from, to, linkId }), [from, to, linkId]);
  const granularity = granularityFor(from, to);

  const summaryQuery = useSummary(range);
  const timeseriesQuery = useTimeseries(range, granularity);

  // A non-finite id (an unparseable route param, e.g. `/links/abc`) leaves
  // `useLink` permanently disabled — it never settles into `isError` or
  // `isSuccess` on its own, so without this check the page would sit on
  // "Loading link…" forever. That is the worst failure shape available:
  // indistinguishable from merely slow, with nothing for the reader to act
  // on. Treated identically to a 404 rather than as a separate state,
  // because from the reader's point of view it is the same fact: there is
  // no such link.
  if (!Number.isFinite(linkId) || linkQuery.isError) {
    const notFound =
      !Number.isFinite(linkId) ||
      (linkQuery.error instanceof ApiError && linkQuery.error.status === 404);
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

  // Task 14, Step 0 item 5: deliberately no edit/deactivate/delete control
  // on this page. Every one of those already lives in the links list's row
  // menu (`LinkRow`), which is the one tested path for each — Delete in
  // particular goes through `ConfirmDialog`. Putting a second copy here
  // would double the surface a reader has to get past that confirmation on,
  // for a "go back to change it" round trip that costs one navigation on a
  // dashboard, not a reason to duplicate a destructive control.
  return (
    <div className="flex flex-col gap-10">
      <PageHeader
        eyebrow="Link intelligence"
        title={link.slug}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <span>{link.shortUrl}</span>
            <CopyButton value={link.shortUrl} label={`Copy short link for ${link.slug}`} />
          </span>
        }
        actions={
          <div className="flex max-w-xl flex-col items-end gap-1">
            {metaQuery.isError ? (
              <p role="alert" className="text-xs text-critical">
                Could not load the retention window. Showing the last 7 days only.
              </p>
            ) : metaQuery.isPending ? (
              <p className="text-xs text-ink-muted">Loading period options…</p>
            ) : (
              <>
                <PeriodPicker value={periodId} onChange={setPeriodId} periods={periods} />
                {periodNote && <p className="text-right text-xs text-ink-faint">{periodNote}</p>}
              </>
            )}
          </div>
        }
      />

      <InsightNav
        items={[
          { id: "performance", label: "Performance" },
          { id: "audience", label: "Audience" },
          { id: "acquisition", label: "Acquisition" },
          { id: "delivery", label: "Delivery" },
        ]}
      />

      <section aria-labelledby="performance-heading" className="flex flex-col gap-5">
        <SectionHeading
          id="performance"
          eyebrow="What happened"
          title="Performance"
          description="Volume, reach and the rhythm of visits across the selected period."
        />
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
                featured
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
          headingLevel={3}
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
            <TimeSeries buckets={timeseriesQuery.data.buckets} granularity={granularity} />
          )}
        </ChartFrame>

        <DeferredPanel title="Activity by hour" headingLevel={3}>
          <HourlyPanel range={range} />
        </DeferredPanel>
      </section>

      <section aria-labelledby="audience-heading" className="flex flex-col gap-5">
        <SectionHeading
          id="audience"
          eyebrow="Who arrived"
          title="Audience"
          description="Geography, devices and software behind the traffic."
        />
        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
          <DimensionPanel title="Countries" range={range} name="country" withFlags />
          <DimensionPanel title="Cities" range={range} name="city" />
          <DimensionPanel title="Devices" range={range} name="device" />
          <DimensionPanel title="Operating systems" range={range} name="os" />
          <DimensionPanel title="Browsers" range={range} name="browser" />
          <DimensionPanel title="Languages" range={range} name="language" />
        </div>
      </section>

      <section aria-labelledby="acquisition-heading" className="flex flex-col gap-5">
        <SectionHeading
          id="acquisition"
          eyebrow="How they found it"
          title="Acquisition"
          description="Channels, referrers and campaign attribution in one focused view."
        />
        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
          <DimensionPanel title="Channels" range={range} name="referrer_type" />
          <DimensionPanel title="Referrers" range={range} name="referrer_host" />
          <DimensionPanel title="Campaigns" range={range} name="utm_campaign" optional />
          <DimensionPanel title="Sources" range={range} name="utm_source" optional />
          <DimensionPanel title="Mediums" range={range} name="utm_medium" optional />
        </div>
      </section>

      <section aria-labelledby="delivery-heading" className="flex flex-col gap-5">
        <SectionHeading
          id="delivery"
          eyebrow="What resolved"
          title="Delivery"
          description="Networks, scan sources, outcomes and the tools attached to this short link."
        />
        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-3">
          <DimensionPanel title="Networks" range={range} name="asn_org" />
          <DimensionPanel title="Scans vs clicks" range={range} name="source" />
          <DimensionPanel
            title="Outcomes"
            description="How many hit an expired link or failed a password."
            range={range}
            name="outcome"
          />
        </div>

        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
          <DeferredPanel title="Live feed" headingLevel={3}>
            <Panel as="section" aria-labelledby="live-feed-heading" className="p-5 sm:p-6">
              <h3
                id="live-feed-heading"
                className="mb-4 font-display text-xl font-semibold leading-tight tracking-tight"
              >
                Live feed
              </h3>
              <LiveFeed linkId={linkId} />
            </Panel>
          </DeferredPanel>

          <Panel as="section" aria-labelledby="qr-heading" className="p-5 sm:p-6">
            <h3
              id="qr-heading"
              className="mb-4 font-display text-xl font-semibold leading-tight tracking-tight"
            >
              QR code
            </h3>
            <QrPanel linkId={linkId} slug={link.slug} shortUrl={link.shortUrl} />
          </Panel>
        </div>
      </section>
    </div>
  );
}
