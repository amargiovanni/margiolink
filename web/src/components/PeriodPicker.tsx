import { PERIODS, type PeriodId } from "../lib/ranges";

/** A Radix-free radio group: native `<input type="radio">`s sharing one
 *  `name`, styled as a segmented control. Grouping same-`name` radios is
 *  what gives roving arrow-key navigation for free, straight from the
 *  browser, with no JavaScript keyboard handler of our own — the same
 *  reasoning `TimeSeries`' slider spells out for its own interaction, just
 *  handed to native semantics here instead of ARIA ones.
 *
 *  Each input is visually hidden (`sr-only`) rather than styled directly: a
 *  checked native radio dot fighting a segmented-control look is a losing
 *  battle, and hiding it entirely would also hide its focus ring, so the
 *  ring is redrawn on the label instead of relying on the global
 *  `:focus-visible` rule landing on an invisible element.
 *
 *  That redraw uses `has-[:focus-visible]:*` on the `<label>`, not
 *  `peer-focus-visible:*`: the input is the label's *child*, not its
 *  sibling, and Tailwind's `peer-*` variant compiles to a general sibling
 *  combinator (`~`), which cannot select a parent from a descendant no
 *  matter how the classes are arranged — the rule would simply never match.
 *  `:has()` is the one selector relationship that runs the other way.
 *  `focus-within` was deliberately not used either: it fires on a plain
 *  pointer click as well as a keyboard focus, defeating the entire reason
 *  `:focus-visible` exists — a ring that appears on every click is exactly
 *  the visual noise `:focus-visible` was added to remove. */
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
            className={`cursor-pointer rounded px-3 py-1.5 text-sm transition-colors has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent ${
              checked ? "bg-accent text-accent-ink" : "text-ink-muted hover:text-ink"
            }`}
          >
            <input
              type="radio"
              name="period"
              value={period.id}
              checked={checked}
              onChange={() => onChange(period.id)}
              className="sr-only"
            />
            {period.label}
          </label>
        );
      })}
    </div>
  );
}
