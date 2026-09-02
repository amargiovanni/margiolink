import { defineConfig, devices } from "@playwright/test";
import { BASE_URL } from "./fixtures";

/**
 * End-to-end coverage for what `jsdom` (the `web` Vitest project) structurally
 * cannot see: a real CSS cascade, real layout, a real focus model, a real
 * `<canvas>`, and real browser navigation. See the task brief
 * (`docs/superpowers/plans/2026-09-01-margiolink-dashboard.md`, Task 15) for
 * the four defects this suite exists to catch — each spec file names the
 * commit that fixed the defect it pins.
 *
 * Chromium only, deliberately: a second engine would double this suite's CI
 * time, and none of the four defects it targets (a router basename doubling,
 * a Tailwind variant compiling to the wrong selector, a canvas rasterisation
 * path, a CSV formula-injection escape) are engine-specific. This is a choice
 * to revisit if a Chromium-only bug ever slips through, not an oversight.
 */
export default defineConfig({
  testDir: ".",
  globalSetup: "./seed.ts",
  fullyParallel: true,
  // CI is the one place a `reuseExistingServer` webServer would silently hide
  // a startup failure behind someone else's leftover process.
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  // Traces, videos and downloaded artefacts (the QR PNG/SVG, the CSV) land
  // here. Relative to this config file's own directory (e2e/), so this
  // resolves to e2e/.artifacts, not e2e/e2e/.artifacts. Also gitignoring the
  // tool's own defaults (test-results/, playwright-report/) in case this
  // suite is ever run without --config e2e/playwright.config.ts.
  outputDir: ".artifacts",

  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  webServer: {
    command: "npm run build:web && npx wrangler dev --port 8787 --local",
    url: `${BASE_URL}/_health`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
