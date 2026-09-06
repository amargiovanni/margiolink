import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import Overview from "./Overview";

const CURRENT = { clicks: 1234, uniques: 800, bots: 100, countries: 12 };
const PREVIOUS = { clicks: 1000, uniques: 700, bots: 50, countries: 10 };

type Handler = unknown | ((url: URL) => unknown);

/** Same stub shape as `LinkDetail.test.tsx` — a record of path to response,
 *  extended to accept a function for endpoints whose response depends on a
 *  query parameter (`/api/stats/dimension`'s `name`) rather than the path
 *  alone. */
function stub(routes: Record<string, Handler>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) => {
      const url = new URL(String(input), "https://link.test");
      const entry = routes[url.pathname];
      if (entry === undefined) return Response.json({ error: "not_found" }, { status: 404 });
      const resolved = typeof entry === "function" ? (entry as (u: URL) => unknown)(url) : entry;
      return Response.json(resolved);
    }),
  );
}

function dimensionByName(byName: Record<string, unknown>, fallback: unknown = { slices: [] }) {
  return (url: URL) => byName[url.searchParams.get("name") ?? ""] ?? fallback;
}

const DEFAULT_ROUTES: Record<string, Handler> = {
  // Matches the deployment's real `RAW_RETENTION_DAYS` (`wrangler.jsonc`)
  // rather than an arbitrary test value, so the same 24h/7d/30d/90d — no
  // 12m — split the reviewer's ruling names is what every test below
  // actually exercises.
  "/api/meta": { retentionDays: 180, shortDomain: "link.test" },
  "/api/stats/summary": { current: CURRENT, previous: PREVIOUS, range: {} },
  "/api/stats/timeseries": {
    buckets: [
      { bucket: "2026-08-26", clicks: 100, uniques: 80 },
      { bucket: "2026-08-27", clicks: 200, uniques: 150 },
    ],
    granularity: "day",
  },
  "/api/stats/dimension": dimensionByName({}),
  "/api/stats/top-links": {
    links: [
      { id: 1, slug: "launch", title: "Launch", clicks: 42, uniques: 30 },
      { id: 2, slug: "sale", title: null, clicks: 10, uniques: 8 },
    ],
  },
};

afterEach(() => vi.unstubAllGlobals());

function renderOverview() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Overview />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Overview", () => {
  it("states what the overview helps the operator decide", async () => {
    stub(DEFAULT_ROUTES);
    renderOverview();

    expect(await screen.findByRole("heading", { name: "Overview", level: 1 })).toBeInTheDocument();
    expect(screen.getByText("Analytics workspace")).toBeInTheDocument();
    expect(screen.getByText(/what changed and what deserves attention/i)).toBeInTheDocument();
  });

  it("renders the four stat tiles with values from the summary endpoint", async () => {
    stub(DEFAULT_ROUTES);
    renderOverview();

    expect(await screen.findByText("1,234")).toBeInTheDocument(); // clicks

    const uniquesTile = screen.getByText("Unique visitors").closest(".rounded-lg") as HTMLElement;
    expect(within(uniquesTile).getByText("800")).toBeInTheDocument();

    const countriesTile = screen
      .getByText("Countries reached")
      .closest(".rounded-lg") as HTMLElement;
    expect(within(countriesTile).getByText("12")).toBeInTheDocument();

    // Bot share: bots / (clicks + bots) = 100 / 1334 ≈ 7% — never bots / clicks (≈8%).
    const botTile = screen.getByText("Bot share").closest(".rounded-lg") as HTMLElement;
    expect(within(botTile).getByText("7%")).toBeInTheDocument();
  });

  it("gives only clicks and uniques a sparkline, never countries or bot share", async () => {
    stub(DEFAULT_ROUTES);
    renderOverview();
    await screen.findByText("1,234");

    const kpiRow = screen.getByText("Unique visitors").closest(".grid") as HTMLElement;
    const clicksTile = within(kpiRow).getByText("Clicks").closest(".rounded-lg") as HTMLElement;
    expect(within(clicksTile).getByRole("img", { name: /clicks trend/i })).toBeInTheDocument();

    const uniquesTile = screen.getByText("Unique visitors").closest(".rounded-lg") as HTMLElement;
    expect(within(uniquesTile).getByRole("img", { name: /trend/i })).toBeInTheDocument();

    // Countries reached and bot share have no per-bucket source (the
    // timeseries endpoint carries no country count and excludes bots by
    // construction), so neither may fabricate a two-point line from
    // current/previous — see the task brief.
    const countriesTile = screen
      .getByText("Countries reached")
      .closest(".rounded-lg") as HTMLElement;
    expect(within(countriesTile).queryByRole("img", { name: /trend/i })).not.toBeInTheDocument();

    const botTile = screen.getByText("Bot share").closest(".rounded-lg") as HTMLElement;
    expect(within(botTile).queryByRole("img", { name: /trend/i })).not.toBeInTheDocument();
  });

  it("lists top links ranked by clicks, each linking to its detail page", async () => {
    stub(DEFAULT_ROUTES);
    renderOverview();

    const launchLink = await screen.findByRole("link", { name: "Launch" });
    expect(launchLink).toHaveAttribute("href", "/links/1");

    const saleLink = screen.getByRole("link", { name: "sale" });
    expect(saleLink).toHaveAttribute("href", "/links/2");
  });

  it("re-queries with a different `from` when the period changes", async () => {
    stub(DEFAULT_ROUTES);
    renderOverview();
    await screen.findByText("1,234");

    const firstCall = (
      globalThis.fetch as unknown as { mock: { calls: unknown[][] } }
    ).mock.calls.find((c) => String(c[0]).includes("/api/stats/summary"));
    const firstFrom = new URL(String(firstCall?.[0]), "https://link.test").searchParams.get("from");

    await userEvent.click(screen.getByRole("radio", { name: /30 days/i }));

    await waitFor(() => {
      const calls = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls;
      const latest = calls.filter((c) => String(c[0]).includes("/api/stats/summary")).at(-1);
      const latestFrom = new URL(String(latest?.[0]), "https://link.test").searchParams.get("from");
      expect(latestFrom).not.toBe(firstFrom);
    });
  });

  it("surfaces the once-per-day caveat on the unique-visitor tile", async () => {
    stub(DEFAULT_ROUTES);
    renderOverview();
    await screen.findByText("1,234");
    expect(screen.getByText(/counted once per day/i)).toBeInTheDocument();
  });

  it("does not offer 12 months when its comparison window would fall outside the retention window", async () => {
    stub(DEFAULT_ROUTES);
    renderOverview();
    await screen.findByText("1,234");

    // 180 days of retention covers 12m's own 365-day span but not its
    // preceding 365-day comparison window (730 days back) — see
    // `periodsFor` in `lib/ranges.ts`.
    expect(screen.queryByRole("radio", { name: /12 months/i })).not.toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /90 days/i })).toBeInTheDocument();
    expect(screen.getByText(/180-day retention window/i)).toBeInTheDocument();
  });

  it("requests every one of the heatmap's 168 possible cells, not the old 100-row cap", async () => {
    stub(DEFAULT_ROUTES);
    renderOverview();
    await screen.findByText("1,234");

    await waitFor(() => {
      const calls = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls;
      const call = calls.find((c) => {
        const url = new URL(String(c[0]), "https://link.test");
        return (
          url.pathname === "/api/stats/dimension" && url.searchParams.get("name") === "dow_hour"
        );
      });
      expect(call, "dow_hour dimension query was never made").toBeDefined();
      const url = new URL(String(call?.[0]), "https://link.test");
      expect(url.searchParams.get("limit")).toBe("168");
    });
  });

  it("shows an alert and no picker when the retention window fails to load", async () => {
    const { "/api/meta": _omit, ...routesWithoutMeta } = DEFAULT_ROUTES;
    stub(routesWithoutMeta);
    renderOverview();
    await screen.findByText("1,234");

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/could not load the retention/i);
    expect(screen.queryByRole("radiogroup", { name: /period/i })).not.toBeInTheDocument();
  });

  it("shows the same failure in a dimension panel's table pane that its chart pane shows", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        const url = new URL(String(input), "https://link.test");
        if (url.pathname === "/api/stats/dimension" && url.searchParams.get("name") === "device") {
          return Response.json({ error: "boom" }, { status: 500 });
        }
        const entry = DEFAULT_ROUTES[url.pathname];
        const resolved = typeof entry === "function" ? (entry as (u: URL) => unknown)(url) : entry;
        return resolved === undefined
          ? Response.json({ error: "not_found" }, { status: 404 })
          : Response.json(resolved);
      }),
    );
    renderOverview();
    await screen.findByText("1,234");

    const devicesHeading = await screen.findByText("Devices");
    const panel = devicesHeading.closest("section") as HTMLElement;
    expect(await within(panel).findByRole("alert")).toHaveTextContent(
      /could not load this breakdown/i,
    );

    await userEvent.click(within(panel).getByRole("button", { name: /table/i }));

    // Same failure in the table pane, not the false "successful empty
    // period" a plain `[]` table would render.
    expect(within(panel).getByRole("alert")).toHaveTextContent(/could not load this breakdown/i);
    expect(within(panel).queryByRole("table")).not.toBeInTheDocument();
  });

  it("shows an alert rather than four zeros when the summary fails to load", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        const url = new URL(String(input), "https://link.test");
        if (url.pathname === "/api/stats/summary") {
          return Response.json({ error: "boom" }, { status: 500 });
        }
        const entry = DEFAULT_ROUTES[url.pathname];
        const resolved = typeof entry === "function" ? (entry as (u: URL) => unknown)(url) : entry;
        return resolved === undefined
          ? Response.json({ error: "not_found" }, { status: 404 })
          : Response.json(resolved);
      }),
    );
    renderOverview();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/could not load/i);

    // Not four zeros: the KPI row renders only the alert while the summary
    // is in an error state, none of the four tiles (which would otherwise
    // read "0").
    const kpiRow = alert.closest(".grid") as HTMLElement;
    expect(within(kpiRow).queryByText("Clicks")).not.toBeInTheDocument();
    expect(within(kpiRow).queryByText("Unique visitors")).not.toBeInTheDocument();
    expect(within(kpiRow).queryByText("Countries reached")).not.toBeInTheDocument();
    expect(within(kpiRow).queryByText("Bot share")).not.toBeInTheDocument();
  });
});
