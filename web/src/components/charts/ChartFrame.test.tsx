import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ChartFrame } from "./ChartFrame";

const table = {
  columns: ["Country", "Clicks"],
  rows: [
    ["Italy", 42],
    ["France", 17],
  ],
};

describe("ChartFrame", () => {
  it("names the chart with a heading", () => {
    render(
      <ChartFrame title="Clicks by country" table={table}>
        <svg aria-hidden="true" />
      </ChartFrame>,
    );
    expect(screen.getByRole("heading", { name: "Clicks by country" })).toBeInTheDocument();
  });

  it("offers a table view for every chart", async () => {
    render(
      <ChartFrame title="Clicks by country" table={table}>
        <svg data-testid="plot" aria-hidden="true" />
      </ChartFrame>,
    );
    await userEvent.click(screen.getByRole("button", { name: /table/i }));
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "Italy" })).toBeInTheDocument();
    expect(screen.queryByTestId("plot")).not.toBeInTheDocument();
  });

  it("returns to the chart", async () => {
    render(
      <ChartFrame title="Clicks by country" table={table}>
        <svg data-testid="plot" aria-hidden="true" />
      </ChartFrame>,
    );
    await userEvent.click(screen.getByRole("button", { name: /table/i }));
    await userEvent.click(screen.getByRole("button", { name: /chart/i }));
    expect(screen.getByTestId("plot")).toBeInTheDocument();
  });

  it("shows a legend when two or more series are present", () => {
    render(
      <ChartFrame
        title="Clicks and uniques"
        series={[
          { label: "Clicks", color: "var(--color-series-1)" },
          { label: "Uniques", color: "var(--color-series-2)" },
        ]}
        table={table}
      >
        <svg aria-hidden="true" />
      </ChartFrame>,
    );
    expect(screen.getByText("Clicks")).toBeInTheDocument();
    expect(screen.getByText("Uniques")).toBeInTheDocument();
  });

  it("omits the legend for a single series, since the title names it", () => {
    const { container } = render(
      <ChartFrame
        title="Clicks"
        series={[{ label: "Clicks", color: "var(--color-series-1)" }]}
        table={table}
      >
        <svg aria-hidden="true" />
      </ChartFrame>,
    );
    expect(container.querySelector("[data-legend]")).toBeNull();
  });
});
