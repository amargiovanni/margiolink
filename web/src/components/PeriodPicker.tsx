import { PERIODS, type PeriodId } from "../lib/ranges";

/** A Radix-free radio group: native `<input type="radio">`s sharing one
 *  `name`, styled as a segmented control. Grouping same-`name` radios is
 *  what gives roving arrow-key navigation for free, straight from the
 *  browser, with no JavaScript keyboard handler of our own — the same
 *  reasoning `TimeSeries`' slider spells out for its own interaction, just
 *  handed to native semantics here instead of ARIA ones.
 *
 *  Each input is visually hidden (`peer sr-only`) rather than styled
 *  directly: a checked native radio dot fighting a segmented-control look
 *  is a losing battle, and hiding it entirely would also hide its focus
 *  ring, so the ring is redrawn on the label via `peer-focus-visible`
 *  instead of relying on the global `:focus-visible` rule landing on an
 *  invisible element. */
export function PeriodPicker({
  value,
  onChange,
}: {
  value: PeriodId;
  onChange: (id: PeriodId) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Period"
      className="inline-flex flex-wrap gap-1 rounded-lg border border-rule bg-surface-raised p-1"
    >
      {PERIODS.map((period) => {
        const checked = period.id === value;
        return (
          <label
            key={period.id}
            className={`cursor-pointer rounded px-3 py-1.5 text-sm transition-colors peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent ${
              checked ? "bg-accent text-accent-ink" : "text-ink-muted hover:text-ink"
            }`}
          >
            <input
              type="radio"
              name="period"
              value={period.id}
              checked={checked}
              onChange={() => onChange(period.id)}
              className="peer sr-only"
            />
            {period.label}
          </label>
        );
      })}
    </div>
  );
}
