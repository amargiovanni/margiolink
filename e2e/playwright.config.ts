import { defineConfig, devices } from "@playwright/test";
import { BASE_URL, CREDENTIALS, HASH_SECRET } from "./fixtures";

/** `webServer.command` (below) is a single string handed to `child_process
 *  .spawn(command, { shell: true })` (confirmed by reading Playwright's own
 *  runner) — POSIX `/bin/sh -c` locally and in CI (`ubuntu-latest`), which
 *  parses it exactly like a typed command line: unquoted `$`, backticks,
 *  spaces and quote characters in an interpolated value are not inert text,
 *  they are shell syntax. `CREDENTIALS`/`HASH_SECRET` are fixed literals
 *  today with no such characters, but a value built into a shell command
 *  string is a loaded gun for whoever next parameterises it from the
 *  environment — the same family of mistake as the commit-message incident
 *  in the Task 15 report (unescaped content reaching a shell that parses
 *  it). `shellQuoteSingle` wraps each value in single quotes, POSIX's own
 *  "everything inside is literal" quoting, with any embedded single quote
 *  escaped by closing the quote, emitting an escaped one, and reopening it —
 *  the standard idiom, since a single-quoted string cannot itself contain a
 *  single quote. */
function shellQuoteSingle(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

/** `wrangler dev`'s `--var KEY:VALUE` overrides a same-named `.dev.vars`
 *  entry (verified interactively — see the comment on `CREDENTIALS` in
 *  `fixtures.ts`), so the suite supplies its own environment on the command
 *  line and never reads or writes `.dev.vars` at all: the local path and the
 *  CI path (which has no `.dev.vars` to begin with) are the same path. */
const WRANGLER_VARS: [string, string][] = [
  ["ADMIN_USER", CREDENTIALS.username],
  ["ADMIN_PASSWORD", CREDENTIALS.password],
  ["HASH_SECRET", HASH_SECRET],
];
const WRANGLER_VARS_ARGS = WRANGLER_VARS.map(
  ([key, value]) => `--var ${key}:${shellQuoteSingle(value)}`,
).join(" ");

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

  // Serial on CI, parallel locally. Every spec talks to ONE `wrangler dev`,
  // and workerd is single-threaded — so parallel browser contexts do not
  // share a load, they queue behind each other on a shared runner with a
  // fraction of a developer machine's cores. The first CI run of this suite
  // after `delete-restore.spec.ts` landed showed exactly that: the QR decode
  // took 40.8s against 16.5s locally and the delete-restore flow 31.4s
  // against 0.9s, both past the 30s default, with workerd logging broken
  // pipes as Playwright abandoned requests it had already given up on.
  //
  // The whole suite runs in ~23s locally, so serialising costs a little wall
  // clock and buys back the entire class of cross-spec interference on one
  // shared Worker. Locally, leave it parallel: a developer machine has the
  // cores for it and the feedback loop matters more there.
  workers: process.env.CI ? 1 : undefined,

  // The default 30s is a developer-machine number. Nothing here is slow by
  // design — the QR test decodes a 1024px image inside the browser, which is
  // genuinely CPU-bound — so a slower runner needs headroom rather than a
  // weaker assertion. Raised only on CI, so a local test that takes this long
  // still fails and gets looked at.
  timeout: process.env.CI ? 60_000 : 30_000,

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
    command: `npm run build:web && npx wrangler dev --port 8787 --local ${WRANGLER_VARS_ARGS}`,
    url: `${BASE_URL}/_health`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
