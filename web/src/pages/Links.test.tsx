import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import Links from "./Links";

// Named as its own const, rather than indexed off a list, so a mutated
// fixture below (`{ ...LINK, isActive: false }`) stays assignable to `Link`
// without a cast or non-null assertion: spreading `LINKS.links[0]` would
// widen every property to optional, since array indexing is not narrowed to
// "definitely present" by TypeScript.
const LINK = {
  id: 1,
  slug: "launch",
  shortUrl: "https://link.test/launch",
  targetUrl: "https://example.com/launch",
  title: "Launch",
  description: null,
  hasPassword: false,
  expiresAt: null,
  expiredUrl: null,
  isActive: true,
  createdAt: 1_800_000_000,
  updatedAt: 1_800_000_000,
  deletedAt: null,
  tags: [{ id: 7, name: "spring", color: "#199e70" }],
};

const LINKS = {
  links: [LINK],
  total: 1,
};

function stub(routes: Record<string, unknown>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) => {
      const path = new URL(String(input), "https://link.test").pathname;
      const body = routes[path];
      return body ? Response.json(body) : Response.json({ error: "not_found" }, { status: 404 });
    }),
  );
}

afterEach(() => vi.unstubAllGlobals());

function renderLinks() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Links />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Links", () => {
  it("lists each link with its slug and destination", async () => {
    stub({
      "/api/links": LINKS,
      "/api/tags": { tags: [] },
      "/api/stats/sparklines": { days: 7, series: { "1": [0, 1, 2, 0, 3, 1, 4] } },
    });
    renderLinks();
    expect(await screen.findByText("launch")).toBeInTheDocument();
    expect(screen.getByText("https://example.com/launch")).toBeInTheDocument();
    // Pins the contrapositive of the "marks a deactivated link" test below —
    // an active link must not carry the "Inactive" word either.
    expect(screen.queryByText(/inactive/i)).not.toBeInTheDocument();
  });

  it("shows a link's tags", async () => {
    stub({
      "/api/links": LINKS,
      "/api/tags": { tags: [] },
      "/api/stats/sparklines": { days: 7, series: {} },
    });
    renderLinks();
    expect(await screen.findByText("spring")).toBeInTheDocument();
  });

  it("searches by typing, and asks the API rather than filtering in the browser", async () => {
    stub({
      "/api/links": LINKS,
      "/api/tags": { tags: [] },
      "/api/stats/sparklines": { days: 7, series: {} },
    });
    renderLinks();
    await screen.findByText("launch");

    await userEvent.type(screen.getByRole("searchbox", { name: /search/i }), "spr");

    // The debounce (250ms, Step 4) means the request is not necessarily in
    // flight the instant typing finishes — real timers plus `waitFor` makes
    // this load-bearing for the debounce actually firing, rather than for
    // fake timers papering over a race that would hang `userEvent`.
    await waitFor(() => {
      const calls = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls;
      const searched = calls.some((c) => String(c[0]).includes("search=spr"));
      expect(searched).toBe(true);
    });
  });

  it("offers an empty state with a way forward when there are no links", async () => {
    stub({
      "/api/links": { links: [], total: 0 },
      "/api/tags": { tags: [] },
      "/api/stats/sparklines": { days: 7, series: {} },
    });
    renderLinks();
    expect(await screen.findByText(/no links yet/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /new link/i })).toBeInTheDocument();
  });

  it("marks a deactivated link in words, not only by styling", async () => {
    stub({
      "/api/links": { links: [{ ...LINK, isActive: false }], total: 1 },
      "/api/tags": { tags: [] },
      "/api/stats/sparklines": { days: 7, series: {} },
    });
    renderLinks();
    expect(await screen.findByText(/inactive/i)).toBeInTheDocument();
  });

  it("surfaces an API failure instead of showing an empty list", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ error: "boom" }, { status: 500 })),
    );
    renderLinks();
    expect(await screen.findByRole("alert")).toHaveTextContent(/could not load/i);
  });

  it("says clicks are unavailable rather than a false zero when the sparklines request fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        const path = new URL(String(input), "https://link.test").pathname;
        if (path === "/api/links") return Response.json(LINKS);
        if (path === "/api/tags") return Response.json({ tags: [] });
        if (path === "/api/stats/sparklines") {
          return Response.json({ error: "boom" }, { status: 500 });
        }
        return Response.json({ error: "not_found" }, { status: 404 });
      }),
    );
    renderLinks();
    expect(await screen.findByText("Clicks unavailable")).toBeInTheDocument();
    // The row must never fabricate a real-looking zero out of a failure —
    // a genuine zero and "unknown" have to stay visibly different.
    expect(screen.queryByText(/^0 clicks/)).not.toBeInTheDocument();
  });

  it("says the tag filter is unavailable rather than looking like there are no tags when the tags request fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        const path = new URL(String(input), "https://link.test").pathname;
        if (path === "/api/links") return Response.json(LINKS);
        if (path === "/api/tags") return Response.json({ error: "boom" }, { status: 500 });
        if (path === "/api/stats/sparklines") return Response.json({ days: 7, series: {} });
        return Response.json({ error: "not_found" }, { status: 404 });
      }),
    );
    renderLinks();
    await screen.findByText("launch");
    expect(screen.getByText(/tag filter unavailable/i)).toBeInTheDocument();
    // An empty "All tags"-only dropdown would look identical to "there are
    // no tags in the system" — the filter control itself must be gone, not
    // just quietly empty.
    expect(screen.queryByRole("combobox", { name: /^tag$/i })).not.toBeInTheDocument();
  });
});
