import { ArrowDownRight, ArrowRight, ArrowUpRight } from "lucide-react";
import { formatCount, formatDelta } from "../../lib/format";
import { Sparkline } from "./Sparkline";

export function StatTile({
  label,
  value,
  previous,
  spark,
  hint,
}: {
  label: string;
  value: number;
  previous?: number;
  spark?: number[];
  hint?: string;
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
  const tone =
    delta?.direction === "up"
      ? "text-good"
      : delta?.direction === "down"
        ? "text-critical"
        : "text-ink-muted";

  return (
    <div className="rounded-lg border border-rule bg-surface-raised p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm text-ink-muted">{label}</p>
        {spark ? <Sparkline values={spark} label={`${label} trend`} /> : null}
      </div>

      <output className="mt-2 block font-display text-4xl leading-none tabular">
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
          <span className="text-ink-faint">vs previous period</span>
        </p>
      ) : null}

      {hint ? <p className="mt-1 text-xs text-ink-faint">{hint}</p> : null}
    </div>
  );
}
