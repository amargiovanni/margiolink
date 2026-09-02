import { describe, expect, it } from "vitest";
import { droppedPeriodsNote, granularityFor, PERIODS, periodsFor, rangeFor } from "./ranges";

const HOUR = 3600;
const DAY = 86_400;

describe("granularityFor", () => {
  it("uses hours for a day or less", () => {
    expect(granularityFor(0, DAY)).toBe("hour");
  });

  it("uses days for a week", () => {
    expect(granularityFor(0, 7 * DAY)).toBe("day");
  });

  it("uses days for ninety days", () => {
    expect(granularityFor(0, 90 * DAY)).toBe("day");
  });

  it("uses weeks beyond ninety days, so a year is not 365 columns", () => {
    expect(granularityFor(0, 365 * DAY)).toBe("week");
  });

  it("never returns hour for a range that would exceed a readable column count", () => {
    expect(granularityFor(0, 3 * DAY)).not.toBe("hour");
  });

  // The inherited gap the reviewer found: the switch from hourly to daily
  // happens at exactly two days, and neither side of that boundary was
  // pinned by a test.
  it("stays hourly at exactly the two-day boundary", () => {
    expect(granularityFor(0, 2 * DAY)).toBe("hour");
  });

  it("switches to daily one second past the two-day boundary", () => {
    expect(granularityFor(0, 2 * DAY + 1)).toBe("day");
  });
});

describe("rangeFor", () => {
  it("produces a range whose end is not before its start", () => {
    for (const period of PERIODS) {
      const { from, to } = rangeFor(period.id, 1_800_000_000);
      expect(to).toBeGreaterThan(from);
    }
  });

  it("makes the 24h preset exactly one day wide", () => {
    const { from, to } = rangeFor("24h", 1_800_000_000);
    expect(to - from).toBe(DAY);
  });

  it("offers the presets the dashboard needs", () => {
    expect(PERIODS.map((p) => p.id)).toEqual(["24h", "7d", "30d", "90d", "12m"]);
  });

  it("uses whole hours so a refresh does not shift every bucket", () => {
    const { to } = rangeFor("7d", 1_800_000_123);
    expect(to % HOUR).toBe(0);
  });

  // Not in the brief, but load-bearing: an unrecognised id silently falling
  // back to "7d" (the brief's PERIODS[1] fallback) would hide a typo'd
  // period id as a wrong-but-plausible range instead of a visible bug.
  it("falls back to the 7d preset for an id that is not one of PERIODS'", () => {
    // @ts-expect-error deliberately passing an id outside PeriodId
    const fallback = rangeFor("bogus", 1_800_000_000);
    const sevenDay = rangeFor("7d", 1_800_000_000);
    expect(fallback).toEqual(sevenDay);
  });
});

describe("periodsFor", () => {
  // The deployment's real, deliberately unhardcoded retention window
  // (`RAW_RETENTION_DAYS` in `wrangler.jsonc`) — this is the exact figure
  // I1's ruling names: at 180 days, 12m's own comparison window (the
  // preceding 365 days) reaches back to day 730, entirely outside
  // retention, so it must be dropped while the other four survive.
  const DEPLOYED_RETENTION_DAYS = 180;

  it("drops exactly the periods whose comparison window falls outside retention", () => {
    expect(periodsFor(DEPLOYED_RETENTION_DAYS).map((p) => p.id)).toEqual([
      "24h",
      "7d",
      "30d",
      "90d",
    ]);
  });

  it("keeps every period once retention comfortably covers all of their comparison windows", () => {
    expect(periodsFor(1000).map((p) => p.id)).toEqual(PERIODS.map((p) => p.id));
  });

  // 12m's comparison window needs 2 * 365 = 730 days of retention exactly —
  // pinning both sides of that boundary the same way `granularityFor`'s own
  // boundary tests do above.
  it("keeps 12m when retention is exactly its 730-day requirement", () => {
    expect(periodsFor(730).map((p) => p.id)).toContain("12m");
  });

  it("drops 12m one day short of its 730-day requirement", () => {
    expect(periodsFor(729).map((p) => p.id)).not.toContain("12m");
  });

  it("drops every period once retention is too short even for 24h's own comparison window", () => {
    expect(periodsFor(1)).toEqual([]);
  });
});

describe("droppedPeriodsNote", () => {
  it("names the retention window when a period was dropped", () => {
    const note = droppedPeriodsNote(180);
    expect(note).not.toBeNull();
    expect(note).toMatch(/180/);
  });

  it("says nothing when retention drops nothing off the list", () => {
    expect(droppedPeriodsNote(1000)).toBeNull();
  });
});
