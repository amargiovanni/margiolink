import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Heatmap } from "./Heatmap";

const slices = [
  { value: "1-09", clicks: 10, uniques: 8 },
  { value: "1-10", clicks: 4, uniques: 4 },
  { value: "6-23", clicks: 1, uniques: 1 },
];

describe("Heatmap", () => {
  it("renders a cell for every hour of every weekday", () => {
    const { container } = render(<Heatmap slices={slices} />);
    expect(container.querySelectorAll("[data-cell]")).toHaveLength(7 * 24);
  });

  it("labels each cell so the value is readable without hovering", () => {
    render(<Heatmap slices={slices} />);
    expect(screen.getByLabelText(/monday 09:00 — 10 clicks/i)).toBeInTheDocument();
  });

  it("treats weekday 0 as Sunday, matching what the API returns", () => {
    render(<Heatmap slices={[{ value: "0-12", clicks: 3, uniques: 3 }]} />);
    expect(screen.getByLabelText(/sunday 12:00 — 3 clicks/i)).toBeInTheDocument();
  });

  it("says zero for an hour with no clicks rather than leaving it unexplained", () => {
    render(<Heatmap slices={slices} />);
    expect(screen.getByLabelText(/monday 00:00 — 0 clicks/i)).toBeInTheDocument();
  });

  it("still renders the full grid when there is no data at all", () => {
    const { container } = render(<Heatmap slices={[]} />);
    expect(container.querySelectorAll("[data-cell]")).toHaveLength(7 * 24);
  });

  // The ramp token is theme-independent by construction — it is a CSS custom
  // property name, not a resolved colour, and both the dark @theme block and
  // the light overrides in tokens.css bind the *same* token name to whichever
  // hue means "this magnitude" in that theme. Asserting on the token therefore
  // pins the semantic slot once, for both themes at once, without jsdom ever
  // needing to apply the stylesheet (it doesn't, so a computed/resolved colour
  // would come back empty here regardless).

  it("gives a zero-click cell the sunken surface, never a ramp step", () => {
    render(<Heatmap slices={slices} />);
    const cell = screen.getByLabelText(/monday 00:00 — 0 clicks/i);
    expect(cell.style.background).toBe("var(--color-surface-sunken)");
  });

  it("gives the cell holding the maximum value the highest ramp slot", () => {
    render(<Heatmap slices={slices} />);
    // "1-09" carries 10 clicks, the largest value in `slices`.
    const cell = screen.getByLabelText(/monday 09:00 — 10 clicks/i);
    expect(cell.style.background).toBe("var(--color-ramp-5)");
  });

  it("gives a low non-zero cell a lower ramp slot than the maximum's", () => {
    render(<Heatmap slices={slices} />);
    // "6-23" carries 1 click against a max of 10 — well below the maximum,
    // so it lands at the bottom of the ramp rather than the top.
    const cell = screen.getByLabelText(/saturday 23:00 — 1 clicks/i);
    expect(cell.style.background).toBe("var(--color-ramp-1)");
  });
});
