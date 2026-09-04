import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import {
  type DimensionResponse,
  type StatsMeta,
  type SummaryResponse,
  type TimeseriesResponse,
  type TopLinksResponse,
  useSummary,
} from "./queries";

const STATS_META: StatsMeta = {
  requestedFrom: 0,
  effectiveFrom: 0,
  retentionCutoff: 0,
  truncated: false,
  uniquesDefinition: "daily-rotating-visitor-hash",
};

/** Responds by `linkId`, distinguishing "no linkId at all" from any
 *  specific one, so a mutation that drops `linkId` from the request
 *  params (as opposed to the query key) would also be visible here. */
function stubByLinkId(responses: Record<string, { current: { clicks: number } }>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) => {
      const url = new URL(String(input), "https://link.test");
      const linkId = url.searchParams.get("linkId") ?? "";
      const body = responses[linkId];
      if (!body) return Response.json({ error: "not_found" }, { status: 404 });
      return Response.json({
        ...body,
        previous: { clicks: 0, uniques: 0, bots: 0, countries: 0 },
        range: { from: 0, to: 100 },
        meta: STATS_META,
      });
    }),
  );
}

afterEach(() => vi.unstubAllGlobals());

/**
 * This is the exact hazard Task 11's Step 0 was written to prevent: if
 * `linkId` were part of a query's request params but *not* part of its
 * `queryKey`, React Query would treat "link 1's summary" and "link 2's
 * summary" as the same cache entry. A page that switches which link it is
 * showing (or, as here, a hook whose `linkId` argument changes across a
 * re-render) would then silently keep serving the first link's numbers —
 * every existing test that only checks the request URL still passes,
 * because the URL itself is built correctly; only the *cache* is wrong.
 */
describe("useSummary — cross-link cache isolation", () => {
  it("shares retained-range metadata across every range response type", () => {
    expectTypeOf<SummaryResponse["meta"]>().toEqualTypeOf<StatsMeta>();
    expectTypeOf<TimeseriesResponse["meta"]>().toEqualTypeOf<StatsMeta>();
    expectTypeOf<DimensionResponse["meta"]>().toEqualTypeOf<StatsMeta>();
    expectTypeOf<TopLinksResponse["meta"]>().toEqualTypeOf<StatsMeta>();
  });

  it("does not serve one link's cached summary for a different link's query", async () => {
    stubByLinkId({
      "1": { current: { clicks: 111 } },
      "2": { current: { clicks: 222 } },
    });

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    function wrapper({ children }: { children: ReactNode }) {
      return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    }

    const { result, rerender } = renderHook(
      ({ linkId }: { linkId: number }) => useSummary({ from: 0, to: 100, linkId }),
      { wrapper, initialProps: { linkId: 1 } },
    );

    await waitFor(() => expect(result.current.data?.current.clicks).toBe(111));
    expect(result.current.data?.meta).toStrictEqual(STATS_META);

    rerender({ linkId: 2 });

    // Not 111: a query key that omitted `linkId` would keep resolving to
    // the same cache entry across this re-render, and this would time out
    // still showing link 1's value.
    await waitFor(() => expect(result.current.data?.current.clicks).toBe(222));
  });
});
