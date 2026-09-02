import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TimeSeries } from "./TimeSeries";

const buckets = [
  { bucket: "2026-03-10", clicks: 10, uniques: 8 },
  { bucket: "2026-03-11", clicks: 24, uniques: 20 },
  { bucket: "2026-03-12", clicks: 6, uniques: 6 },
];

describe("TimeSeries", () => {
  it("draws one area path per series", () => {
    const { container } = render(<TimeSeries buckets={buckets} granularity="day" />);
    expect(container.querySelectorAll("path[data-area]")).toHaveLength(2);
  });

  it("draws both series on one scale, never two axes", () => {
    const { container } = render(<TimeSeries buckets={buckets} granularity="day" />);
    // A second axis would mean a second set of tick labels on the right.
    expect(container.querySelectorAll("[data-axis]")).toHaveLength(2); // one x, one y
  });

  it("exposes an accessible summary of the whole series", () => {
    render(<TimeSeries buckets={buckets} granularity="day" />);
    expect(screen.getByRole("img", { name: /40 clicks/i })).toBeInTheDocument();
  });

  it("renders an empty state rather than an axis with nothing on it", () => {
    render(<TimeSeries buckets={[]} granularity="day" />);
    expect(screen.getByText(/no clicks in this period/i)).toBeInTheDocument();
  });

  it("survives a single bucket without dividing by a zero-width domain", () => {
    const { container } = render(
      <TimeSeries buckets={[{ bucket: "2026-03-10", clicks: 3, uniques: 3 }]} granularity="day" />,
    );
    expect(container.querySelectorAll("path[data-area]")).toHaveLength(2);
  });

  // --- Coverage beyond the brief's given tests ---

  it("never produces a NaN coordinate for a single bucket's paths", () => {
    const { container } = render(
      <TimeSeries buckets={[{ bucket: "2026-03-10", clicks: 3, uniques: 3 }]} granularity="day" />,
    );
    for (const path of container.querySelectorAll("path[data-area], path[data-line]")) {
      const d = path.getAttribute("d");
      expect(d).toBeTruthy();
      expect(d).not.toMatch(/NaN/);
      expect(d).toMatch(/^M/);
    }
  });

  it("survives a series that is all zero without a NaN path or a zero-height axis", () => {
    const zeroBuckets = [
      { bucket: "2026-03-10", clicks: 0, uniques: 0 },
      { bucket: "2026-03-11", clicks: 0, uniques: 0 },
    ];
    const { container } = render(<TimeSeries buckets={zeroBuckets} granularity="day" />);
    expect(container.querySelectorAll("path[data-area]")).toHaveLength(2);
    for (const path of container.querySelectorAll("path[data-area], path[data-line]")) {
      expect(path.getAttribute("d")).not.toMatch(/NaN/);
    }
    expect(screen.getByRole("img", { name: /0 clicks/i })).toBeInTheDocument();
  });

  it("draws the clicks area/line before the uniques area/line, so uniques paints on top", () => {
    const { container } = render(<TimeSeries buckets={buckets} granularity="day" />);
    const areas = container.querySelectorAll("path[data-area]");
    expect(areas).toHaveLength(2);
    expect(areas[0]?.getAttribute("data-area")).toBe("clicks");
    expect(areas[1]?.getAttribute("data-area")).toBe("uniques");
    const lines = container.querySelectorAll("path[data-line]");
    expect(lines).toHaveLength(2);
    expect(lines[0]?.getAttribute("data-line")).toBe("clicks");
    expect(lines[1]?.getAttribute("data-line")).toBe("uniques");
  });

  it("pins the mark spec: 2px round-capped strokes and a 12%-opacity area fill", () => {
    const { container } = render(<TimeSeries buckets={buckets} granularity="day" />);
    for (const line of container.querySelectorAll("path[data-line]")) {
      expect(line.getAttribute("stroke-width")).toBe("2");
      expect(line.getAttribute("stroke-linecap")).toBe("round");
    }
    for (const area of container.querySelectorAll("path[data-area]")) {
      expect(area.getAttribute("opacity")).toBe("0.12");
    }
  });

  it("colours clicks and uniques from the series token palette, never a raw hex value", () => {
    const { container } = render(<TimeSeries buckets={buckets} granularity="day" />);
    const clicksLine = container.querySelector('path[data-line="clicks"]');
    const uniquesLine = container.querySelector('path[data-line="uniques"]');
    expect(clicksLine?.getAttribute("stroke")).toBe("var(--color-series-1)");
    expect(uniquesLine?.getAttribute("stroke")).toBe("var(--color-series-2)");
  });

  it("thins x-axis labels to at most eight even with many buckets", () => {
    const many = Array.from({ length: 40 }, (_, i) => ({
      bucket: `2026-03-${String((i % 28) + 1).padStart(2, "0")}`,
      clicks: i,
      uniques: i,
    }));
    const { container } = render(<TimeSeries buckets={many} granularity="day" />);
    const labels = container.querySelectorAll('[data-axis="x"] text');
    expect(labels.length).toBeLessThanOrEqual(8);
    expect(labels.length).toBeGreaterThan(0);
  });

  it("gives the plot tabIndex 0 and a slider role, so it is reachable without a pointer", () => {
    render(<TimeSeries buckets={buckets} granularity="day" />);
    const plot = screen.getByRole("slider");
    expect(plot).toHaveAttribute("tabindex", "0");
  });

  it("moves the active bucket left with the keyboard and announces its values", () => {
    render(<TimeSeries buckets={buckets} granularity="day" />);
    const plot = screen.getByRole("slider");

    // Defaults to the most recent bucket (index 2, the 12th).
    expect(plot).toHaveAttribute("aria-valuenow", "2");

    fireEvent.keyDown(plot, { key: "ArrowLeft" });
    expect(plot).toHaveAttribute("aria-valuenow", "1");
    expect(plot.getAttribute("aria-valuetext")).toMatch(/24 clicks, 20 uniques/);
    expect(screen.getByText(/24 clicks, 20 uniques/)).toBeInTheDocument();

    fireEvent.keyDown(plot, { key: "ArrowLeft" });
    expect(plot).toHaveAttribute("aria-valuenow", "0");
    expect(plot.getAttribute("aria-valuetext")).toMatch(/10 clicks, 8 uniques/);

    // Clamps rather than going negative.
    fireEvent.keyDown(plot, { key: "ArrowLeft" });
    expect(plot).toHaveAttribute("aria-valuenow", "0");
  });

  it("moves the active bucket right with the keyboard and clamps at the last bucket", () => {
    render(<TimeSeries buckets={buckets} granularity="day" />);
    const plot = screen.getByRole("slider");

    fireEvent.keyDown(plot, { key: "ArrowLeft" });
    fireEvent.keyDown(plot, { key: "ArrowLeft" });
    expect(plot).toHaveAttribute("aria-valuenow", "0");

    fireEvent.keyDown(plot, { key: "ArrowRight" });
    expect(plot).toHaveAttribute("aria-valuenow", "1");

    fireEvent.keyDown(plot, { key: "ArrowRight" });
    fireEvent.keyDown(plot, { key: "ArrowRight" });
    expect(plot).toHaveAttribute("aria-valuenow", "2");
  });

  it("ignores keys other than the left/right arrows", () => {
    render(<TimeSeries buckets={buckets} granularity="day" />);
    const plot = screen.getByRole("slider");
    fireEvent.keyDown(plot, { key: "ArrowDown" });
    expect(plot).toHaveAttribute("aria-valuenow", "2");
  });
});
