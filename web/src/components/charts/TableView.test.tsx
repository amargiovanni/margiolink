import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TableView } from "./TableView";

describe("TableView", () => {
  it("names and focuses its bounded scroll region for keyboard users", () => {
    render(
      <TableView
        caption="Clicks by country"
        columns={["Country", "Clicks"]}
        rows={[["Italy", 4]]}
      />,
    );

    const region = screen.getByRole("region", { name: "Clicks by country data table" });
    expect(region).toHaveAttribute("tabindex", "0");
    expect(region).toHaveClass("overflow-auto");
  });
});
