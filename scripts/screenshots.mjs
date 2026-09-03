#!/usr/bin/env node
// Takes every screenshot in `docs/screenshots/`, from a real Chromium driving
// a real Worker against the demo dataset.
//
//   npm run screenshots
//
// It builds the dashboard, seeds the local database, starts `wrangler dev`,
// drives the browser and shuts the server down again — one command, because a
// screenshot workflow with four manual steps is a screenshot workflow that
// stops being re-run and starts being a picture of a version nobody ships any
// more.
//
//   --keep-data   Do not re-seed. Use when the database already holds
//                 something specific you want photographed.
//   --only <pat>  Take only the shots whose name contains `pat`.
//
// One wrinkle worth knowing before it wastes an afternoon: the landing page
// embeds three of these screenshots (`web/index.html`), so a run that
// changes a dashboard shot leaves the landing shots one build behind — they
// were taken against the bundle built before the new images existed. Run it
// a second time and everything agrees. The check at the end of this file
// says so out loud rather than leaving it to be noticed in review.
//
// The dataset is deterministic (`scripts/demo-data.mjs`) and animations are
// disabled below, so re-running this on an unchanged UI produces images that
// differ only where the data legitimately moved on: `now` advances, so the
// last day of every chart and the "x minutes ago" in the live feed do change.
// That is the intended amount of nondeterminism — the alternative is freezing
// the clock, which would make every screenshot quietly six months old.

import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { chromium } from "@playwright/test";

const BASE_URL = process.env.SCREENSHOT_BASE_URL ?? "http://localhost:8787";
const OUT_DIR = "docs/screenshots";
const only = process.argv.includes("--only")
  ? process.argv[process.argv.indexOf("--only") + 1]
  : null;

/**
 * Credentials come from `.dev.vars`, unlike `e2e/fixtures.ts`, which
 * deliberately refuses to read it so the suite runs identically in CI. This
 * script is the opposite kind of thing: a local developer tool photographing
 * a local developer's database, where `.dev.vars` is exactly where the
 * credentials for that database live. The environment still wins, so a
 * differently-configured setup needs no edit here.
 */
function devVars() {
  const vars = {};
  if (existsSync(".dev.vars")) {
    for (const line of readFileSync(".dev.vars", "utf8").split("\n")) {
      const match = /^\s*([A-Z_]+)\s*=\s*(.*)$/.exec(line);
      if (match) vars[match[1]] = match[2].trim().replace(/^["']|["']$/g, "");
    }
  }
  return vars;
}

const vars = devVars();
const USERNAME = process.env.ADMIN_USER ?? vars.ADMIN_USER;
const PASSWORD = process.env.ADMIN_PASSWORD ?? vars.ADMIN_PASSWORD;

if (!USERNAME || !PASSWORD) {
  console.error(
    "screenshots: no ADMIN_USER/ADMIN_PASSWORD in the environment or .dev.vars.\n" +
      "Copy .dev.vars.example to .dev.vars and fill it in — see README, Running it locally.",
  );
  process.exit(1);
}

async function healthy() {
  try {
    const response = await fetch(`${BASE_URL}/_health`, {
      signal: AbortSignal.timeout(1500),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForHealth(deadlineMs = 90_000) {
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    if (await healthy()) return;
    await sleep(500);
  }
  throw new Error(`screenshots: ${BASE_URL}/_health never answered`);
}

/** Element screenshots of a chart panel need the panel, and `ChartFrame`
 *  renders every one as a `<section aria-labelledby>` — an ARIA region named
 *  by its own heading. Targeting the role rather than a class means these
 *  shots survive a restyle and break loudly on a renamed panel, which is the
 *  right way round. */
const panel = (page, name) => page.getByRole("region", { name });

/**
 * Switch the period picker.
 *
 * The radio inputs are `sr-only`, so Playwright's `.check()` refuses them as
 * invisible; the visible control is the `<label>` wrapping each one, which is
 * also what a mouse user actually clicks.
 *
 * Every dashboard shot picks a period explicitly rather than accepting the
 * 7-day default: over seven days the current, partial day is a seventh of the
 * chart and reads as a cliff. Over ninety it is one bar in ninety, which is
 * what it actually is.
 */
async function selectPeriod(page, label) {
  await page.getByRole("radiogroup", { name: "Period" }).getByText(label, { exact: true }).click();
}

/**
 * Every shot, in the order it is taken.
 *
 * `theme` sets both the app's own stored preference and the emulated OS
 * setting, so a page that reads either — the dashboard reads the first, the
 * three server-rendered pages (`/`, `/privacy`, the password interstitial)
 * read the second — is photographed in the theme it was asked for.
 */
const SHOTS = [
  {
    name: "landing-dark",
    scale: 1,
    theme: "dark",
    path: "/",
    fullPage: true,
    auth: false,
    ready: (page) => page.getByRole("heading", { level: 1 }).waitFor(),
  },
  {
    name: "landing-light",
    scale: 1,
    theme: "light",
    path: "/",
    fullPage: true,
    auth: false,
    ready: (page) => page.getByRole("heading", { level: 1 }).waitFor(),
  },
  {
    name: "landing-mobile",
    scale: 1,
    theme: "dark",
    path: "/",
    fullPage: true,
    auth: false,
    viewport: { width: 390, height: 844 },
    ready: (page) => page.getByRole("heading", { level: 1 }).waitFor(),
  },
  {
    name: "login",
    theme: "dark",
    path: "/app/login",
    auth: false,
    ready: (page) => page.getByRole("button", { name: "Sign in" }).waitFor(),
  },
  {
    name: "overview-dark",
    theme: "dark",
    path: "/app",
    fullPage: true,
    ready: async (page) => {
      await panel(page, "Clicks over time").waitFor();
      await selectPeriod(page, "90 days");
    },
  },
  {
    name: "overview-light",
    theme: "light",
    path: "/app",
    fullPage: true,
    ready: async (page) => {
      await panel(page, "Clicks over time").waitFor();
      await selectPeriod(page, "90 days");
    },
  },
  {
    name: "overview-mobile",
    scale: 1,
    theme: "dark",
    path: "/app",
    fullPage: true,
    viewport: { width: 390, height: 844 },
    ready: async (page) => {
      await panel(page, "Clicks over time").waitFor();
      await selectPeriod(page, "30 days");
    },
  },
  {
    name: "links-dark",
    theme: "dark",
    path: "/app/links",
    ready: (page) => page.getByRole("heading", { name: "Links", level: 1 }).waitFor(),
  },
  {
    name: "links-deleted-filter",
    theme: "dark",
    path: "/app/links",
    ready: async (page) => {
      await page.getByRole("heading", { name: "Links", level: 1 }).waitFor();
      // A Radix Select, not a native one — it renders a combobox trigger and
      // portals its options, the same way `e2e/delete-restore.spec.ts`
      // drives it.
      await page.getByRole("combobox", { name: "Status" }).click();
      await page.getByRole("option", { name: "Deleted" }).click();
      await page.getByText("old-landing").first().waitFor();
    },
  },
  {
    name: "command-palette",
    theme: "dark",
    path: "/app/links",
    ready: async (page) => {
      await page.getByRole("heading", { name: "Links", level: 1 }).waitFor();
      // Not "ControlOrMeta+K": Playwright's combo-string parser for
      // `keyboard.press()` does not recognise that token as a modifier, so
      // the event carries neither ctrlKey nor metaKey and the palette never
      // opens — the same trap `e2e/keyboard.spec.ts` documents at length.
      await page.keyboard.press(process.platform === "darwin" ? "Meta+K" : "Control+K");
      await page.getByPlaceholder("Jump to a link or section…").waitFor();
      await page.keyboard.type("doc");
    },
  },
  {
    name: "link-form",
    theme: "dark",
    path: "/app/links",
    ready: async (page) => {
      await page.getByRole("button", { name: "New link" }).click();
      await page.getByRole("dialog").waitFor();
    },
  },
  {
    name: "link-detail-dark",
    theme: "dark",
    path: "/app/links/2",
    ready: async (page) => {
      await panel(page, "Clicks over time").waitFor();
      await selectPeriod(page, "90 days");
    },
  },
  {
    name: "link-detail-full",
    scale: 1,
    theme: "dark",
    path: "/app/links/2",
    fullPage: true,
    ready: async (page) => {
      await panel(page, "Referrers").waitFor();
      await selectPeriod(page, "90 days");
    },
  },
  {
    name: "world-map",
    theme: "dark",
    path: "/app",
    clip: (page) => panel(page, "Clicks by country"),
    ready: async (page) => {
      await panel(page, "Clicks by country").waitFor();
      await selectPeriod(page, "90 days");
    },
  },
  {
    name: "heatmap",
    theme: "dark",
    path: "/app/links/2",
    clip: (page) => panel(page, "Activity by hour"),
    ready: async (page) => {
      await panel(page, "Activity by hour").waitFor();
      await selectPeriod(page, "90 days");
    },
  },
  {
    name: "time-series",
    theme: "dark",
    path: "/app",
    clip: (page) => panel(page, "Clicks over time"),
    ready: async (page) => {
      await panel(page, "Clicks over time").waitFor();
      await selectPeriod(page, "90 days");
    },
  },
  {
    name: "chart-table-view",
    theme: "dark",
    path: "/app",
    clip: (page) => panel(page, "Clicks over time"),
    ready: async (page) => {
      const frame = panel(page, "Clicks over time");
      await frame.waitFor();
      await selectPeriod(page, "90 days");
      // `ChartFrame`'s chart/table switch is a single toggle button whose
      // label is the view it switches *to*, so "Table" is the way in.
      await frame.getByRole("button", { name: "Table" }).click();
      await frame.getByRole("table").waitFor();
    },
  },
  {
    name: "qr-panel",
    theme: "dark",
    path: "/app/links/5",
    clip: (page) => page.getByRole("region", { name: "QR code" }),
    ready: (page) => page.getByRole("region", { name: "QR code" }).waitFor(),
  },
  {
    name: "live-feed",
    theme: "dark",
    path: "/app/links/2",
    clip: (page) => page.getByRole("region", { name: "Live feed" }),
    ready: (page) => page.getByRole("region", { name: "Live feed" }).waitFor(),
  },
  {
    name: "tags",
    theme: "dark",
    path: "/app/tags",
    ready: (page) => page.getByRole("heading", { name: "Tags", level: 1 }).waitFor(),
  },
  {
    name: "settings",
    scale: 1,
    theme: "dark",
    path: "/app/settings",
    fullPage: true,
    ready: (page) => page.getByRole("heading", { name: "Settings", level: 1 }).waitFor(),
  },
  {
    name: "password-interstitial",
    theme: "dark",
    path: "/beta-invite",
    auth: false,
    ready: (page) => page.getByRole("button", { name: "Continue" }).waitFor(),
  },
  {
    name: "privacy-notice",
    scale: 1,
    theme: "light",
    path: "/privacy",
    auth: false,
    fullPage: true,
    ready: (page) => page.getByRole("heading", { level: 1 }).waitFor(),
  },
];

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });

  const alreadyUp = await healthy();
  let server = null;

  if (!alreadyUp) {
    console.log("screenshots: building the dashboard");
    execFileSync("npm", ["run", "build:web"], {
      stdio: ["ignore", "ignore", "inherit"],
    });
  }

  if (!process.argv.includes("--keep-data")) {
    console.log("screenshots: seeding the local database");
    execFileSync("node", ["scripts/seed-demo.mjs"], {
      stdio: ["ignore", "ignore", "inherit"],
    });
  }

  if (!alreadyUp) {
    console.log("screenshots: starting wrangler dev");
    server = spawn("npx", ["wrangler", "dev", "--port", "8787", "--local"], {
      stdio: ["ignore", "ignore", "inherit"],
      // Detached so the whole process group can be killed: `npx` spawns
      // wrangler, which spawns workerd, and killing only the first would
      // leave the port held by a grandchild nobody has a handle to.
      detached: true,
    });
    await waitForHealth();
  } else {
    console.log(`screenshots: reusing the server already answering at ${BASE_URL}`);
  }

  const browser = await chromium.launch();

  try {
    for (const shot of SHOTS) {
      if (only && !shot.name.includes(only)) continue;

      const context = await browser.newContext({
        baseURL: BASE_URL,
        viewport: shot.viewport ?? { width: 1440, height: 900 },
        // Retina by default, because a README read on a laptop shows a 1×
        // screenshot of a text-dense dashboard as mush. `scale: 1` opts a
        // shot out — see the note on the long pages below, which are already
        // several thousand pixels tall before anything doubles them.
        deviceScaleFactor: shot.scale ?? 2,
        colorScheme: shot.theme,
        // Freezes every transition and the chart mount animations, so a shot
        // is never caught mid-fade.
        reducedMotion: "reduce",
      });

      // Before any page script runs, so the app boots already in the right
      // theme rather than flipping into it after first paint.
      await context.addInitScript(
        ([theme]) => {
          try {
            localStorage.setItem("margiolink:theme", theme);
          } catch {
            // A context with storage blocked still gets the OS-level
            // `colorScheme` above; the shot is correct either way.
          }
        },
        [shot.theme],
      );

      const page = await context.newPage();

      if (shot.auth !== false) {
        await page.goto("/app/login");
        await page.getByLabel("Username").fill(USERNAME);
        await page.getByLabel("Password").fill(PASSWORD);
        await page.getByRole("button", { name: "Sign in" }).click();
        await page.waitForURL((url) => url.pathname === "/app");
      }

      await page.goto(shot.path);
      await shot.ready(page);
      // Charts render from data that has already arrived, but fonts, the map's
      // projection and the QR canvas all land a frame or two later.
      await page.waitForLoadState("networkidle");
      await sleep(500);

      // Full-page shots are JPEG, everything else PNG.
      //
      // Not a preference — a size cliff. A full-page capture of the landing
      // is 4,000 px of gradient and film grain, close to the worst case for
      // PNG's predictors: the three landing shots alone came to 11 MB before
      // this rule, in a repository that has to carry them forever. The
      // viewport and element shots are flat UI with sharp text, where PNG is
      // both smaller and cleaner, so they keep it.
      const jpeg = Boolean(shot.fullPage) && !shot.clip;
      const file = `${OUT_DIR}/${shot.name}.${jpeg ? "jpg" : "png"}`;

      const target = shot.clip ? shot.clip(page) : page;
      await target.screenshot({
        path: file,
        fullPage: shot.clip ? undefined : shot.fullPage,
        ...(jpeg ? { type: "jpeg", quality: 88 } : {}),
      });

      console.log(`  ✓ ${file}`);

      await context.close();
    }
  } finally {
    await browser.close();
    if (server?.pid) {
      try {
        process.kill(-server.pid, "SIGTERM");
      } catch {
        // Already gone.
      }
    }
  }

  console.log(`\nscreenshots: done — ${OUT_DIR}/`);

  // The landing embeds three of the shots above. If the copy Vite baked into
  // `web/dist` is no longer byte-identical to the one this run just wrote,
  // the landing shots show the previous dashboard — compared by content
  // rather than by timestamp, since every run rewrites every file and a
  // mtime check would cry wolf on each one.
  const builtHtml = readFileSync("web/dist/index.html", "utf8");
  const embedded = [...builtHtml.matchAll(/src="\/assets\/(([\w-]+)-[\w-]{8}\.(png|jpg))"/g)];
  const stale = embedded.filter(([, builtFile, name, extension]) => {
    const source = join(OUT_DIR, `${name}.${extension}`);
    if (!existsSync(source)) return true;
    return !readFileSync(join("web/dist/assets", builtFile)).equals(readFileSync(source));
  });

  if (stale.length > 0 && !only) {
    console.log(
      `\nscreenshots: the landing embeds ${stale.map(([, , name]) => name).join(", ")} and was built\n` +
        "against an older copy of them. Run `npm run screenshots` once more so the\n" +
        "landing shots show the current dashboard.",
    );
  }
}

await main();
