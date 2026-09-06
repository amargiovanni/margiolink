import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Panel } from "../ui/Panel";
import { BrandMark } from "./BrandMark";
import { InsightNav } from "./InsightNav";
import { PageHeader } from "./PageHeader";
import { SectionHeading } from "./SectionHeading";

describe("editorial layout primitives", () => {
  it("gives a page one labelled title and an optional action area", () => {
    render(
      <PageHeader
        eyebrow="Analytics workspace"
        title="Overview"
        description="See what changed and what deserves attention."
        actions={<button type="button">Change period</button>}
      />,
    );

    expect(screen.getByRole("heading", { name: "Overview", level: 1 })).toBeInTheDocument();
    expect(screen.getByText("Analytics workspace")).toBeInTheDocument();
    expect(screen.getByText("See what changed and what deserves attention.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Change period" })).toBeInTheDocument();
  });

  it("keeps the product name available in the compact brand", () => {
    render(<BrandMark compact />);

    expect(screen.getByText("MargioLink")).toHaveClass("sr-only");
  });

  it("introduces a section with a real second-level heading", () => {
    render(
      <SectionHeading
        id="audience"
        eyebrow="Who arrived"
        title="Audience"
        description="Geography, devices, and software."
      />,
    );

    expect(screen.getByRole("heading", { name: "Audience", level: 2 })).toBeInTheDocument();
    expect(screen.getByText("Who arrived")).toBeInTheDocument();
    expect(screen.getByText("Geography, devices, and software.")).toBeInTheDocument();
  });

  it("can render a labelled semantic panel", () => {
    render(
      <Panel as="section" aria-label="Sessions">
        Session controls
      </Panel>,
    );

    expect(screen.getByRole("region", { name: "Sessions" })).toHaveTextContent("Session controls");
  });

  it("links the insight index to each major section", () => {
    render(
      <InsightNav
        items={[
          { id: "performance", label: "Performance" },
          { id: "audience", label: "Audience" },
        ]}
      />,
    );

    const nav = screen.getByRole("navigation", { name: "Link insights" });
    expect(screen.getByRole("link", { name: "Performance" })).toHaveAttribute(
      "href",
      "#performance",
    );
    expect(screen.getByRole("link", { name: "Audience" })).toHaveAttribute("href", "#audience");
    expect(nav).toBeInTheDocument();
  });
});
