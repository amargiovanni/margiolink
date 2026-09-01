import { describe, expect, it } from "vitest";
import { granularityFor, PERIODS, rangeFor } from "./ranges";

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
