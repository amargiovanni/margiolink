import { describe, expect, it } from "vitest";
import { formatCount, formatDateTime, formatDelta, formatRelative } from "./format";

describe("formatCount", () => {
  it("is exact below the compact threshold", () => {
    expect(formatCount(0)).toBe("0");
    expect(formatCount(847)).toBe("847");
  });

  it("stays exact right at the boundary", () => {
    expect(formatCount(9999)).toBe("9,999");
  });

  it("goes compact once it crosses the boundary", () => {
    expect(formatCount(10_000)).toBe("10K");
  });

  it("is compact above the boundary", () => {
    expect(formatCount(12_345)).toBe("12.3K");
  });
});

describe("formatDelta", () => {
  it("reports a rise", () => {
    expect(formatDelta(150, 100)).toEqual({ text: "+50%", direction: "up" });
  });

  it("reports a fall", () => {
    expect(formatDelta(50, 100)).toEqual({ text: "-50%", direction: "down" });
  });

  it("reports an exact zero change", () => {
    expect(formatDelta(100, 100)).toEqual({ text: "0%", direction: "flat" });
  });

  it("reports no change when both current and previous are zero", () => {
    // Guards the division-by-zero branch: previous === 0 would otherwise feed
    // ((current - previous) / previous) * 100 and produce NaN/Infinity%.
    expect(formatDelta(0, 0)).toEqual({ text: "no change", direction: "flat" });
  });

  it("reports 'new' when previous is zero and current is not", () => {
    expect(formatDelta(5, 0)).toEqual({ text: "new", direction: "up" });
  });
});

describe("formatRelative", () => {
  // An explicit `now` keeps this independent of the clock the test happens to run on.
  const now = 1_700_000_000_000;

  it("lands in minutes", () => {
    expect(formatRelative(now / 1000 - 5 * 60, now)).toBe("5 minutes ago");
  });

  it("lands in hours", () => {
    expect(formatRelative(now / 1000 - 2 * 3600, now)).toBe("2 hours ago");
  });

  it("lands in days", () => {
    expect(formatRelative(now / 1000 - 3 * 86_400, now)).toBe("3 days ago");
  });
});

describe("formatDateTime", () => {
  // Deliberately not pinning an exact string: the format is locale-dependent
  // (date/time order, separators, 12h vs 24h) and asserting one literal
  // rendering would fail on a machine or CI runner with different locale
  // settings even though the function is correct. A non-empty string
  // containing the year is the property this function actually owes.
  it("produces a non-empty string containing the year", () => {
    const result = formatDateTime(1_700_000_000);
    expect(result.length).toBeGreaterThan(0);
    expect(result).toContain(String(new Date(1_700_000_000 * 1000).getFullYear()));
  });
});
