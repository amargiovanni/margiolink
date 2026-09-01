import { type ReactNode, useId, useState } from "react";
import { type TableData, TableView } from "./TableView";

export interface SeriesLabel {
  label: string;
  color: string;
}

export function ChartFrame({
  title,
  description,
  series = [],
  table,
  children,
}: {
  title: string;
  description?: string;
  series?: SeriesLabel[];
  table: TableData;
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
          <h3 id={headingId} className="font-display text-lg leading-tight">
            {title}
          </h3>
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

      {view === "chart" ? children : <TableView {...table} caption={title} />}
    </section>
  );
}
