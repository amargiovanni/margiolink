import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RankedBars } from "./RankedBars";

const slices = [
  { value: "IT", clicks: 120, uniques: 90 },
  { value: "FR", clicks: 60, uniques: 55 },
  { value: "unknown", clicks: 5, uniques: 5 },
];

describe("RankedBars", () => {
  it("is a list, so it is navigable and countable", () => {
    render(<RankedBars slices={slices} label="Countries" />);
    expect(within(screen.getByRole("list")).getAllByRole("listitem")).toHaveLength(3);
  });

  it("prints every value as a direct label rather than relying on bar length", () => {
    render(<RankedBars slices={slices} label="Countries" />);
    expect(screen.getByText("120")).toBeInTheDocument();
    expect(screen.getByText("60")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
  });

  it("keeps the API's 'unknown' bucket visible instead of hiding it", () => {
    render(<RankedBars slices={slices} label="Countries" />);
    expect(screen.getByText("unknown")).toBeInTheDocument();
  });

  it("scales bars against the largest value, not the sum", () => {
    const { container } = render(<RankedBars slices={slices} label="Countries" />);
    const bars = container.querySelectorAll("[data-bar]");
    expect((bars[0] as HTMLElement).style.width).toBe("100%");
    expect((bars[1] as HTMLElement).style.width).toBe("50%");
  });

  it("renders an empty state rather than an empty box", () => {
    render(<RankedBars slices={[]} label="Countries" />);
    expect(screen.getByText(/no data/i)).toBeInTheDocument();
  });
});
