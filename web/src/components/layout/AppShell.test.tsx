import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { AppShell } from "./AppShell";

function renderShell(path = "/") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppShell>
        <h1>Overview</h1>
      </AppShell>
    </MemoryRouter>,
  );
}

describe("AppShell", () => {
  it("offers a skip link as the first focusable element", async () => {
    renderShell();
    await userEvent.tab();
    expect(screen.getByRole("link", { name: /skip to main content/i })).toHaveFocus();
  });

  it("renders exactly one main landmark", () => {
    renderShell();
    expect(screen.getAllByRole("main")).toHaveLength(1);
  });

  it("names its navigation landmarks so two navs are distinguishable", () => {
    renderShell();
    expect(screen.getByRole("navigation", { name: /primary/i })).toBeInTheDocument();
  });

  it("links to every section", () => {
    renderShell();
    const nav = screen.getByRole("navigation", { name: /primary/i });
    for (const label of [/overview/i, /links/i, /tags/i, /settings/i]) {
      expect(within(nav).getByRole("link", { name: label })).toBeInTheDocument();
    }
  });

  it("marks the current section for assistive technology, not only by colour", () => {
    renderShell("/links");
    const nav = screen.getByRole("navigation", { name: /primary/i });
    expect(within(nav).getByRole("link", { name: /links/i })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("renders its children inside main", () => {
    renderShell();
    expect(
      within(screen.getByRole("main")).getByRole("heading", { name: "Overview" }),
    ).toBeVisible();
  });
});
