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
});
