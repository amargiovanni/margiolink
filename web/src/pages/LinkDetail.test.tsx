import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import LinkDetail from "./LinkDetail";

const LINK = {
  id: 1,
  slug: "demo",
  shortUrl: "https://link.test/demo",
  targetUrl: "https://example.com",
  title: null,
  description: null,
  hasPassword: false,
  expiresAt: null,
  expiredUrl: null,
  isActive: true,
  createdAt: 1_800_000_000,
  updatedAt: 1_800_000_000,
  deletedAt: null,
  tags: [],
};

const EMPTY_SUMMARY = { clicks: 0, uniques: 0, bots: 0, countries: 0 };
const SOME_SLICES = { slices: [{ value: "IT", clicks: 10, uniques: 8 }] };
const NO_SLICES = { slices: [] };

type Handler = unknown | { status: number; body: unknown } | ((url: URL) => unknown);

/** Same shape as Task 9's `Links.test.tsx` stub — a record of path to
 *  response — extended to accept a function for `/api/stats/dimension`,
 *  whose response depends on the `name` query parameter rather than the
 *  path alone. */
function stub(routes: Record<string, Handler>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) => {
      const url = new URL(String(input), "https://link.test");
      const entry = routes[url.pathname];
      if (entry === undefined) return Response.json({ error: "not_found" }, { status: 404 });
      const resolved = typeof entry === "function" ? (entry as (u: URL) => unknown)(url) : entry;
      if (resolved && typeof resolved === "object" && "status" in resolved && "body" in resolved) {
        const { status, body } = resolved as { status: number; body: unknown };
        return Response.json(body, { status });
      }
      return Response.json(resolved);
    }),
  );
}

function dimensionByName(byName: Record<string, unknown>, fallback: unknown = SOME_SLICES) {
  return (url: URL) => byName[url.searchParams.get("name") ?? ""] ?? fallback;
}

const DEFAULT_ROUTES: Record<string, Handler> = {
  "/api/links/1": { link: LINK },
  "/api/stats/summary": { current: EMPTY_SUMMARY, previous: EMPTY_SUMMARY, range: {} },
  "/api/stats/timeseries": { buckets: [], granularity: "day" },
  "/api/stats/dimension": dimensionByName({}),
  "/api/stats/live": { clicks: [] },
};

afterEach(() => vi.unstubAllGlobals());

function renderDetail() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/links/1"]}>
        <Routes>
          <Route path="/links/:id" element={<LinkDetail />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("LinkDetail", () => {
  it("shows the link's slug and short URL", async () => {
    stub(DEFAULT_ROUTES);
    renderDetail();
    expect(await screen.findByText("demo")).toBeInTheDocument();
    expect(screen.getByText("https://link.test/demo")).toBeInTheDocument();
  });

  it("scopes every stats query to this link, not to every link", async () => {
    stub(DEFAULT_ROUTES);
    renderDetail();
    await screen.findByText("demo");

    await waitFor(() => {
      const calls = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls;
      for (const path of [
        "/api/stats/summary",
        "/api/stats/timeseries",
        "/api/stats/dimension",
        "/api/stats/live",
      ]) {
        const call = calls.find((c) => String(c[0]).includes(path));
        expect(call, `${path} was never called`).toBeDefined();
        const url = new URL(String(call?.[0]), "https://link.test");
        expect(url.searchParams.get("linkId")).toBe("1");
      }
    });
  });

  it("changes the range sent to the API when the period selector changes", async () => {
    stub(DEFAULT_ROUTES);
    renderDetail();
    await screen.findByText("demo");

    function summaryCalls() {
      const calls = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls;
      return calls
        .map((c) => new URL(String(c[0]), "https://link.test"))
        .filter((u) => u.pathname === "/api/stats/summary");
    }

    const before = summaryCalls();
    const beforeFrom = before.at(-1)?.searchParams.get("from");

    await userEvent.click(screen.getByRole("button", { name: "30 days" }));

    await waitFor(() => {
      const after = summaryCalls();
      const afterFrom = after.at(-1)?.searchParams.get("from");
      expect(afterFrom).not.toBe(beforeFrom);
    });
  });

  it("renders the hour-by-weekday heatmap", async () => {
    stub(DEFAULT_ROUTES);
    const { container } = renderDetail();
    await screen.findByText("Activity by hour");
    await waitFor(() => {
      expect(container.querySelectorAll("[data-cell]")).toHaveLength(7 * 24);
    });
  });

  it("lists recent clicks in the live feed", async () => {
    stub({
      ...DEFAULT_ROUTES,
      "/api/stats/live": {
        clicks: [
          {
            id: 1,
            linkId: 1,
            slug: "demo",
            ts: Math.floor(Date.now() / 1000) - 60,
            country: "FR",
            city: "Paris",
            device: "mobile",
            browser: "Firefox",
            referrerType: "search",
            source: "link",
            outcome: "redirect",
            isBot: false,
          },
        ],
      },
    });
    renderDetail();
    const feed = await screen.findByText("Live feed");
    const section = feed.closest("section") as HTMLElement;
    expect(await within(section).findByText("FR")).toBeInTheDocument();
    expect(within(section).getByText("mobile")).toBeInTheDocument();
  });

  it("keeps the live feed silent for a screen reader", async () => {
    stub({
      ...DEFAULT_ROUTES,
      "/api/stats/live": {
        clicks: [
          {
            id: 1,
            linkId: 1,
            slug: "demo",
            ts: Math.floor(Date.now() / 1000) - 60,
            country: "FR",
            city: "Paris",
            device: "mobile",
            browser: "Firefox",
            referrerType: "search",
            source: "link",
            outcome: "redirect",
            isBot: false,
          },
        ],
      },
    });
    const { container } = renderDetail();
    await screen.findByText("FR");
    const list = container.querySelector("ul[aria-live]");
    expect(list).toHaveAttribute("aria-live", "off");
  });

  it("pauses the live feed's polling and resumes with an immediate fetch", async () => {
    stub(DEFAULT_ROUTES);
    renderDetail();
    await screen.findByText("demo");

    function liveCallCount() {
      const calls = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls;
      return calls.filter((c) => String(c[0]).includes("/api/stats/live")).length;
    }

    await screen.findByText(/live — updating/i);
    await userEvent.click(screen.getByRole("button", { name: /pause/i }));
    expect(await screen.findByText("Paused")).toBeInTheDocument();

    const countWhilePaused = liveCallCount();

    await userEvent.click(screen.getByRole("button", { name: /resume/i }));
    expect(await screen.findByText(/live — updating/i)).toBeInTheDocument();

    await waitFor(() => {
      expect(liveCallCount()).toBeGreaterThan(countWhilePaused);
    });
  });

  it("derives a flag glyph from the country's alpha-2 code", async () => {
    stub(DEFAULT_ROUTES);
    renderDetail();
    const countriesHeading = await screen.findByText("Countries");
    const panel = countriesHeading.closest("section") as HTMLElement;
    // 🇮🇹 is U+1F1EE U+1F1F9, the regional-indicator pair for "IT".
    expect(await within(panel).findByText("🇮🇹 IT")).toBeInTheDocument();
  });

  it("shows the outcome panel", async () => {
    stub(DEFAULT_ROUTES);
    renderDetail();
    expect(await screen.findByText("Outcomes")).toBeInTheDocument();
  });

  it("renders 'That link does not exist' rather than an empty shell on a 404", async () => {
    stub({ ...DEFAULT_ROUTES, "/api/links/1": { status: 404, body: { error: "not_found" } } });
    renderDetail();
    expect(await screen.findByText(/that link does not exist/i)).toBeInTheDocument();
  });

  it("renders 'That link does not exist' for a non-numeric id, rather than loading forever", async () => {
    stub(DEFAULT_ROUTES);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={["/links/not-a-number"]}>
          <Routes>
            <Route path="/links/:id" element={<LinkDetail />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    // `useLink` is disabled for a non-finite id and never settles on its
    // own — this must not depend on that query ever resolving.
    expect(await screen.findByText(/that link does not exist/i)).toBeInTheDocument();
    expect(screen.queryByText(/loading link/i)).not.toBeInTheDocument();
  });

  it("hides the UTM panels when their dimensions return no slices", async () => {
    stub({
      ...DEFAULT_ROUTES,
      "/api/stats/dimension": dimensionByName({
        utm_campaign: NO_SLICES,
        utm_source: NO_SLICES,
        utm_medium: NO_SLICES,
      }),
    });
    renderDetail();
    // Wait for a panel that is always present, so the absence check below
    // runs after the UTM queries have actually settled rather than merely
    // before they started.
    await screen.findByText("Countries");

    await waitFor(() => {
      expect(screen.queryByText("Campaigns")).not.toBeInTheDocument();
      expect(screen.queryByText("Sources")).not.toBeInTheDocument();
      expect(screen.queryByText("Mediums")).not.toBeInTheDocument();
    });
  });

  it("shows the UTM panels once their dimensions return slices", async () => {
    stub({
      ...DEFAULT_ROUTES,
      "/api/stats/dimension": dimensionByName({
        utm_campaign: { slices: [{ value: "spring-sale", clicks: 4, uniques: 3 }] },
        utm_source: { slices: [{ value: "newsletter", clicks: 2, uniques: 2 }] },
        utm_medium: { slices: [{ value: "email", clicks: 1, uniques: 1 }] },
      }),
    });
    renderDetail();
    expect(await screen.findByText("Campaigns")).toBeInTheDocument();
    expect(screen.getByText("Sources")).toBeInTheDocument();
    expect(screen.getByText("Mediums")).toBeInTheDocument();
  });

  it("keeps the fourteen dimension panels in the brief's order", async () => {
    // DEFAULT_ROUTES' dimension stub returns non-empty slices for every
    // name it isn't told otherwise about, so all three UTM panels render
    // here too — this test only means anything if the full set of fourteen
    // is present to be ordered.
    stub(DEFAULT_ROUTES);
    renderDetail();
    await screen.findByText("Countries");

    const expectedOrder = [
      "Countries",
      "Cities",
      "Devices",
      "Operating systems",
      "Browsers",
      "Languages",
      "Networks",
      "Channels",
      "Referrers",
      "Campaigns",
      "Sources",
      "Mediums",
      "Scans vs clicks",
      "Outcomes",
    ];

    await waitFor(() => {
      // level 2, not 3: ChartFrame's panel headings sit directly under this
      // page's own h1 with nothing between (Task 14's a11y sweep) — see the
      // comment on ChartFrame's heading element.
      const headings = screen
        .getAllByRole("heading", { level: 2 })
        .map((heading) => heading.textContent);
      const panelHeadings = headings.filter((text) => expectedOrder.includes(text ?? ""));
      expect(panelHeadings).toStrictEqual(expectedOrder);
    });
  });
});
