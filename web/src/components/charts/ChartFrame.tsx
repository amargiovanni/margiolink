import { type ReactNode, useId, useState } from "react";
import { type TableData, TableView } from "./TableView";

export interface SeriesLabel {
  label: string;
  color: string;
}

export type ChartQueryStatus = "pending" | "error" | "success";

/** Derives `ChartFrame`'s required `status` from a React Query result,
 *  so every call site computes it the same way rather than re-deriving
 *  `isError ? "error" : isPending ? "pending" : "success"` (or, worse,
 *  `undefined`) by hand each time — the one shape a ninth call site could
 *  get wrong is exactly the shape this exists to make impossible to skip. */
export function chartStatus(query: { isError: boolean; isPending: boolean }): ChartQueryStatus {
  return query.isError ? "error" : query.isPending ? "pending" : "success";
}

export function ChartFrame({
  title,
  description,
  series = [],
  table,
  status,
  errorMessage = "Could not load this data.",
  children,
}: {
  title: string;
  description?: string;
  series?: SeriesLabel[];
  table: TableData;
  /** The state of the query behind both panes — required, not optional:
   *  an earlier version defaulted this to "succeeded" when omitted, which
   *  meant a ninth call site could simply not pass it and silently
   *  reintroduce the defect this prop exists to close. Every caller now
   *  computes it with `chartStatus(query)` above.
   *
   *  `table` is always built at the call site as `query.data?.slices ?? []`
   *  or similar, so on a pending or failed query it already arrives here as
   *  `[]` — indistinguishable, by shape alone, from a period that
   *  genuinely had no data. Without `status`, the table pane would render
   *  that `[]` as a plain empty table: a false "no data" standing in for
   *  "no data *yet*" or "no data because this failed". `status` is what
   *  lets the table pane show the true state instead of guessing it from a
   *  shape that cannot tell the three apart — the chart pane's `children`
   *  already makes this distinction per call site; this is the same
   *  distinction, applied to the other pane, so absence and failure are
   *  never the same pixels twice. */
  status: ChartQueryStatus;
  /** Shown in both panes' failed state. Match the chart pane's own message
   *  (passed to `children` separately) so a reader sees one sentence for
   *  one failure, not two different ones depending which pane they're on. */
  errorMessage?: string;
  children: ReactNode;
}) {
  const [view, setView] = useState<"chart" | "table">("chart");
  const headingId = useId();

  return (
    <section
      aria-labelledby={headingId}
      className="rounded-lg border border-rule bg-surface-raised p-4"
    >
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          {/* h2, not h3: every page that uses ChartFrame (Overview,
              LinkDetail) puts its panels directly under the page's own h1
              with nothing between — Settings is the only page with real
              subsections, and its own headings are h2. An h3 here would
              skip a level on every page that has no h2 to land under. */}
          <h2 id={headingId} className="font-display text-lg leading-tight">
            {title}
          </h2>
          {description ? <p className="mt-1 text-sm text-ink-muted">{description}</p> : null}
        </div>

        <div className="flex items-center gap-3">
          {/* A legend is present for two or more series; one series is named by
              the title, so a legend box would only repeat it. */}
          {series.length >= 2 ? (
            <ul data-legend className="flex flex-wrap gap-3 text-sm text-ink-muted">
              {series.map((s) => (
                <li key={s.label} className="flex items-center gap-1.5">
                  <span
                    aria-hidden="true"
                    className="inline-block size-2.5 rounded-sm"
                    style={{ background: s.color }}
                  />
                  {s.label}
                </li>
              ))}
            </ul>
          ) : null}

          {/* The table view is the relief the light palette's contrast warning
              requires, and the accessible path for anyone who cannot use the
              visual encoding. It is never optional. */}
          <button
            type="button"
            onClick={() => setView(view === "chart" ? "table" : "chart")}
            aria-pressed={view === "table"}
            className="rounded border border-rule px-2 py-1 text-xs text-ink-muted hover:text-ink"
          >
            {view === "chart" ? "Table" : "Chart"}
          </button>
        </div>
      </header>

      {view === "chart" ? (
        children
      ) : status === "error" ? (
        <p role="alert" className="py-6 text-center text-sm text-critical">
          {errorMessage}
        </p>
      ) : status === "pending" ? (
        <p className="py-6 text-center text-sm text-ink-muted">Loading…</p>
      ) : (
        // status === "success"
        <TableView {...table} caption={title} />
      )}
    </section>
  );
}
