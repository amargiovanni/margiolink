import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PeriodPicker } from "./PeriodPicker";

describe("PeriodPicker", () => {
  it("is a radio group, so arrow keys move between periods", () => {
    render(<PeriodPicker value="7d" onChange={() => {}} />);
    expect(screen.getByRole("radiogroup", { name: /period/i })).toBeInTheDocument();
  });

  it("marks the current period for assistive technology", () => {
    render(<PeriodPicker value="7d" onChange={() => {}} />);
    expect(screen.getByRole("radio", { name: /7 days/i })).toBeChecked();
  });

  it("reports the chosen period", async () => {
    const onChange = vi.fn();
    render(<PeriodPicker value="7d" onChange={onChange} />);
    await userEvent.click(screen.getByRole("radio", { name: /30 days/i }));
    expect(onChange).toHaveBeenCalledWith("30d");
  });

  it("redraws the focus ring on the label via a :has() selector, not peer-", () => {
    // jsdom has no CSS cascade, so this cannot prove the ring actually
    // paints — that's verified against the built stylesheet, see the task
    // report. What it does pin: the input's own visible ring is lost to
    // `sr-only` clipping, so the ring *must* be redrawn on the label, and it
    // must be redrawn with `has-[:focus-visible]:*`, not `peer-focus-visible:*`.
    // Tailwind's `peer-*` variant compiles to a general sibling combinator,
    // which cannot select a parent from its own child — the input here is
    // the label's descendant, not its sibling — so a regression back to
    // `peer-*` classes here would silently never match, exactly the bug
    // this test exists to catch.
    render(<PeriodPicker value="7d" onChange={() => {}} />);
    const label = screen.getByRole("radio", { name: /7 days/i }).closest("label");
    expect(label?.className).toMatch(/has-\[:focus-visible\]:outline/);
    expect(label?.className).not.toMatch(/peer-focus-visible/);
  });
});
