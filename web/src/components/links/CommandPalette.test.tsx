import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CommandPalette } from "./CommandPalette";

afterEach(() => vi.unstubAllGlobals());

function renderPalette(extraChildren: ReactNode = null) {
  const client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        {extraChildren}
        <CommandPalette />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("CommandPalette", () => {
  it("is closed until it is asked for", () => {
    renderPalette();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens on the platform shortcut", async () => {
    renderPalette();
    await userEvent.keyboard("{Meta>}k{/Meta}");
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("opens on Control-K too, for anyone not on a Mac", async () => {
    renderPalette();
    await userEvent.keyboard("{Control>}k{/Control}");
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("closes on Escape", async () => {
    renderPalette();
    await userEvent.keyboard("{Meta>}k{/Meta}");
    await screen.findByRole("dialog");
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("offers creating a link and reaching each section", async () => {
    renderPalette();
    await userEvent.keyboard("{Meta>}k{/Meta}");
    expect(await screen.findByText(/new link/i)).toBeInTheDocument();
    expect(screen.getByText(/overview/i)).toBeInTheDocument();
    expect(screen.getByText(/settings/i)).toBeInTheDocument();
  });

  it("keeps a recent link findable by typing its title, not just its id", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        const path = new URL(String(input), "https://link.test").pathname;
        if (path === "/api/links") {
          return Response.json({
            links: [
              {
                id: 1,
                slug: "abc123",
                shortUrl: "https://link.test/abc123",
                targetUrl: "https://example.com",
                title: "Spring Launch",
                description: null,
                hasPassword: false,
                expiresAt: null,
                expiredUrl: null,
                isActive: true,
                createdAt: 0,
                updatedAt: 0,
                deletedAt: null,
                tags: [],
              },
            ],
            total: 1,
          });
        }
        return Response.json({ error: "not_found" }, { status: 404 });
      }),
    );
    renderPalette();
    await userEvent.keyboard("{Meta>}k{/Meta}");
    // Wait for the recent-links request to resolve before filtering — this
    // asserts the item is findable BY TITLE, not merely present unfiltered.
    await screen.findByText("Spring Launch");

    await userEvent.type(screen.getByRole("combobox"), "Spring Launch");

    expect(await screen.findByText("Spring Launch")).toBeInTheDocument();
  });

  it("opens even while focus is in the links page's own search box — there is no other way to reach it from there", async () => {
    renderPalette(<input type="search" aria-label="Search" />);
    const searchBox = screen.getByRole("searchbox", { name: /search/i });
    searchBox.focus();

    await userEvent.keyboard("{Meta>}k{/Meta}");

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("does not open while focus is inside a rich-text editor, which binds Ctrl/Cmd+K itself", async () => {
    renderPalette(
      // biome-ignore lint/a11y/useSemanticElements: standing in for a real rich-text editor's contentEditable region — the whole point of this test is that it is not a plain <input>/<textarea>.
      <div contentEditable role="textbox" tabIndex={0} aria-label="Notes" />,
    );
    const editor = screen.getByRole("textbox", { name: /notes/i });
    // jsdom does not implement `HTMLElement.isContentEditable` (it has no
    // layout/rendering engine behind it), so the `contentEditable` attribute
    // alone doesn't make this getter true here the way it would in a real
    // browser — defined directly so the guard under test sees what it would
    // see there.
    Object.defineProperty(editor, "isContentEditable", { value: true, configurable: true });
    editor.focus();

    await userEvent.keyboard("{Meta>}k{/Meta}");

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
