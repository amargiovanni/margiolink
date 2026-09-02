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

  it("does not open while focus is inside a text field", async () => {
    renderPalette(<input aria-label="Somewhere else on the page" />);
    const input = screen.getByRole("textbox", { name: /somewhere else/i });
    input.focus();

    await userEvent.keyboard("{Meta>}k{/Meta}");

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
