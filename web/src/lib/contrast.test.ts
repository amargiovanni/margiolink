import { describe, expect, it } from "vitest";
import { contrastRatio, hexToRgb, readableTextColor, relativeLuminance } from "./contrast";

// (crossover luminance + 0.05) / 0.05, see contrast.ts — the ratio both
// choices tie at, and therefore the floor `readableTextColor` guarantees
// against any background whatsoever.
const GUARANTEED_MIN_RATIO = 4.58;

function parse(hex: string) {
  const rgb = hexToRgb(hex);
  if (!rgb) throw new Error(`invalid hex used in test fixture: ${hex}`);
  return rgb;
}

function ratioForChosenColor(hex: string): number {
  const rgb = parse(hex);
  const backgroundLuminance = relativeLuminance(rgb);
  const choice = readableTextColor(rgb);
  return choice === "black"
    ? contrastRatio(backgroundLuminance, 0)
    : contrastRatio(backgroundLuminance, 1);
}

describe("readableTextColor", () => {
  // The property that actually pins the crossover number: whichever colour
  // is chosen must clear the guaranteed ratio against *every* background,
  // not just one. A threshold of 0.2, 0.3 or 0.4 instead of the correct
  // ~0.179129 would still pass a test that only checks "#199e70" — these
  // two backgrounds straddle the true crossover on opposite sides and both
  // fail under a threshold that's merely close.
  // Each comment names why the colour is in this table — the table itself
  // only needs the hex value.
  it.each([
    "#199e70", // the spring tag colour from the Links fixture, L≈0.258
    "#2a78d6", // just above the crossover, L≈0.188
    "#008300", // just below the crossover, L≈0.162
    "#000000", // pure black
    "#ffffff", // pure white
    "#e66767", // the critical token colour
    "#8a5e12", // the light-mode accent colour
  ])("guarantees at least a 4.58:1 ratio against %s", (hex) => {
    expect(ratioForChosenColor(hex)).toBeGreaterThanOrEqual(GUARANTEED_MIN_RATIO - 0.01);
  });

  it("picks black for a background just above the crossover", () => {
    // #2a78d6 (L≈0.188): the old (wrong) 0.55 threshold picked white here,
    // at a losing ~3.99:1, where black wins at ~5.27:1.
    expect(readableTextColor(parse("#2a78d6"))).toBe("black");
  });

  it("picks white for a background just below the crossover", () => {
    // #008300 (L≈0.162): the old threshold also picked white here — this
    // time correctly, but only by accident, since 0.55 has nothing to do
    // with the real crossover.
    expect(readableTextColor(parse("#008300"))).toBe("white");
  });

  it("picks black over white for the fixture's own spring tag", () => {
    // #199e70 (L≈0.258): black gives ~6.17:1, white only ~3.41:1 — the
    // defect this whole fix closes.
    expect(readableTextColor(parse("#199e70"))).toBe("black");
  });
});

describe("hexToRgb", () => {
  it("parses a 6-digit hex colour, with or without the leading #", () => {
    expect(hexToRgb("#199e70")).toEqual({ r: 0x19, g: 0x9e, b: 0x70 });
    expect(hexToRgb("199e70")).toEqual({ r: 0x19, g: 0x9e, b: 0x70 });
  });

  it("rejects the 3-digit shorthand and anything else that isn't 6 hex digits", () => {
    expect(hexToRgb("#fff")).toBeNull();
    expect(hexToRgb("not-a-color")).toBeNull();
    expect(hexToRgb("")).toBeNull();
  });
});
