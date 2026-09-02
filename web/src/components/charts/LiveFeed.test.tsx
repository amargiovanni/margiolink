import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LiveFeed } from "./LiveFeed";

function stub(body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json(body)),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function renderFeed() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <LiveFeed linkId={1} />
    </QueryClientProvider>,
  );
}

const CLICK = {
  id: 1,
  linkId: 1,
  slug: "demo",
  ts: Math.floor(Date.now() / 1000) - 120,
  country: "FR",
  city: "Paris",
  device: "mobile",
  browser: "Firefox",
  referrerType: "search",
  source: "link",
  outcome: "redirect",
  isBot: false,
};

describe("LiveFeed", () => {
  it("scopes the request to this link", async () => {
    stub({ clicks: [] });
    renderFeed();
    await waitFor(() => {
      const calls = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls;
      const call = calls.find((c) => String(c[0]).includes("/api/stats/live"));
      expect(call).toBeDefined();
      const url = new URL(String(call?.[0]), "https://link.test");
      expect(url.searchParams.get("linkId")).toBe("1");
    });
  });

  it("lists a recent click with its timestamp, country, device, channel and outcome", async () => {
    stub({ clicks: [CLICK] });
    renderFeed();
    expect(await screen.findByText("FR")).toBeInTheDocument();
    expect(screen.getByText("mobile")).toBeInTheDocument();
    expect(screen.getByText("Search")).toBeInTheDocument();
    expect(screen.getByText("Redirected")).toBeInTheDocument();
  });

  it("never wraps the list in a live region that announces itself every poll", async () => {
    stub({ clicks: [CLICK] });
    const { container } = renderFeed();
    await screen.findByText("FR");
    expect(container.querySelector("ul")).toHaveAttribute("aria-live", "off");
  });

  it("says 'No recent activity' rather than showing nothing when there are no clicks", async () => {
    stub({ clicks: [] });
    renderFeed();
    expect(await screen.findByText(/no recent activity/i)).toBeInTheDocument();
  });

  it("reports a feed failure rather than looking like a quiet link", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ error: "boom" }, { status: 500 })),
    );
    renderFeed();
    expect(await screen.findByRole("alert")).toHaveTextContent(/unavailable/i);
  });

  it("stops polling while paused, and fetches immediately on resume", async () => {
    stub({ clicks: [] });
    renderFeed();

    vi.useFakeTimers();
    try {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(screen.getByText(/live — updating every 10 seconds/i)).toBeInTheDocument();

      function callCount() {
        return (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.length;
      }
      const beforePause = callCount();

      act(() => {
        fireEvent.click(screen.getByRole("button", { name: /pause/i }));
      });
      expect(screen.getByText("Paused")).toBeInTheDocument();

      // Three intervals' worth of polling time, entirely under fake time — if
      // refetchInterval were not actually disabled while paused, this would
      // fire it at least once.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000);
      });
      expect(callCount()).toBe(beforePause);

      act(() => {
        fireEvent.click(screen.getByRole("button", { name: /resume/i }));
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(callCount()).toBeGreaterThan(beforePause);
      expect(screen.getByText(/live — updating every 10 seconds/i)).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});
