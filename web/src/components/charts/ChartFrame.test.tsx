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

  it("still renders the real table when the query succeeded, even with no rows", async () => {
    render(
      <ChartFrame title="Clicks by country" table={{ columns: table.columns, rows: [] }}>
        <svg aria-hidden="true" />
      </ChartFrame>,
    );
    await userEvent.click(screen.getByRole("button", { name: /table/i }));
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows the same failure in the table pane that the chart pane shows, instead of an empty table", async () => {
    render(
      <ChartFrame
        title="Clicks by country"
        table={{ columns: table.columns, rows: [] }}
        status="error"
        errorMessage="Could not load this breakdown."
      >
        <p role="alert">Could not load this breakdown.</p>
      </ChartFrame>,
    );
    await userEvent.click(screen.getByRole("button", { name: /table/i }));
    expect(screen.getByRole("alert")).toHaveTextContent("Could not load this breakdown.");
    // Never the same pixels as a real empty result: no table markup at all,
    // not a table with zero rows.
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("shows a loading state in the table pane while pending, not an empty table", async () => {
    render(
      <ChartFrame
        title="Clicks by country"
        table={{ columns: table.columns, rows: [] }}
        status="pending"
      >
        <p>Loading…</p>
      </ChartFrame>,
    );
    await userEvent.click(screen.getByRole("button", { name: /table/i }));
    expect(screen.getByText("Loading…")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
