import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Settings from "./Settings";

const CURRENT_SESSION = {
  id: "sess-current",
  createdAt: 1_800_000_000,
  lastSeenAt: 1_800_000_000,
  expiresAt: 1_800_600_000,
  device: "Chrome on macOS",
  current: true,
};

const OTHER_SESSION = {
  id: "sess-other",
  createdAt: 1_799_000_000,
  lastSeenAt: 1_799_500_000,
  expiresAt: 1_799_600_000,
  device: "Safari on iOS",
  current: false,
};

const META = { retentionDays: 180, shortDomain: "link.margio.uk" };

const LINK = {
  id: 1,
  slug: "launch",
  shortUrl: "https://link.margio.uk/launch",
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
  tags: [],
};

function stub(routes: Record<string, unknown>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = new URL(String(input), "https://link.test");
      const key = `${init?.method ?? "GET"} ${url.pathname}`;
      const body = routes[key] ?? routes[url.pathname];
      if (body === undefined) return Response.json({ error: "not_found" }, { status: 404 });
      if (body instanceof Response) return body;
      if (typeof body === "function") return body(url);
      return Response.json(body);
    }),
  );
}

afterEach(() => vi.unstubAllGlobals());

beforeEach(() => {
  // jsdom implements no Object URL machinery at all — the export button
  // goes through exactly this path (mirroring QrPanel's PNG download), so a
  // real click handler would throw without these.
  URL.createObjectURL = vi.fn(() => "blob:mock");
  URL.revokeObjectURL = vi.fn();
});

function renderSettings() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Settings />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const BASE_ROUTES = {
  "GET /api/auth/sessions": { sessions: [CURRENT_SESSION, OTHER_SESSION] },
  "GET /api/meta": META,
  "GET /api/stats/sparklines": { days: 7, series: { "1": [0, 1, 2, 0, 3, 1, 4] } },
};

describe("Settings", () => {
  it("lists active sessions with a device label and last-seen time, marking the current one", async () => {
    stub(BASE_ROUTES);
    renderSettings();

    expect(await screen.findByText("Chrome on macOS")).toBeInTheDocument();
    expect(screen.getByText("Safari on iOS")).toBeInTheDocument();
    expect(screen.getByText(/current/i)).toBeInTheDocument();
  });

  it("omits an individual revoke control on the current session", async () => {
    stub(BASE_ROUTES);
    renderSettings();
    await screen.findByText("Chrome on macOS");

    const currentRow = screen.getByText("Chrome on macOS").closest("li");
    const otherRow = screen.getByText("Safari on iOS").closest("li");
    expect(currentRow).not.toBeNull();
    expect(otherRow).not.toBeNull();

    expect(within(currentRow as HTMLElement).queryByRole("button", { name: /revoke/i })).toBeNull();
    expect(
      within(otherRow as HTMLElement).getByRole("button", { name: /revoke/i }),
    ).toBeInTheDocument();
  });

  it("asks for confirmation before revoking all other sessions", async () => {
    stub(BASE_ROUTES);
    renderSettings();
    await screen.findByText("Chrome on macOS");

    await userEvent.click(screen.getByRole("button", { name: /revoke all other sessions/i }));

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toBeInTheDocument();
    const calls = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    expect(
      calls.some(
        (c) =>
          String(c[0]).includes("/api/auth/sessions") && (c[1] as RequestInit)?.method === "DELETE",
      ),
    ).toBe(false);
  });

  it("drops revoked sessions from the list once 'Revoke all other sessions' succeeds", async () => {
    // A revoked session that keeps showing as active is the worst possible
    // answer to "did that work?" — it invites a retry rather than trust.
    let revoked = false;
    stub({
      ...BASE_ROUTES,
      "GET /api/auth/sessions": () =>
        Response.json({
          sessions: revoked ? [CURRENT_SESSION] : [CURRENT_SESSION, OTHER_SESSION],
        }),
      "DELETE /api/auth/sessions": () => {
        revoked = true;
        return Response.json({ ok: true });
      },
    });
    renderSettings();
    await screen.findByText("Safari on iOS");

    await userEvent.click(screen.getByRole("button", { name: "Revoke all other sessions" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Revoke all" }));

    await waitFor(() => {
      expect(screen.queryByText("Safari on iOS")).not.toBeInTheDocument();
    });
  });

  it("shows the retention window as a read-only fact naming where it's set", async () => {
    stub(BASE_ROUTES);
    renderSettings();

    const dataSection = screen.getByRole("region", { name: /^data$/i });
    expect(await within(dataSection).findByText(/180 days/)).toBeInTheDocument();
    expect(within(dataSection).getByText(/RAW_RETENTION_DAYS/)).toBeInTheDocument();
    expect(within(dataSection).getByText(/Worker/)).toBeInTheDocument();
    // Read-only: no input or button claims to let this be edited.
    expect(within(dataSection).queryByRole("spinbutton", { name: /retention/i })).toBeNull();
  });

  it("exports what the API returns, paging through every page of links, with the click-count column filled in", async () => {
    stub({
      ...BASE_ROUTES,
      "GET /api/links": (url: URL) => {
        const offset = Number(url.searchParams.get("offset") ?? "0");
        if (offset === 0) return Response.json({ links: [LINK], total: 1 });
        return Response.json({ links: [], total: 1 });
      },
    });
    renderSettings();
    await screen.findByText("Chrome on macOS");

    await userEvent.click(screen.getByRole("button", { name: /export/i }));

    await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalled());
    const blob = (URL.createObjectURL as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as Blob;
    const text = await blob.text();
    const [headerLine, ...rowLines] = text.replace(/^﻿/, "").split("\r\n");
    const header = headerLine?.split(",") ?? [];
    const clicksColumn = header.indexOf("clicks_last_7_days");
    expect(clicksColumn).toBeGreaterThanOrEqual(0);

    const row = rowLines.find((line) => line.includes("launch"))?.split(",") ?? [];
    expect(row).toContain("https://example.com/launch");
    // BASE_ROUTES' sparklines series for link id 1 is [0, 1, 2, 0, 3, 1, 4],
    // which sums to 11 — pinning the value, not just the column's presence,
    // so a wrong sum (e.g. always 0, or the wrong link's series) still fails
    // this even though the column itself exists.
    expect(row[clicksColumn]).toBe("11");
  });

  it("neutralises a field that would otherwise be read as a formula on open", async () => {
    const injected = { ...LINK, title: "=1+1" };
    stub({
      ...BASE_ROUTES,
      "GET /api/links": (url: URL) => {
        const offset = Number(url.searchParams.get("offset") ?? "0");
        if (offset === 0) return Response.json({ links: [injected], total: 1 });
        return Response.json({ links: [], total: 1 });
      },
    });
    renderSettings();
    await screen.findByText("Chrome on macOS");

    await userEvent.click(screen.getByRole("button", { name: /export/i }));

    await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalled());
    const blob = (URL.createObjectURL as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as Blob;
    const text = await blob.text();
    // The literal title never appears un-neutralised: every occurrence of
    // "=1+1" in the file is preceded by the defusing single quote.
    expect(text).not.toMatch(/(?<!')=1\+1/);
    expect(text).toContain("'=1+1");
  });

  it("prefixes the file with a UTF-8 BOM, so non-ASCII fields don't render as mojibake in Excel", async () => {
    stub({
      ...BASE_ROUTES,
      "GET /api/links": (url: URL) => {
        const offset = Number(url.searchParams.get("offset") ?? "0");
        if (offset === 0) return Response.json({ links: [LINK], total: 1 });
        return Response.json({ links: [], total: 1 });
      },
    });
    renderSettings();
    await screen.findByText("Chrome on macOS");

    await userEvent.click(screen.getByRole("button", { name: /export/i }));

    await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalled());
    const blob = (URL.createObjectURL as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as Blob;
    const bytes = new Uint8Array(await blob.arrayBuffer()).slice(0, 3);
    expect(Array.from(bytes)).toEqual([0xef, 0xbb, 0xbf]);
  });

  it("says the export failed rather than downloading a partial file when a later page fails", async () => {
    let call = 0;
    stub({
      ...BASE_ROUTES,
      "GET /api/links": () => {
        call += 1;
        if (call === 1) {
          // 60 fake links so a second page is required, then that page 500s.
          return Response.json({
            links: Array.from({ length: 50 }, (_, i) => ({ ...LINK, id: i + 1, slug: `l${i}` })),
            total: 60,
          });
        }
        return Response.json({ error: "boom" }, { status: 500 });
      },
    });
    renderSettings();
    await screen.findByText("Chrome on macOS");

    await userEvent.click(screen.getByRole("button", { name: /export/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/could not export|export failed/i);
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it("signs out to this app's own login route", async () => {
    stub({ ...BASE_ROUTES, "POST /api/auth/logout": { ok: true } });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        {/* Mirrors App.tsx's real route shape: Settings and Login both sit
         *  under the `/app` basename as basename-relative routes, and
         *  `BrowserRouter basename="/app"` (main.tsx) prepends "/app" to
         *  every `navigate()` target on its own. A target that already
         *  carried an extra `/app` prefix would match no route here and
         *  this test would find nothing, rather than the marker below. */}
        <MemoryRouter basename="/app" initialEntries={["/app/settings"]}>
          <Routes>
            <Route path="/settings" element={<Settings />} />
            <Route path="/login" element={<div>Signed out</div>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await screen.findByText("Chrome on macOS");

    await userEvent.click(screen.getByRole("button", { name: /sign out/i }));

    expect(await screen.findByText("Signed out")).toBeInTheDocument();
  });
});
