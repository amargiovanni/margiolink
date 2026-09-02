import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { usePeriodSelection } from "./usePeriodSelection";

afterEach(() => vi.unstubAllGlobals());

function stubMeta(response: unknown, status = 200) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json(response, { status })),
  );
}

function renderSelection(defaultPeriodId: "24h" | "7d" | "30d" | "90d" | "12m" = "7d") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return renderHook(() => usePeriodSelection(defaultPeriodId), { wrapper });
}

describe("usePeriodSelection", () => {
  it("offers no periods until retention is known, rather than guessing", () => {
    stubMeta({ retentionDays: 180, shortDomain: "link.test" });
    const { result } = renderSelection();
    expect(result.current.periods).toEqual([]);
    expect(result.current.periodNote).toBeNull();
  });

  it("filters to the periods safe at the deployment's real retention, once known", async () => {
    stubMeta({ retentionDays: 180, shortDomain: "link.test" });
    const { result } = renderSelection();
    await waitFor(() => expect(result.current.metaQuery.isSuccess).toBe(true));

    expect(result.current.periods.map((p) => p.id)).toEqual(["24h", "7d", "30d", "90d"]);
    expect(result.current.periodNote).toMatch(/180-day/);
  });

  it("offers every period, with no note, once retention comfortably covers all of them", async () => {
    stubMeta({ retentionDays: 1000, shortDomain: "link.test" });
    const { result } = renderSelection();
    await waitFor(() => expect(result.current.metaQuery.isSuccess).toBe(true));

    expect(result.current.periods.map((p) => p.id)).toEqual(["24h", "7d", "30d", "90d", "12m"]);
    expect(result.current.periodNote).toBeNull();
  });

  it("snaps a selection retention no longer supports to the longest period still offered", async () => {
    stubMeta({ retentionDays: 180, shortDomain: "link.test" });
    const { result } = renderSelection("12m");
    await waitFor(() => expect(result.current.metaQuery.isSuccess).toBe(true));

    await waitFor(() => expect(result.current.periodId).toBe("90d"));
  });

  it("keeps the default period selected once it still fits, without a spurious reset", async () => {
    stubMeta({ retentionDays: 180, shortDomain: "link.test" });
    const { result } = renderSelection("7d");
    await waitFor(() => expect(result.current.metaQuery.isSuccess).toBe(true));

    expect(result.current.periodId).toBe("7d");
  });

  it("offers no periods and reports the error when the retention window fails to load", async () => {
    stubMeta({ error: "boom" }, 500);
    const { result } = renderSelection();
    await waitFor(() => expect(result.current.metaQuery.isError).toBe(true));

    expect(result.current.periods).toEqual([]);
  });
});
