import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Sparkline } from "./Sparkline";

describe("Sparkline", () => {
  it("carries an accessible summary rather than being a bare graphic", () => {
    render(<Sparkline values={[1, 4, 2, 8]} label="Clicks over the last 7 days" />);
    expect(screen.getByRole("img", { name: /clicks over the last 7 days/i })).toBeInTheDocument();
  });

  it("draws a path for real data", () => {
    const { container } = render(<Sparkline values={[1, 4, 2, 8]} label="Trend" />);
    expect(container.querySelector("path[data-line]")).toBeInTheDocument();
  });

  it("renders a flat baseline rather than crashing when every value is zero", () => {
    const { container } = render(<Sparkline values={[0, 0, 0]} label="Trend" />);
    expect(container.querySelector("path[data-line]")).toBeInTheDocument();
  });

  it("renders nothing plottable for an empty series", () => {
    const { container } = render(<Sparkline values={[]} label="Trend" />);
    expect(container.querySelector("path[data-line]")).toBeNull();
  });

  it("survives a single point without a zero-width domain", () => {
    const { container } = render(<Sparkline values={[7]} label="Trend" />);
    expect(container.querySelector("path[data-line]")).toBeInTheDocument();
  });
});
