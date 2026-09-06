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

  it("keeps exactly one primary navigation landmark", () => {
    renderShell();
    expect(screen.getAllByRole("navigation", { name: /primary/i })).toHaveLength(1);
  });

  it("offers the global creation path and command hint", () => {
    renderShell();
    expect(screen.getByRole("link", { name: /new link/i })).toHaveAttribute("href", "/links?new=1");
    expect(screen.getByText(/command menu/i)).toBeInTheDocument();
  });

  it("does not duplicate the global creation link on the links workspace", () => {
    renderShell("/links");
    expect(screen.queryByRole("link", { name: /new link/i })).not.toBeInTheDocument();
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

  it("does not leave the active item with the rail's muted text colour", () => {
    renderShell("/links");
    const active = screen.getByRole("link", { name: /links/i });

    expect(active).toHaveClass("text-accent-ink");
    expect(active).not.toHaveClass("text-rail-muted");
  });

  it("renders its children inside main", () => {
    renderShell();
    expect(
      within(screen.getByRole("main")).getByRole("heading", { name: "Overview" }),
    ).toBeVisible();
  });
});
