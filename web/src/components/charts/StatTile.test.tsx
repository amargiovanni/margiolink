import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StatTile } from "./StatTile";

describe("StatTile", () => {
  it("shows the label and the value", () => {
    render(<StatTile label="Clicks" value={1234} previous={1000} />);
    expect(screen.getByText("Clicks")).toBeInTheDocument();
    expect(screen.getByText("1,234")).toBeInTheDocument();
  });

  it("states what the comparison is against, so a delta is not a mystery number", () => {
    render(<StatTile label="Clicks" value={1234} previous={1000} />);
    expect(screen.getByText(/previous period/i)).toBeInTheDocument();
  });

  it("shows direction in words as well as colour", () => {
    render(<StatTile label="Clicks" value={1234} previous={1000} />);
    expect(screen.getByText(/\+23%/)).toBeInTheDocument();
    expect(screen.getByLabelText(/increase/i)).toBeInTheDocument();
  });

  it("handles a previous period of zero without dividing by it", () => {
    render(<StatTile label="Clicks" value={5} previous={0} />);
    expect(screen.getByText(/new/i)).toBeInTheDocument();
  });

  it("reports no change, not an increase, when the value is unchanged", () => {
    render(<StatTile label="Clicks" value={100} previous={100} />);
    expect(screen.getByLabelText(/no change/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/^increase/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^decrease/i)).not.toBeInTheDocument();
  });

  it("omits the comparison entirely when there is nothing to compare against", () => {
    render(<StatTile label="Countries" value={12} />);
    expect(screen.queryByText(/previous period/i)).not.toBeInTheDocument();
  });
});
