import { describe, expect, it } from "vitest";
// Vite's `?raw` import returns the file's contents as a string, typed by
// `vite/client` (already in this project's `types`) — no Node type
// declarations needed, and no environment override to read a file from disk.
import css from "./tokens.css?raw";

// Exactly the values spec §6.3 records as validated. Changing one means
// re-running the palette validator, not editing this test.
const DARK_SERIES = [
  "#3987e5",
  "#d95926",
  "#199e70",
  "#c98500",
  "#d55181",
  "#008300",
  "#9085e9",
  "#e66767",
];
const LIGHT_SERIES = [
  "#2a78d6",
  "#eb6834",
  "#1baf7a",
  "#eda100",
  "#e87ba4",
  "#008300",
  "#4a3aa7",
  "#e34948",
];
const DARK_RAMP = ["#1e4d7e", "#3670ae", "#5c95ce", "#8cb9e2", "#bbd7f0"];
const LIGHT_RAMP = ["#7fadd8", "#4e8fcb", "#2a6fb5", "#1a4e85", "#0e2f53"];

describe("design tokens", () => {
  it.each(DARK_SERIES.map((hex, i) => [i + 1, hex] as const))(
    "keeps the validated dark categorical slot %i",
    (slot, hex) => {
      expect(css).toContain(`--color-series-${slot}: ${hex};`);
    },
  );

  it.each(LIGHT_SERIES.map((hex, i) => [i + 1, hex] as const))(
    "keeps the validated light categorical slot %i",
    (slot, hex) => {
      expect(css).toContain(`--color-series-${slot}: ${hex};`);
    },
  );

  it("keeps both validated sequential ramps", () => {
    for (const hex of [...DARK_RAMP, ...LIGHT_RAMP]) {
      expect(css).toContain(hex);
    }
  });

  it("declares the light palette under both the OS query and the explicit toggle", () => {
    expect(css).toContain("@media (prefers-color-scheme: light)");
    expect(css).toContain(':root[data-theme="light"]');
  });

  it("keeps the accent out of the series slots", () => {
    // The accent must never be reachable as a data colour.
    const seriesBlock = css.match(/--color-series-\d: #[0-9a-f]{6};/g) ?? [];
    expect(seriesBlock.join(" ")).not.toContain("#d89b2e");
    expect(seriesBlock.join(" ")).not.toContain("#8a5e12");
  });
});
