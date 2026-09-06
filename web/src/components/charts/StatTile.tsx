import { ArrowDownRight, ArrowRight, ArrowUpRight } from "lucide-react";
import { formatCount, formatDelta } from "../../lib/format";
import { Sparkline } from "./Sparkline";

/** No table view (Task 14, spec §6.4's rule): the number itself is already
 *  plain accessible text (the `<output>` below), and the one piece of data a
 *  table could add anything to is the optional `spark` trend — but every
 *  caller that passes one (`Overview`'s Clicks and Unique visitors tiles)
 *  derives it from the exact same buckets already tabulated in that page's
 *  "Clicks over time" `ChartFrame`, a few rows down on the same page. A
 *  table here would restate data the reader already has a table for.
 *  `LinkDetail`'s stat tiles pass no `spark` at all, so for them the
 *  question doesn't arise. If a future tile ever gets a `spark` with no
 *  such twin elsewhere on the page, that tile is the one that needs the
 *  table, not every `StatTile`. */
export function StatTile({
  label,
  value,
  previous,
  spark,
  hint,
  featured = false,
}: {
  label: string;
  value: number;
  previous?: number;
  spark?: number[];
  hint?: string;
  featured?: boolean;
}) {
  const delta = previous === undefined ? null : formatDelta(value, previous);
  const Icon =
    delta?.direction === "up"
      ? ArrowUpRight
      : delta?.direction === "down"
        ? ArrowDownRight
        : ArrowRight;
  const directionWord =
    delta?.direction === "up" ? "increase" : delta?.direction === "down" ? "decrease" : "no change";
  const tone = featured
    ? "text-rail-muted"
    : delta?.direction === "up"
      ? "text-good"
      : delta?.direction === "down"
        ? "text-critical"
        : "text-ink-muted";

  return (
    <div
      data-featured={featured || undefined}
      className={`rounded-lg border p-5 shadow-sm ${
        featured
          ? "border-white/10 bg-rail text-rail-ink shadow-xl"
          : "border-rule bg-surface-raised text-ink"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <p
          className={`text-xs font-semibold tracking-wide ${featured ? "text-rail-muted" : "text-ink-muted"}`}
        >
          {label}
        </p>
        {spark ? <Sparkline values={spark} label={`${label} trend`} /> : null}
      </div>

      <output className="mt-4 block font-display text-4xl leading-none font-semibold tracking-tight tabular sm:text-5xl">
        {formatCount(value)}
      </output>

      {delta ? (
        <p className={`mt-2 flex items-center gap-1 text-sm ${tone}`}>
          <Icon aria-hidden="true" className="size-4" />
          {/* role="note" gives this span a naming-capable role: the default
              "generic" role for a bare <span> does not support aria-label (an
              author-supplied name on it has no effect per the ARIA spec), so
              without an explicit role the accessible name below would be
              silently dropped. A single element carries "increase +23%" (word
              *and* number together) so the direction supplements the value for
              assistive tech instead of replacing it — a separate visually-hidden
              prefix beside an aria-label on the number would either duplicate
              the word or, worse, hide the percentage from screen readers
              entirely, since an element's own text is not read once aria-label
              overrides its accessible name. */}
          <span role="note" aria-label={`${directionWord} ${delta.text}`}>
            {delta.text}
          </span>
          <span className={featured ? "text-rail-muted" : "text-ink-faint"}>
            vs previous period
          </span>
        </p>
      ) : null}

      {hint ? (
        <p
          className={`mt-2 text-xs leading-relaxed ${featured ? "text-rail-muted" : "text-ink-faint"}`}
        >
          {hint}
        </p>
      ) : null}
    </div>
  );
}
