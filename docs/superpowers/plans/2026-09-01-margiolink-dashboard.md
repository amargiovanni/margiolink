# MargioLink Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A responsive administrative dashboard for MargioLink — create and manage short links, and read their analytics — served by the existing Worker and built against its existing API.

**Architecture:** A React single-page application under `/app`, built by Vite and served from Cloudflare Workers Static Assets by the same Worker that serves the redirect. It talks only to the API already shipped on this Worker, using the session cookie the login endpoint sets. Charts are hand-rolled SVG over `d3-scale` and `d3-shape` rather than a charting component library, because the design system's mark specifications are precise and fighting a library's defaults costs more than drawing the marks.

**Tech Stack:** React 19, React Router 7, TanStack Query 5, Tailwind CSS 4, Radix primitives, `d3-scale` / `d3-shape` / `d3-geo`, Vite 7, Vitest with jsdom and Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-01-margiolink-design.md` — sections 6.1 through 6.4 are this plan's requirements. **Read §6.3 and §6.4 before Task 5**; they carry the palette, the type choices and the chart rules, and they are binding rather than advisory.

## Global Constraints

- **The API is fixed.** This plan adds no backend routes and changes no existing ones. If a screen seems to need an endpoint that does not exist, stop and report it rather than inventing one.
- **Everything in the repo is English** — code, identifiers, comments, commit messages.
- **Fonts are self-hosted.** A product whose defining claim is that it makes no third-party request must not fetch its own dashboard's fonts from a CDN.
- **The data palette is computed and must not be re-picked.** Categorical, sequential and accent values are fixed in spec §6.3. Adding a colour means running the validator, not choosing one.
- **Light mode's categorical palette carries a contrast warning**, and the relief is mandatory: every chart with more than one series ships visible direct labels *and* a reachable table view.
- **All-pairs chart forms are capped at three series** — the choropleth and any scatter. Past three, fold into "Other" or facet.
- **The accent colour never encodes data.** Amber is for buttons, focus rings, active navigation and the selected period only.
- **One y-axis per chart. Never two scales.**
- **Target WCAG 2.2 level AA.** Keyboard operable throughout, focus always visible, no information carried by colour alone, `prefers-reduced-motion` respected.
- **Tabular figures** (`font-variant-numeric: tabular-nums`) on every number that can change, so digits do not jitter.
- **Every task ships with at least one test.** Frontend tests run under jsdom with Testing Library and assert behaviour a user can observe — never implementation detail.
- **Commit format** `type(scope): imperative subject`, at most 72 characters, English. One commit per task.
- **Branch:** all work on `feature/ML-3-dashboard`.
- **Node 24**, per `.nvmrc`.

---

## File structure

```
web/
├── index.html                     SPA entry, mounted under /app
├── vite.config.ts                 base "/app/", React + Tailwind plugins
└── src/
    ├── main.tsx                   root render, providers
    ├── App.tsx                    routes
    ├── styles/
    │   ├── tokens.css             @theme — the computed palette, type, spacing
    │   └── app.css                base layer, font faces, reduced-motion
    ├── lib/
    │   ├── api.ts                 typed fetch client; one place that knows URLs
    │   ├── queries.ts             TanStack Query hooks, one per endpoint
    │   ├── format.ts              numbers, dates, durations, deltas
    │   └── ranges.ts              period presets and the granularity rule
    ├── components/
    │   ├── ui/                    Button, Field, Select, Dialog, Tooltip,
    │   │                          Switch, Tabs, Badge, EmptyState, Skeleton
    │   ├── charts/
    │   │   ├── ChartFrame.tsx     title, legend, table toggle — the relief rule
    │   │   ├── TableView.tsx      every chart's accessible twin
    │   │   ├── Sparkline.tsx      no axes, no tooltip, pure trend
    │   │   ├── StatTile.tsx       hero number, delta, sparkline
    │   │   ├── RankedBars.tsx     magnitude with direct labels
    │   │   ├── TimeSeries.tsx     area/bar with crosshair and tooltip
    │   │   ├── Heatmap.tsx        hour by weekday, sequential ramp
    │   │   └── WorldMap.tsx       choropleth, lazy-loaded
    │   ├── layout/                AppShell, PrimaryNav, ThemeToggle
    │   └── links/                 LinkRow, LinkForm, LinkDialog, QrPanel,
    │                              TagPicker, CommandPalette
    └── pages/
        ├── Login.tsx  Overview.tsx  Links.tsx  LinkDetail.tsx  Settings.tsx
```

**One deviation from the spec, stated up front.** Spec §6.1 names four screens;
this plan has five. Tags need somewhere to be created, renamed and deleted, and
burying that inside Settings would mix "things I own" with "how this deployment
is configured". The tag *filter* stays on the links list where §6.1 puts it; only
tag management moves to its own page.

Charts are split one per file deliberately: each carries its own mark
specification from spec §6.4, and a reviewer should be able to check one
against the spec without reading the others.

---

## Task 1: SPA scaffold, asset wiring and design tokens

**Files:**
- Create: `web/index.html`, `web/vite.config.ts`, `web/tsconfig.json`, `web/src/main.tsx`, `web/src/App.tsx`, `web/src/styles/tokens.css`, `web/src/styles/app.css`
- Modify: `wrangler.jsonc`, `package.json`, `src/routes/public.ts`, `vitest.config.ts`, `.gitignore`
- Test: `test/routes/spa.test.ts`, `web/src/styles/tokens.test.ts`

**Interfaces:**
- Consumes: the existing Worker and its `Env`.
- Produces: an `ASSETS` binding on `Env`; the `/app` and `/app/*` routes serving the SPA shell; the CSS custom properties every later task styles against.

- [ ] **Step 1: Install the frontend dependencies**

These are additions to the list the user approved for the backend. Install exactly these and nothing more.

```bash
npm install react react-dom react-router @tanstack/react-query \
  @radix-ui/react-dialog @radix-ui/react-dropdown-menu @radix-ui/react-select \
  @radix-ui/react-tabs @radix-ui/react-tooltip @radix-ui/react-switch \
  @radix-ui/react-label @radix-ui/react-popover \
  cmdk sonner lucide-react react-hook-form @hookform/resolvers \
  clsx tailwind-merge date-fns \
  d3-scale d3-shape d3-geo topojson-client world-atlas \
  @fontsource-variable/fraunces @fontsource/ibm-plex-sans

npm install -D vite @vitejs/plugin-react tailwindcss @tailwindcss/vite \
  jsdom @testing-library/react @testing-library/user-event @testing-library/jest-dom \
  @types/react @types/react-dom @types/d3-scale @types/d3-shape @types/d3-geo \
  @types/topojson-client
```

Note there is no charting library. That is deliberate — spec §6.4 explains why.

- [ ] **Step 2: Write `web/vite.config.ts`**

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  // The SPA lives under /app so that the Worker's single-segment redirect
  // route (/:slug) can never be shadowed by an asset path.
  base: "/app/",
  plugins: [react(), tailwindcss()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    // The world atlas is ~90KB gzipped and only the map needs it.
    chunkSizeWarningLimit: 700,
  },
});
```

- [ ] **Step 3: Write `web/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex" />
    <title>MargioLink</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 4: Write `web/src/styles/tokens.css`**

Every value here comes from spec §6.3 and was produced by the palette validator. Do not adjust a hex.

```css
@import "tailwindcss";

@theme {
  --font-display: "Fraunces Variable", Georgia, serif;
  --font-sans: "IBM Plex Sans", system-ui, sans-serif;

  --color-surface: #12100e;
  --color-surface-raised: #1a1714;
  --color-surface-sunken: #0c0a09;
  --color-rule: #2c2823;
  --color-ink: #f6f2ea;
  --color-ink-muted: #a8a094;
  --color-ink-faint: #6f675c;

  --color-accent: #d89b2e;
  --color-accent-ink: #12100e;

  --color-series-1: #3987e5;
  --color-series-2: #d95926;
  --color-series-3: #199e70;
  --color-series-4: #c98500;
  --color-series-5: #d55181;
  --color-series-6: #008300;
  --color-series-7: #9085e9;
  --color-series-8: #e66767;

  --color-ramp-1: #1e4d7e;
  --color-ramp-2: #3670ae;
  --color-ramp-3: #5c95ce;
  --color-ramp-4: #8cb9e2;
  --color-ramp-5: #bbd7f0;

  --color-good: #199e70;
  --color-warning: #c98500;
  --color-critical: #e66767;
}

/* Light is a separately stepped alternative, not an inversion. Both the OS
   setting and the explicit toggle must win, which is why the values appear
   under two scopes. */
@media (prefers-color-scheme: light) {
  :root:not([data-theme="dark"]) {
    --color-surface: #faf7f2;
    --color-surface-raised: #ffffff;
    --color-surface-sunken: #f1ece3;
    --color-rule: #ddd6c9;
    --color-ink: #1b1814;
    --color-ink-muted: #5f574c;
    --color-ink-faint: #8c8479;
    --color-accent: #8a5e12;
    --color-accent-ink: #ffffff;
    --color-series-1: #2a78d6;
    --color-series-2: #eb6834;
    --color-series-3: #1baf7a;
    --color-series-4: #eda100;
    --color-series-5: #e87ba4;
    --color-series-6: #008300;
    --color-series-7: #4a3aa7;
    --color-series-8: #e34948;
    --color-ramp-1: #7fadd8;
    --color-ramp-2: #4e8fcb;
    --color-ramp-3: #2a6fb5;
    --color-ramp-4: #1a4e85;
    --color-ramp-5: #0e2f53;
  }
}

:root[data-theme="light"] {
  --color-surface: #faf7f2;
  --color-surface-raised: #ffffff;
  --color-surface-sunken: #f1ece3;
  --color-rule: #ddd6c9;
  --color-ink: #1b1814;
  --color-ink-muted: #5f574c;
  --color-ink-faint: #8c8479;
  --color-accent: #8a5e12;
  --color-accent-ink: #ffffff;
  --color-series-1: #2a78d6;
  --color-series-2: #eb6834;
  --color-series-3: #1baf7a;
  --color-series-4: #eda100;
  --color-series-5: #e87ba4;
  --color-series-6: #008300;
  --color-series-7: #4a3aa7;
  --color-series-8: #e34948;
  --color-ramp-1: #7fadd8;
  --color-ramp-2: #4e8fcb;
  --color-ramp-3: #2a6fb5;
  --color-ramp-4: #1a4e85;
  --color-ramp-5: #0e2f53;
}
```

- [ ] **Step 5: Write `web/src/styles/app.css`**

```css
@import "@fontsource-variable/fraunces";
@import "@fontsource/ibm-plex-sans/400.css";
@import "@fontsource/ibm-plex-sans/500.css";
@import "@fontsource/ibm-plex-sans/600.css";
@import "./tokens.css";

@layer base {
  :root {
    color-scheme: dark light;
  }

  html,
  body,
  #root {
    height: 100%;
  }

  body {
    margin: 0;
    background: var(--color-surface);
    color: var(--color-ink);
    font-family: var(--font-sans);
    font-size: 15px;
    line-height: 1.5;
    -webkit-font-smoothing: antialiased;
  }

  /* Every number that can change is tabular, so digits do not jitter as
     values update. */
  .tabular,
  th,
  td,
  output {
    font-variant-numeric: tabular-nums;
  }

  :focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: 2px;
    border-radius: 2px;
  }

  @media (prefers-reduced-motion: reduce) {
    *,
    *::before,
    *::after {
      animation-duration: 0.01ms !important;
      animation-iteration-count: 1 !important;
      transition-duration: 0.01ms !important;
      scroll-behavior: auto !important;
    }
  }
}
```

- [ ] **Step 6: Write `web/src/App.tsx` and `web/src/main.tsx`**

A placeholder route tree; Task 2 replaces the contents with real pages.

```tsx
// web/src/App.tsx
export default function App() {
  return (
    <main className="grid min-h-full place-items-center p-8">
      <h1 className="font-display text-3xl">MargioLink</h1>
    </main>
  );
}
```

```tsx
// web/src/main.tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles/app.css";

const root = document.getElementById("root");
if (!root) throw new Error("#root is missing from index.html");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

- [ ] **Step 7: Add the assets binding to `wrangler.jsonc`**

Insert this alongside the existing `d1_databases` block. `not_found_handling` is deliberately left at its default: an unmatched path must fall through to the Worker so `/:slug` still redirects. Setting it to `single-page-application` would make every short link return the dashboard's HTML.

```jsonc
  "assets": {
    "directory": "./web/dist",
    "binding": "ASSETS"
  },
```

- [ ] **Step 8: Add `ASSETS` to `src/types.ts`**

```ts
export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  ADMIN_USER: string;
  ADMIN_PASSWORD: string | undefined;
  HASH_SECRET: string | undefined;
  SHORT_DOMAIN: string;
  RAW_RETENTION_DAYS: string;
}
```

Keep whatever optionality the existing file already has on the secret fields — Task 1 of the backend plan made them optional so a direct read cannot compile. Add only the `ASSETS` line.

- [ ] **Step 9: Serve the shell from `src/routes/public.ts`**

Add to `registerPublicRoutes`, before the existing routes. The SPA owns client-side routing, so every `/app` path returns the same document and React Router decides what to render.

```ts
  // The dashboard shell. Vite writes index.html to the asset root, so it is
  // fetched by that path rather than by the /app URL the visitor requested.
  const shell = (c: { env: Env; req: { url: string } }) =>
    c.env.ASSETS.fetch(new Request(new URL("/index.html", c.req.url)));

  app.get("/app", (c) => shell(c));
  app.get("/app/*", (c) => shell(c));
```

- [ ] **Step 10: Add build scripts to `package.json`**

```json
    "build:web": "vite build --config web/vite.config.ts",
    "dev:web": "vite --config web/vite.config.ts",
    "predeploy": "npm run build:web",
```

- [ ] **Step 11: Ignore the build output**

Append to `.gitignore`:

```
web/dist/
```

- [ ] **Step 12: Add a second Vitest project for the browser code**

Replace `vitest.config.ts`'s single config with two projects, so Worker tests keep running in `workerd` and React tests run in jsdom. Keep the existing workers configuration exactly as it is; add the second entry.

```ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
// keep the existing cloudflareTest import and readD1Migrations call

export default defineConfig({
  test: {
    projects: [
      {
        // the existing Worker project, unchanged: plugins [cloudflareTest({...})]
        // and test.setupFiles ["./test/setup.ts"]
      },
      {
        plugins: [react()],
        test: {
          name: "web",
          environment: "jsdom",
          include: ["web/src/**/*.test.{ts,tsx}"],
          setupFiles: ["./web/src/test-setup.ts"],
          globals: true,
        },
      },
    ],
  },
});
```

Create `web/src/test-setup.ts`:

```ts
import "@testing-library/jest-dom/vitest";
```

If the installed Vitest names this option `workspace` rather than `projects`, use whichever the installed version documents and say so in your report — do not downgrade the package to match this plan.

- [ ] **Step 13: Write the failing test `test/routes/spa.test.ts`**

This is the test that catches the asset-routing mistake that would break every short link.

```ts
import { SELF, env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { createLink } from "../../src/db/links";

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM links").run();
});

describe("the dashboard shell", () => {
  it("serves HTML at /app", async () => {
    const res = await SELF.fetch("https://link.test/app");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
  });

  it("serves the same document for a nested client route", async () => {
    const res = await SELF.fetch("https://link.test/app/links");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
  });
});

describe("the shell does not shadow the Worker", () => {
  it("leaves a short link redirecting", async () => {
    await createLink(
      env.DB,
      { slug: "notthedashboard", targetUrl: "https://example.com" },
      Math.floor(Date.now() / 1000),
    );
    const res = await SELF.fetch("https://link.test/notthedashboard", { redirect: "manual" });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://example.com/");
  });

  it("leaves an unknown slug returning 404 rather than the dashboard", async () => {
    const res = await SELF.fetch("https://link.test/nothing-here", { redirect: "manual" });
    expect(res.status).toBe(404);
  });

  it("leaves the API answering JSON", async () => {
    const res = await SELF.fetch("https://link.test/api/links");
    expect(res.status).toBe(401);
    expect(res.headers.get("content-type")).toContain("application/json");
  });

  it("leaves the health endpoint alone", async () => {
    expect((await SELF.fetch("https://link.test/_health")).status).toBe(200);
  });
});
```

- [ ] **Step 14: Write the failing test `web/src/styles/tokens.test.ts`**

The palette is computed evidence, and a stray edit to a hex would silently break the validation it rests on. This test pins the values that the validator signed off.

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("./tokens.css", import.meta.url), "utf8");

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
```

- [ ] **Step 15: Run both test files and confirm they fail**

Run: `npm test`
Expected: FAIL — the SPA tests because no `/app` route exists and there is no build output, the token tests because `tokens.css` does not exist yet.

- [ ] **Step 16: Build the SPA, then run the suite**

The Worker's asset binding needs `web/dist` to exist before the Worker tests can serve anything from it.

```bash
npm run build:web
npm test
```

Expected: PASS. If the Worker tests fail because the assets directory is missing, that is the ordering above — build first.

- [ ] **Step 17: Verify lint and types**

Run: `npm run check && npm run typecheck`
Expected: both exit 0. Biome and `tsc` now cover `web/` too; if `tsc` complains about JSX, confirm `web/tsconfig.json` sets `"jsx": "react-jsx"` and is referenced from the root config's `include`.

- [ ] **Step 18: Commit**

```bash
git add -A
git commit -m "feat(web): scaffold the dashboard shell and design tokens"
```

---

## Task 2: API client, query hooks, and the login screen

**Files:**
- Create: `web/src/lib/api.ts`, `web/src/lib/queries.ts`, `web/src/lib/format.ts`, `web/src/pages/Login.tsx`, `web/src/components/RequireSession.tsx`
- Modify: `web/src/App.tsx`, `web/src/main.tsx`
- Test: `web/src/lib/api.test.ts`, `web/src/pages/Login.test.tsx`

**Interfaces:**
- Consumes: the Worker's existing API. No backend change.
- Produces:
  - `api.get<T>(path: string, params?: Record<string, string | number | undefined>): Promise<T>`, `api.post<T>`, `api.patch<T>`, `api.put<T>`, `api.del<T>` — all send `credentials: "same-origin"` and throw `ApiError` on a non-2xx response.
  - `class ApiError extends Error { status: number; code: string }` — `code` is the API's `error` string, or `"unknown"`.
  - Query hooks: `useLinks(params)`, `useLink(id)`, `useTags()`, `useSummary(range)`, `useTimeseries(range, granularity)`, `useDimension(range, name, limit)`, `useLive(limit)`, `useSparklines(days)`, `useSessions()`.
  - Mutation hooks: `useLogin()`, `useLogout()`, `useCreateLink()`, `useUpdateLink()`, `useDeleteLink()`, `useRestoreLink()`, `useSetLinkTags()`, `useCreateTag()`, `useDeleteTag()`, `useRevokeSession()`, `useRevokeAllSessions()`.
  - `formatCount(n: number): string`, `formatDelta(current: number, previous: number): { text: string; direction: "up" | "down" | "flat" }`, `formatDateTime(unixSeconds: number): string`, `formatRelative(unixSeconds: number, now?: number): string`.
  - `<RequireSession>` — renders its children when a session exists, redirects to `/app/login` when the API answers 401.

- [ ] **Step 1: Write the failing test `web/src/lib/api.test.ts`**

```tsx
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, api } from "./api";

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(response: Response) {
  const spy = vi.fn().mockResolvedValue(response);
  vi.stubGlobal("fetch", spy);
  return spy;
}

describe("api", () => {
  it("sends the session cookie", async () => {
    const spy = stubFetch(Response.json({ links: [], total: 0 }));
    await api.get("/api/links");
    expect(spy.mock.calls[0]?.[1]).toMatchObject({ credentials: "same-origin" });
  });

  it("drops undefined query parameters instead of sending the string 'undefined'", async () => {
    const spy = stubFetch(Response.json({ links: [], total: 0 }));
    await api.get("/api/links", { search: "x", tagId: undefined, limit: 20 });
    const url = String(spy.mock.calls[0]?.[0]);
    expect(url).toContain("search=x");
    expect(url).toContain("limit=20");
    expect(url).not.toContain("tagId");
  });

  it("throws ApiError carrying the status and the API's error code", async () => {
    stubFetch(Response.json({ error: "slug_taken" }, { status: 409 }));
    await expect(api.post("/api/links", { targetUrl: "https://x.com" })).rejects.toMatchObject({
      status: 409,
      code: "slug_taken",
    });
  });

  it("still throws when the error body is not JSON", async () => {
    stubFetch(new Response("upstream exploded", { status: 500 }));
    const error = await api.get("/api/links").catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(500);
    expect(error.code).toBe("unknown");
  });

  it("returns undefined rather than exploding on an empty 200", async () => {
    stubFetch(new Response(null, { status: 204 }));
    await expect(api.post("/api/auth/logout")).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm test -- web/src/lib/api.test.ts`
Expected: FAIL — `./api` does not exist.

- [ ] **Step 3: Write `web/src/lib/api.ts`**

```ts
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message?: string) {
    super(message ?? `${status} ${code}`);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

type Params = Record<string, string | number | boolean | undefined | null>;

function withParams(path: string, params?: Params): string {
  if (!params) return path;
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `${path}?${query}` : path;
}

async function request<T>(method: string, path: string, body?: unknown, params?: Params) {
  const response = await fetch(withParams(path, params), {
    method,
    // The session lives in a __Host- cookie on this same origin.
    credentials: "same-origin",
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (!response.ok) {
    let code = "unknown";
    try {
      const parsed = (await response.json()) as { error?: string };
      if (typeof parsed.error === "string") code = parsed.error;
    } catch {
      // A non-JSON error body is still an error; the status carries the meaning.
    }
    throw new ApiError(response.status, code);
  }

  if (response.status === 204) return undefined as T;
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export const api = {
  get: <T>(path: string, params?: Params) => request<T>("GET", path, undefined, params),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body),
  patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, body),
  put: <T>(path: string, body?: unknown) => request<T>("PUT", path, body),
  del: <T>(path: string) => request<T>("DELETE", path),
};
```

- [ ] **Step 4: Write `web/src/lib/format.ts`**

```ts
const compact = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });
const plain = new Intl.NumberFormat();

/** Compact above four digits, exact below — a dashboard should not round 847 to 0.8K. */
export function formatCount(n: number): string {
  return n < 10_000 ? plain.format(n) : compact.format(n);
}

export function formatDelta(current: number, previous: number) {
  if (previous === 0) {
    return current === 0
      ? { text: "no change", direction: "flat" as const }
      : { text: "new", direction: "up" as const };
  }
  const change = ((current - previous) / previous) * 100;
  const rounded = Math.round(change);
  if (rounded === 0) return { text: "0%", direction: "flat" as const };
  return {
    text: `${rounded > 0 ? "+" : ""}${rounded}%`,
    direction: rounded > 0 ? ("up" as const) : ("down" as const),
  };
}

export function formatDateTime(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function formatRelative(unixSeconds: number, now = Date.now()): string {
  const seconds = Math.round(unixSeconds - now / 1000);
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["day", 86_400],
    ["hour", 3600],
    ["minute", 60],
  ];
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) return rtf.format(Math.round(seconds / size), unit);
  }
  return rtf.format(Math.round(seconds), "second");
}
```

- [ ] **Step 5: Write `web/src/lib/queries.ts`**

One hook per endpoint. Keys are arrays so a mutation can invalidate a family.

```ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";

export interface Tag {
  id: number;
  name: string;
  color: string;
}

export interface Link {
  id: number;
  slug: string;
  shortUrl: string;
  targetUrl: string;
  title: string | null;
  description: string | null;
  hasPassword: boolean;
  expiresAt: number | null;
  expiredUrl: string | null;
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
  tags: Tag[];
}

export interface Range {
  from: number;
  to: number;
  linkId?: number;
}

export interface Summary {
  clicks: number;
  uniques: number;
  bots: number;
  countries: number;
}

export interface Slice {
  value: string;
  clicks: number;
  uniques: number;
}

export const keys = {
  links: (params?: unknown) => ["links", params ?? {}] as const,
  link: (id: number) => ["link", id] as const,
  tags: () => ["tags"] as const,
  sessions: () => ["sessions"] as const,
  stats: (kind: string, params: unknown) => ["stats", kind, params] as const,
};

export function useLinks(params: {
  search?: string;
  status?: string;
  tagId?: number;
  limit?: number;
  offset?: number;
}) {
  return useQuery({
    queryKey: keys.links(params),
    queryFn: () => api.get<{ links: Link[]; total: number }>("/api/links", params),
  });
}

export function useLink(id: number) {
  return useQuery({
    queryKey: keys.link(id),
    queryFn: () => api.get<{ link: Link }>(`/api/links/${id}`),
    enabled: Number.isFinite(id),
  });
}

export function useTags() {
  return useQuery({ queryKey: keys.tags(), queryFn: () => api.get<{ tags: Tag[] }>("/api/tags") });
}

export function useSummary(range: Range) {
  return useQuery({
    queryKey: keys.stats("summary", range),
    queryFn: () =>
      api.get<{ current: Summary; previous: Summary }>("/api/stats/summary", { ...range }),
  });
}

export function useTimeseries(range: Range, granularity: "hour" | "day" | "week") {
  return useQuery({
    queryKey: keys.stats("timeseries", { ...range, granularity }),
    queryFn: () =>
      api.get<{ buckets: { bucket: string; clicks: number; uniques: number }[] }>(
        "/api/stats/timeseries",
        { ...range, granularity },
      ),
  });
}

export function useDimension(range: Range, name: string, limit = 20) {
  return useQuery({
    queryKey: keys.stats("dimension", { ...range, name, limit }),
    queryFn: () => api.get<{ slices: Slice[] }>("/api/stats/dimension", { ...range, name, limit }),
  });
}

/** Polls, because the feed is the one place a stale number is visibly wrong. */
export function useLive(limit = 50) {
  return useQuery({
    queryKey: keys.stats("live", limit),
    queryFn: () => api.get<{ clicks: LiveClick[] }>("/api/stats/live", { limit }),
    refetchInterval: 10_000,
  });
}

export interface LiveClick {
  id: number;
  linkId: number;
  slug: string;
  ts: number;
  country: string | null;
  city: string | null;
  device: string | null;
  browser: string | null;
  referrerType: string | null;
  source: string;
  outcome: string;
  isBot: boolean;
}

export function useSparklines(days = 7) {
  return useQuery({
    queryKey: keys.stats("sparklines", days),
    queryFn: () =>
      api.get<{ days: number; series: Record<string, number[]> }>("/api/stats/sparklines", { days }),
  });
}

export function useSessions() {
  return useQuery({
    queryKey: keys.sessions(),
    queryFn: () => api.get<{ sessions: SessionRow[] }>("/api/auth/sessions"),
  });
}

export interface SessionRow {
  id: string;
  createdAt: number;
  lastSeenAt: number;
  expiresAt: number;
  device: string | null;
  current: boolean;
}

function useInvalidate() {
  const client = useQueryClient();
  return (prefix: string) =>
    client.invalidateQueries({ predicate: (q) => q.queryKey[0] === prefix });
}

export function useLogin() {
  return useMutation({
    mutationFn: (body: { username: string; password: string }) =>
      api.post<{ ok: true }>("/api/auth/login", body),
  });
}

export function useLogout() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api.post("/api/auth/logout"),
    onSuccess: () => client.clear(),
  });
}

export function useCreateLink() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post<{ link: Link }>("/api/links", body),
    onSuccess: () => invalidate("links"),
  });
}

export function useUpdateLink() {
  const invalidate = useInvalidate();
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: number } & Record<string, unknown>) =>
      api.patch<{ link: Link }>(`/api/links/${id}`, body),
    onSuccess: (_data, variables) => {
      invalidate("links");
      client.invalidateQueries({ queryKey: keys.link(variables.id) });
    },
  });
}

export function useDeleteLink() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (id: number) => api.del(`/api/links/${id}`),
    onSuccess: () => invalidate("links"),
  });
}

export function useRestoreLink() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (id: number) => api.post(`/api/links/${id}/restore`),
    onSuccess: () => invalidate("links"),
  });
}

export function useSetLinkTags() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, tagIds }: { id: number; tagIds: number[] }) =>
      api.put(`/api/links/${id}/tags`, { tagIds }),
    onSuccess: () => invalidate("links"),
  });
}

export function useCreateTag() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (body: { name: string; color: string }) => api.post<{ tag: Tag }>("/api/tags", body),
    onSuccess: () => invalidate("tags"),
  });
}

export function useDeleteTag() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (id: number) => api.del(`/api/tags/${id}`),
    onSuccess: () => {
      invalidate("tags");
      invalidate("links");
    },
  });
}

export function useRevokeSession() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (id: string) => api.del(`/api/auth/sessions/${id}`),
    onSuccess: () => invalidate("sessions"),
  });
}

export function useRevokeAllSessions() {
  return useMutation({ mutationFn: () => api.del("/api/auth/sessions") });
}
```

- [ ] **Step 6: Write the failing test `web/src/pages/Login.test.tsx`**

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import Login from "./Login";

afterEach(() => vi.unstubAllGlobals());

function renderLogin() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Login />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Login", () => {
  it("labels both fields so they are reachable by name", () => {
    renderLogin();
    expect(screen.getByLabelText(/username/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
  });

  it("marks the password field as a password", () => {
    renderLogin();
    expect(screen.getByLabelText(/password/i)).toHaveAttribute("type", "password");
  });

  it("sends the credentials on submit", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(Response.json({ ok: true }));
    vi.stubGlobal("fetch", fetchSpy);

    renderLogin();
    await userEvent.type(screen.getByLabelText(/username/i), "admin");
    await userEvent.type(screen.getByLabelText(/password/i), "hunter2");
    await userEvent.click(screen.getByRole("button", { name: /sign in/i }));

    expect(fetchSpy).toHaveBeenCalled();
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ username: "admin", password: "hunter2" });
  });

  it("shows one message for wrong credentials without saying which field was wrong", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ error: "invalid_credentials" }, { status: 401 })),
    );

    renderLogin();
    await userEvent.type(screen.getByLabelText(/username/i), "admin");
    await userEvent.type(screen.getByLabelText(/password/i), "wrong");
    await userEvent.click(screen.getByRole("button", { name: /sign in/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/incorrect/i);
    expect(alert.textContent?.toLowerCase()).not.toContain("username");
    expect(alert.textContent?.toLowerCase()).not.toContain("password is");
  });

  it("says how long to wait when the throttle trips", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ error: "too_many_attempts" }, { status: 429 })),
    );

    renderLogin();
    await userEvent.type(screen.getByLabelText(/username/i), "admin");
    await userEvent.type(screen.getByLabelText(/password/i), "wrong");
    await userEvent.click(screen.getByRole("button", { name: /sign in/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/too many/i);
  });
});
```

- [ ] **Step 7: Write `web/src/pages/Login.tsx`**

A single centred card. The error message deliberately does not distinguish a wrong username from a wrong password — the API does not, and neither should the interface.

Requirements the test pins, and which the implementation must satisfy:

- both inputs have real `<label>` elements associated by `htmlFor`/`id`;
- the password input has `type="password"` and `autoComplete="current-password"`;
- the submit button is a `<button type="submit">` reading "Sign in";
- an error renders in an element with `role="alert"`;
- `invalid_credentials` produces "Those details are incorrect." and nothing more specific;
- `too_many_attempts` produces "Too many attempts. Wait a few minutes and try again.";
- any other failure produces "Something went wrong. Try again.";
- on success, navigate to `/app`;
- the form is disabled while the mutation is pending, and the button reads "Signing in…".

Use `useLogin()` from `queries.ts` and `useNavigate()` from `react-router`. Style with the tokens: `bg-surface-raised`, a hairline `border-rule`, `font-display` for the heading.

- [ ] **Step 8: Write `web/src/components/RequireSession.tsx`**

```tsx
import type { ReactNode } from "react";
import { Navigate } from "react-router";
import { useSessions } from "../lib/queries";
import { ApiError } from "../lib/api";

/** The API is the source of truth about whether a session exists — there is no
 *  client-side token to inspect, by design. A 401 from any authenticated call
 *  means the cookie is gone or expired. */
export function RequireSession({ children }: { children: ReactNode }) {
  const { isPending, error } = useSessions();

  if (isPending) return <div className="p-8 text-ink-muted">Loading…</div>;
  if (error instanceof ApiError && error.status === 401) {
    return <Navigate to="/app/login" replace />;
  }
  if (error) return <div className="p-8 text-critical">Could not reach the API.</div>;
  return <>{children}</>;
}
```

- [ ] **Step 9: Wire the router in `web/src/App.tsx` and providers in `main.tsx`**

`App.tsx` declares routes under the `/app` basename: `/login` renders `Login`, and every other path renders a placeholder inside `RequireSession` for now. `main.tsx` wraps the tree in `QueryClientProvider` with a client configured `retry: false` for 401s — a retried 401 just delays the redirect — and `BrowserRouter basename="/app"`.

- [ ] **Step 10: Run the tests**

Run: `npm test -- web/src`
Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "feat(web): add the API client, query hooks and the login screen"
```

---

## Task 3: The application shell

**Files:**
- Create: `web/src/components/layout/AppShell.tsx`, `PrimaryNav.tsx`, `ThemeToggle.tsx`, `web/src/lib/theme.ts`
- Modify: `web/src/App.tsx`
- Test: `web/src/components/layout/AppShell.test.tsx`, `web/src/lib/theme.test.ts`

**Interfaces:**
- Consumes: `RequireSession` (Task 2).
- Produces: `<AppShell>` wrapping every authenticated page; `useTheme(): { theme: "dark" | "light" | "system"; setTheme(t): void }` persisting to `localStorage` under `margiolink:theme`.

Spec §6.1 is explicit that this is one application that reorganises, not a desktop app with a reduced mobile variant: a collapsible sidebar above 1024px, a bottom navigation bar below it, and tables that become stacked cards below 640px.

- [ ] **Step 1: Write the failing test `web/src/lib/theme.test.ts`**

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { applyTheme, readStoredTheme, storeTheme } from "./theme";

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
});

describe("theme", () => {
  it("defaults to following the system", () => {
    expect(readStoredTheme()).toBe("system");
  });

  it("round-trips an explicit choice", () => {
    storeTheme("light");
    expect(readStoredTheme()).toBe("light");
  });

  it("stamps the root element so the token blocks can win", () => {
    applyTheme("light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });

  it("removes the stamp for system, so the media query decides", () => {
    applyTheme("dark");
    applyTheme("system");
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  });

  it("survives a storage that throws", () => {
    const original = Storage.prototype.getItem;
    Storage.prototype.getItem = () => {
      throw new Error("blocked");
    };
    expect(() => readStoredTheme()).not.toThrow();
    expect(readStoredTheme()).toBe("system");
    Storage.prototype.getItem = original;
  });
});
```

- [ ] **Step 2: Write `web/src/lib/theme.ts`**

```ts
export type Theme = "dark" | "light" | "system";

const KEY = "margiolink:theme";

/** Reading storage can throw — a private window, blocked site data. A theme is
 *  a convenience, so failure means "follow the system", never an error. */
export function readStoredTheme(): Theme {
  try {
    const stored = localStorage.getItem(KEY);
    return stored === "dark" || stored === "light" ? stored : "system";
  } catch {
    return "system";
  }
}

export function storeTheme(theme: Theme): void {
  try {
    if (theme === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, theme);
  } catch {
    // Not being able to remember the choice is survivable.
  }
}

export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  if (theme === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", theme);
}
```

- [ ] **Step 3: Write the failing test `web/src/components/layout/AppShell.test.tsx`**

```tsx
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { AppShell } from "./AppShell";

function renderShell(path = "/") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppShell>
        <h1>Overview</h1>
      </AppShell>
    </MemoryRouter>,
  );
}

describe("AppShell", () => {
  it("offers a skip link as the first focusable element", async () => {
    renderShell();
    await userEvent.tab();
    expect(screen.getByRole("link", { name: /skip to main content/i })).toHaveFocus();
  });

  it("renders exactly one main landmark", () => {
    renderShell();
    expect(screen.getAllByRole("main")).toHaveLength(1);
  });

  it("names its navigation landmarks so two navs are distinguishable", () => {
    renderShell();
    expect(screen.getByRole("navigation", { name: /primary/i })).toBeInTheDocument();
  });

  it("links to every section", () => {
    renderShell();
    const nav = screen.getByRole("navigation", { name: /primary/i });
    for (const label of [/overview/i, /links/i, /tags/i, /settings/i]) {
      expect(within(nav).getByRole("link", { name: label })).toBeInTheDocument();
    }
  });

  it("marks the current section for assistive technology, not only by colour", () => {
    renderShell("/links");
    const nav = screen.getByRole("navigation", { name: /primary/i });
    expect(within(nav).getByRole("link", { name: /links/i })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("renders its children inside main", () => {
    renderShell();
    expect(within(screen.getByRole("main")).getByRole("heading", { name: "Overview" })).toBeVisible();
  });
});
```

- [ ] **Step 4: Write the shell**

`AppShell` composes: a visually-hidden-until-focused skip link targeting `#main`; one `PrimaryNav`; and a `<main id="main" tabIndex={-1}>`. The nav marks the active route with `aria-current="page"` as well as with the accent colour — spec §6.4's rule that nothing is carried by colour alone applies to navigation too.

The section list:

```ts
export const SECTIONS = [
  { to: "/", label: "Overview", icon: LayoutDashboard },
  { to: "/links", label: "Links", icon: Link2 },
  { to: "/tags", label: "Tags", icon: Tags },
  { to: "/settings", label: "Settings", icon: Settings },
] as const;
```

**Render exactly one `<nav aria-label="Primary">`**, and let CSS decide whether
it sits as a rail on the left or as a bar along the bottom. Two `<nav>` elements
with the same label, one hidden by a media query, would be ambiguous to the test
and to a screen reader: jsdom applies no media queries, so both would be present
in the accessibility tree and `getByRole("navigation", { name: /primary/i })`
would throw on finding two. One element, two layouts:

```tsx
<nav
  aria-label="Primary"
  className="
    fixed inset-x-0 bottom-0 z-10 flex justify-around border-t border-rule
    bg-surface-raised px-2 py-1
    lg:static lg:h-full lg:w-56 lg:flex-col lg:justify-start lg:gap-1
    lg:border-t-0 lg:border-r lg:px-3 lg:py-4
  "
>
```

Each item shows its icon always and its label always — the label is `sr-only`
nowhere. A bottom bar with icon-only items is a guessing game, and the labels
are short enough to fit.

`ThemeToggle` is a three-state control (System / Light / Dark) built on Radix `DropdownMenu`, labelled, and calling `storeTheme` + `applyTheme`.

- [ ] **Step 5: Run the tests**

Run: `npm test -- web/src`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(web): add the responsive application shell"
```

---

## Task 4: Interface primitives

**Files:**
- Create: `web/src/components/ui/` — `Button.tsx`, `Field.tsx`, `Select.tsx`, `Dialog.tsx`, `Tooltip.tsx`, `Switch.tsx`, `Tabs.tsx`, `Badge.tsx`, `EmptyState.tsx`, `Skeleton.tsx`, `cn.ts`
- Test: `web/src/components/ui/Button.test.tsx`, `Field.test.tsx`, `Dialog.test.tsx`

**Interfaces:**
- Produces: `cn(...inputs)` merging Tailwind classes; `<Button variant="primary"|"ghost"|"danger" size="sm"|"md">`; `<Field label id error hint>` wrapping any input and wiring `aria-describedby` and `aria-invalid`; `<Dialog title description>` on Radix; `<Badge tone>`; `<EmptyState title description action>`; `<Skeleton>`.

- [ ] **Step 1: Write `web/src/components/ui/cn.ts`**

```ts
import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
```

- [ ] **Step 2: Write the failing tests**

```tsx
// web/src/components/ui/Button.test.tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Button } from "./Button";

describe("Button", () => {
  it("is a real button so it works from the keyboard", async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Save</Button>);
    screen.getByRole("button", { name: "Save" }).focus();
    await userEvent.keyboard("{Enter}");
    expect(onClick).toHaveBeenCalled();
  });

  it("reports a busy state to assistive technology, not only visually", () => {
    render(<Button loading>Save</Button>);
    expect(screen.getByRole("button")).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("button")).toBeDisabled();
  });

  it("keeps an accessible name when it is icon-only", () => {
    render(<Button aria-label="Copy link">{"⧉"}</Button>);
    expect(screen.getByRole("button", { name: "Copy link" })).toBeInTheDocument();
  });
});
```

```tsx
// web/src/components/ui/Field.test.tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Field } from "./Field";

describe("Field", () => {
  it("associates its label with the control", () => {
    render(
      <Field id="slug" label="Slug">
        <input id="slug" />
      </Field>,
    );
    expect(screen.getByLabelText("Slug")).toBeInTheDocument();
  });

  it("announces the hint through aria-describedby", () => {
    render(
      <Field id="slug" label="Slug" hint="Letters, digits and dashes">
        <input id="slug" />
      </Field>,
    );
    expect(screen.getByLabelText("Slug")).toHaveAccessibleDescription(
      /letters, digits and dashes/i,
    );
  });

  it("marks the control invalid and announces the error", () => {
    render(
      <Field id="slug" label="Slug" error="That slug is taken">
        <input id="slug" />
      </Field>,
    );
    const input = screen.getByLabelText("Slug");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription(/that slug is taken/i);
    expect(screen.getByRole("alert")).toHaveTextContent(/that slug is taken/i);
  });
});
```

```tsx
// web/src/components/ui/Dialog.test.tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Dialog } from "./Dialog";

describe("Dialog", () => {
  it("exposes its title as the accessible name", async () => {
    render(
      <Dialog open title="New link" onOpenChange={() => {}}>
        <p>Body</p>
      </Dialog>,
    );
    expect(await screen.findByRole("dialog", { name: "New link" })).toBeInTheDocument();
  });

  it("closes on Escape", async () => {
    const onOpenChange = vi.fn();
    render(
      <Dialog open title="New link" onOpenChange={onOpenChange}>
        <p>Body</p>
      </Dialog>,
    );
    await userEvent.keyboard("{Escape}");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
```

- [ ] **Step 3: Run them and confirm they fail**

Run: `npm test -- web/src/components/ui`
Expected: FAIL — the modules do not exist.

- [ ] **Step 4: Implement the primitives**

`Button` forwards its ref, renders a real `<button>`, sets `aria-busy` and `disabled` when `loading`, and draws its variants from tokens: `primary` is `bg-accent text-accent-ink`, `ghost` is transparent with a `border-rule` hairline, `danger` uses `--color-critical`. Focus is the global `:focus-visible` ring; do not override it per component.

`Field` generates a description id from its `id`, renders the label with `htmlFor`, clones the child to add `aria-invalid` and `aria-describedby`, and renders the error in an element with `role="alert"`.

`Dialog`, `Tooltip`, `Switch` and `Tabs` wrap the corresponding Radix primitives with token styling — Radix supplies the accessibility semantics, which is why it is a dependency. `Dialog` requires a `title` prop and renders it in `Dialog.Title`; there is no way to construct one without an accessible name.

- [ ] **Step 5: Run the tests**

Run: `npm test -- web/src`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(web): add accessible interface primitives"
```

---

## Task 5: Chart frame, table view, sparkline and stat tile

**Read spec §6.3 and §6.4 before starting.** They are this task's real requirements; what follows implements them.

**Files:**
- Create: `web/src/components/charts/ChartFrame.tsx`, `TableView.tsx`, `Sparkline.tsx`, `StatTile.tsx`
- Test: `web/src/components/charts/ChartFrame.test.tsx`, `Sparkline.test.tsx`, `StatTile.test.tsx`

**Interfaces:**
- Produces:
  - `<ChartFrame title description series table>` — renders the title, a legend when `series.length >= 2`, and a Chart/Table toggle. `table` is `{ columns: string[]; rows: (string | number)[][] }`.
  - `<TableView columns rows caption>` — a real `<table>` with a caption.
  - `<Sparkline values width height label>` — no axes, no tooltip, one path plus an end dot.
  - `<StatTile label value previous spark hint>` — hero number, delta, optional sparkline.

`ChartFrame` is where the light palette's mandatory relief lives: spec §6.3 records that four light-mode categorical slots fall below 3:1 against the paper surface, and the method's relief rule requires visible direct labels **or** a table view. Every chart is wrapped in this frame, so the table view is always one control away, in both themes.

- [ ] **Step 1: Write the failing test `web/src/components/charts/ChartFrame.test.tsx`**

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ChartFrame } from "./ChartFrame";

const table = {
  columns: ["Country", "Clicks"],
  rows: [
    ["Italy", 42],
    ["France", 17],
  ],
};

describe("ChartFrame", () => {
  it("names the chart with a heading", () => {
    render(
      <ChartFrame title="Clicks by country" table={table}>
        <svg aria-hidden="true" />
      </ChartFrame>,
    );
    expect(screen.getByRole("heading", { name: "Clicks by country" })).toBeInTheDocument();
  });

  it("offers a table view for every chart", async () => {
    render(
      <ChartFrame title="Clicks by country" table={table}>
        <svg data-testid="plot" aria-hidden="true" />
      </ChartFrame>,
    );
    await userEvent.click(screen.getByRole("button", { name: /table/i }));
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "Italy" })).toBeInTheDocument();
    expect(screen.queryByTestId("plot")).not.toBeInTheDocument();
  });

  it("returns to the chart", async () => {
    render(
      <ChartFrame title="Clicks by country" table={table}>
        <svg data-testid="plot" aria-hidden="true" />
      </ChartFrame>,
    );
    await userEvent.click(screen.getByRole("button", { name: /table/i }));
    await userEvent.click(screen.getByRole("button", { name: /chart/i }));
    expect(screen.getByTestId("plot")).toBeInTheDocument();
  });

  it("shows a legend when two or more series are present", () => {
    render(
      <ChartFrame
        title="Clicks and uniques"
        series={[
          { label: "Clicks", color: "var(--color-series-1)" },
          { label: "Uniques", color: "var(--color-series-2)" },
        ]}
        table={table}
      >
        <svg aria-hidden="true" />
      </ChartFrame>,
    );
    expect(screen.getByText("Clicks")).toBeInTheDocument();
    expect(screen.getByText("Uniques")).toBeInTheDocument();
  });

  it("omits the legend for a single series, since the title names it", () => {
    const { container } = render(
      <ChartFrame
        title="Clicks"
        series={[{ label: "Clicks", color: "var(--color-series-1)" }]}
        table={table}
      >
        <svg aria-hidden="true" />
      </ChartFrame>,
    );
    expect(container.querySelector("[data-legend]")).toBeNull();
  });
});
```

- [ ] **Step 2: Write `TableView.tsx` and `ChartFrame.tsx`**

```tsx
// web/src/components/charts/TableView.tsx
export interface TableData {
  columns: string[];
  rows: (string | number)[][];
}

export function TableView({ columns, rows, caption }: TableData & { caption: string }) {
  return (
    <div className="max-h-80 overflow-auto">
      <table className="w-full text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="sticky top-0 bg-surface-raised">
          <tr>
            {columns.map((column, i) => (
              <th
                key={column}
                scope="col"
                className={`border-b border-rule py-2 font-medium text-ink-muted ${
                  i === 0 ? "text-left" : "text-right"
                }`}
              >
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={String(row[0])} className="border-b border-rule/50 last:border-0">
              {row.map((cell, i) => (
                <td
                  key={`${String(row[0])}-${columns[i]}`}
                  className={i === 0 ? "py-2 text-left" : "py-2 text-right tabular"}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

```tsx
// web/src/components/charts/ChartFrame.tsx
import { type ReactNode, useId, useState } from "react";
import { TableView, type TableData } from "./TableView";

export interface SeriesLabel {
  label: string;
  color: string;
}

export function ChartFrame({
  title,
  description,
  series = [],
  table,
  children,
}: {
  title: string;
  description?: string;
  series?: SeriesLabel[];
  table: TableData;
  children: ReactNode;
}) {
  const [view, setView] = useState<"chart" | "table">("chart");
  const headingId = useId();

  return (
    <section
      aria-labelledby={headingId}
      className="rounded-lg border border-rule bg-surface-raised p-4"
    >
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id={headingId} className="font-display text-lg leading-tight">
            {title}
          </h3>
          {description ? <p className="mt-1 text-sm text-ink-muted">{description}</p> : null}
        </div>

        <div className="flex items-center gap-3">
          {/* A legend is present for two or more series; one series is named by
              the title, so a legend box would only repeat it. */}
          {series.length >= 2 ? (
            <ul data-legend className="flex flex-wrap gap-3 text-sm text-ink-muted">
              {series.map((s) => (
                <li key={s.label} className="flex items-center gap-1.5">
                  <span
                    aria-hidden="true"
                    className="inline-block size-2.5 rounded-sm"
                    style={{ background: s.color }}
                  />
                  {s.label}
                </li>
              ))}
            </ul>
          ) : null}

          {/* The table view is the relief the light palette's contrast warning
              requires, and the accessible path for anyone who cannot use the
              visual encoding. It is never optional. */}
          <button
            type="button"
            onClick={() => setView(view === "chart" ? "table" : "chart")}
            className="rounded border border-rule px-2 py-1 text-xs text-ink-muted hover:text-ink"
          >
            {view === "chart" ? "Table" : "Chart"}
          </button>
        </div>
      </header>

      {view === "chart" ? children : <TableView {...table} caption={title} />}
    </section>
  );
}
```

- [ ] **Step 3: Write the failing test `web/src/components/charts/Sparkline.test.tsx`**

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Sparkline } from "./Sparkline";

describe("Sparkline", () => {
  it("carries an accessible summary rather than being a bare graphic", () => {
    render(<Sparkline values={[1, 4, 2, 8]} label="Clicks over the last 7 days" />);
    expect(screen.getByRole("img", { name: /clicks over the last 7 days/i })).toBeInTheDocument();
  });

  it("draws a path for real data", () => {
    const { container } = render(<Sparkline values={[1, 4, 2, 8]} label="Trend" />);
    expect(container.querySelector("path[data-line]")).toBeInTheDocument();
  });

  it("renders a flat baseline rather than crashing when every value is zero", () => {
    const { container } = render(<Sparkline values={[0, 0, 0]} label="Trend" />);
    expect(container.querySelector("path[data-line]")).toBeInTheDocument();
  });

  it("renders nothing plottable for an empty series", () => {
    const { container } = render(<Sparkline values={[]} label="Trend" />);
    expect(container.querySelector("path[data-line]")).toBeNull();
  });
});
```

- [ ] **Step 4: Write `Sparkline.tsx`**

A sparkline is the one form spec §6.4 exempts from a hover layer: it has no axes, no labels, and exists only to show shape beside a number.

```tsx
import { line as d3Line } from "d3-shape";
import { scaleLinear } from "d3-scale";

export function Sparkline({
  values,
  label,
  width = 96,
  height = 28,
  color = "var(--color-series-1)",
}: {
  values: number[];
  label: string;
  width?: number;
  height?: number;
  color?: string;
}) {
  if (values.length === 0) {
    return <svg role="img" aria-label={label} width={width} height={height} />;
  }

  const max = Math.max(...values, 1);
  const x = scaleLinear()
    .domain([0, Math.max(values.length - 1, 1)])
    .range([1, width - 1]);
  // 2px of headroom top and bottom keeps the 2px stroke from clipping.
  const y = scaleLinear().domain([0, max]).range([height - 2, 2]);

  const path = d3Line<number>()
    .x((_, i) => x(i))
    .y((v) => y(v))(values);

  const lastValue = values.at(-1) ?? 0;

  return (
    <svg role="img" aria-label={label} width={width} height={height} className="overflow-visible">
      <path
        data-line
        d={path ?? undefined}
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* The end dot answers "where does it stand now?" without a label. */}
      <circle cx={x(values.length - 1)} cy={y(lastValue)} r={2.5} fill={color} />
    </svg>
  );
}
```

- [ ] **Step 5: Write the failing test `web/src/components/charts/StatTile.test.tsx`**

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StatTile } from "./StatTile";

describe("StatTile", () => {
  it("shows the label and the value", () => {
    render(<StatTile label="Clicks" value={1234} previous={1000} />);
    expect(screen.getByText("Clicks")).toBeInTheDocument();
    expect(screen.getByText("1,234")).toBeInTheDocument();
  });

  it("states what the comparison is against, so a delta is not a mystery number", () => {
    render(<StatTile label="Clicks" value={1234} previous={1000} />);
    expect(screen.getByText(/previous period/i)).toBeInTheDocument();
  });

  it("shows direction in words as well as colour", () => {
    render(<StatTile label="Clicks" value={1234} previous={1000} />);
    expect(screen.getByText(/\+23%/)).toBeInTheDocument();
    expect(screen.getByLabelText(/increase/i)).toBeInTheDocument();
  });

  it("handles a previous period of zero without dividing by it", () => {
    render(<StatTile label="Clicks" value={5} previous={0} />);
    expect(screen.getByText(/new/i)).toBeInTheDocument();
  });

  it("omits the comparison entirely when there is nothing to compare against", () => {
    render(<StatTile label="Countries" value={12} />);
    expect(screen.queryByText(/previous period/i)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 6: Write `StatTile.tsx`**

The hero number is set in the display face at a large optical size; the label and the comparison stay in interface type. Direction is conveyed by an arrow **with a visually-hidden word** as well as by colour — spec §6.4 forbids colour-alone.

```tsx
import { ArrowDownRight, ArrowRight, ArrowUpRight } from "lucide-react";
import { formatCount, formatDelta } from "../../lib/format";
import { Sparkline } from "./Sparkline";

export function StatTile({
  label,
  value,
  previous,
  spark,
  hint,
}: {
  label: string;
  value: number;
  previous?: number;
  spark?: number[];
  hint?: string;
}) {
  const delta = previous === undefined ? null : formatDelta(value, previous);
  const Icon =
    delta?.direction === "up" ? ArrowUpRight : delta?.direction === "down" ? ArrowDownRight : ArrowRight;
  const directionWord =
    delta?.direction === "up" ? "increase" : delta?.direction === "down" ? "decrease" : "no change";
  const tone =
    delta?.direction === "up"
      ? "text-good"
      : delta?.direction === "down"
        ? "text-critical"
        : "text-ink-muted";

  return (
    <div className="rounded-lg border border-rule bg-surface-raised p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm text-ink-muted">{label}</p>
        {spark ? <Sparkline values={spark} label={`${label} trend`} /> : null}
      </div>

      <output className="mt-2 block font-display text-4xl leading-none tabular">
        {formatCount(value)}
      </output>

      {delta ? (
        <p className={`mt-2 flex items-center gap-1 text-sm ${tone}`}>
          <Icon aria-hidden="true" className="size-4" />
          <span className="sr-only">{directionWord}: </span>
          <span aria-label={directionWord}>{delta.text}</span>
          <span className="text-ink-faint">vs previous period</span>
        </p>
      ) : null}

      {hint ? <p className="mt-1 text-xs text-ink-faint">{hint}</p> : null}
    </div>
  );
}
```

- [ ] **Step 7: Run the tests**

Run: `npm test -- web/src/components/charts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(web): add the chart frame, table view, sparkline and stat tile"
```

---

## Task 6: Ranked bars and the hour-by-weekday heatmap

**Files:**
- Create: `web/src/components/charts/RankedBars.tsx`, `Heatmap.tsx`
- Test: `web/src/components/charts/RankedBars.test.tsx`, `Heatmap.test.tsx`

**Interfaces:**
- Produces:
  - `<RankedBars slices max label valueLabel="Clicks">` where `slices` is `{ value: string; clicks: number; uniques: number }[]`.
  - `<Heatmap slices>` where each slice's `value` is `"<weekday>-<hour>"` as `dow_hour` returns it — weekday `0` is Sunday, as SQLite's `%w` produces.

- [ ] **Step 1: Write the failing test `web/src/components/charts/RankedBars.test.tsx`**

```tsx
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RankedBars } from "./RankedBars";

const slices = [
  { value: "IT", clicks: 120, uniques: 90 },
  { value: "FR", clicks: 60, uniques: 55 },
  { value: "unknown", clicks: 5, uniques: 5 },
];

describe("RankedBars", () => {
  it("is a list, so it is navigable and countable", () => {
    render(<RankedBars slices={slices} label="Countries" />);
    expect(within(screen.getByRole("list")).getAllByRole("listitem")).toHaveLength(3);
  });

  it("prints every value as a direct label rather than relying on bar length", () => {
    render(<RankedBars slices={slices} label="Countries" />);
    expect(screen.getByText("120")).toBeInTheDocument();
    expect(screen.getByText("60")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
  });

  it("keeps the API's 'unknown' bucket visible instead of hiding it", () => {
    render(<RankedBars slices={slices} label="Countries" />);
    expect(screen.getByText("unknown")).toBeInTheDocument();
  });

  it("scales bars against the largest value, not the sum", () => {
    const { container } = render(<RankedBars slices={slices} label="Countries" />);
    const bars = container.querySelectorAll("[data-bar]");
    expect((bars[0] as HTMLElement).style.width).toBe("100%");
    expect((bars[1] as HTMLElement).style.width).toBe("50%");
  });

  it("renders an empty state rather than an empty box", () => {
    render(<RankedBars slices={[]} label="Countries" />);
    expect(screen.getByText(/no data/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Write `RankedBars.tsx`**

Bars are HTML rather than SVG deliberately: the value labels must be real text for a screen reader and for text search, and a row of `<li>` elements gives that for free. The 4px rounded end and the thin mark come from spec §6.4.

```tsx
import { formatCount } from "../../lib/format";

export function RankedBars({
  slices,
  label,
  valueLabel = "Clicks",
  color = "var(--color-series-1)",
}: {
  slices: { value: string; clicks: number; uniques: number }[];
  label: string;
  valueLabel?: string;
  color?: string;
}) {
  if (slices.length === 0) {
    return <p className="py-6 text-center text-sm text-ink-faint">No data for this period.</p>;
  }

  const max = Math.max(...slices.map((s) => s.clicks), 1);

  return (
    <ul aria-label={label} className="flex flex-col gap-2">
      {slices.map((slice) => (
        <li key={slice.value} className="grid grid-cols-[1fr_auto] items-center gap-3">
          <div className="min-w-0">
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate text-sm">{slice.value}</span>
              {/* Direct label: never make a reader estimate a length. */}
              <span className="shrink-0 text-sm tabular text-ink-muted">
                {formatCount(slice.clicks)}
              </span>
            </div>
            <div className="mt-1 h-1.5 rounded-full bg-surface-sunken">
              <div
                data-bar
                className="h-full rounded-full"
                style={{ width: `${(slice.clicks / max) * 100}%`, background: color }}
                title={`${slice.value}: ${slice.clicks} ${valueLabel.toLowerCase()}, ${slice.uniques} unique`}
              />
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 3: Write the failing test `web/src/components/charts/Heatmap.test.tsx`**

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Heatmap } from "./Heatmap";

const slices = [
  { value: "1-09", clicks: 10, uniques: 8 },
  { value: "1-10", clicks: 4, uniques: 4 },
  { value: "6-23", clicks: 1, uniques: 1 },
];

describe("Heatmap", () => {
  it("renders a cell for every hour of every weekday", () => {
    const { container } = render(<Heatmap slices={slices} />);
    expect(container.querySelectorAll("[data-cell]")).toHaveLength(7 * 24);
  });

  it("labels each cell so the value is readable without hovering", () => {
    render(<Heatmap slices={slices} />);
    expect(screen.getByLabelText(/monday 09:00 — 10 clicks/i)).toBeInTheDocument();
  });

  it("treats weekday 0 as Sunday, matching what the API returns", () => {
    render(<Heatmap slices={[{ value: "0-12", clicks: 3, uniques: 3 }]} />);
    expect(screen.getByLabelText(/sunday 12:00 — 3 clicks/i)).toBeInTheDocument();
  });

  it("says zero for an hour with no clicks rather than leaving it unexplained", () => {
    render(<Heatmap slices={slices} />);
    expect(screen.getByLabelText(/monday 00:00 — 0 clicks/i)).toBeInTheDocument();
  });

  it("still renders the full grid when there is no data at all", () => {
    const { container } = render(<Heatmap slices={[]} />);
    expect(container.querySelectorAll("[data-cell]")).toHaveLength(7 * 24);
  });
});
```

- [ ] **Step 4: Write `Heatmap.tsx`**

The ramp is the validated sequential one from spec §6.3, referenced by token so the light and dark steps swap with the theme. Every cell carries its own label, which is both the hover layer spec §6.4 requires for cells and the accessible reading of the value.

```tsx
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const RAMP = [
  "var(--color-ramp-1)",
  "var(--color-ramp-2)",
  "var(--color-ramp-3)",
  "var(--color-ramp-4)",
  "var(--color-ramp-5)",
];

export function Heatmap({ slices }: { slices: { value: string; clicks: number }[] }) {
  const byCell = new Map(slices.map((s) => [s.value, s.clicks]));
  const max = Math.max(...slices.map((s) => s.clicks), 1);

  return (
    <div className="overflow-x-auto">
      <div className="grid min-w-[34rem] grid-cols-[auto_repeat(24,minmax(0,1fr))] gap-[2px]">
        <span />
        {Array.from({ length: 24 }, (_, hour) => (
          <span key={hour} className="text-center text-[10px] tabular text-ink-faint">
            {hour % 6 === 0 ? hour : ""}
          </span>
        ))}

        {DAYS.map((day, dow) => (
          <>
            <span key={day} className="pr-2 text-right text-[11px] text-ink-faint">
              {day.slice(0, 3)}
            </span>
            {Array.from({ length: 24 }, (_, hour) => {
              const key = `${dow}-${String(hour).padStart(2, "0")}`;
              const clicks = byCell.get(key) ?? 0;
              // Zero is the surface, not the ramp's first step: an hour with no
              // clicks should read as absent rather than as a small value.
              const step = clicks === 0 ? null : Math.min(4, Math.floor((clicks / max) * 5));
              return (
                <div
                  data-cell
                  key={key}
                  aria-label={`${day} ${String(hour).padStart(2, "0")}:00 — ${clicks} clicks`}
                  title={`${day} ${String(hour).padStart(2, "0")}:00 — ${clicks} clicks`}
                  className="aspect-square rounded-[2px]"
                  style={{ background: step === null ? "var(--color-surface-sunken)" : RAMP[step] }}
                />
              );
            })}
          </>
        ))}
      </div>
    </div>
  );
}
```

Replace the fragment shorthand with `<Fragment key={day}>` from React so the key sits on the fragment rather than on its first child — the code above is written for readability and will warn otherwise.

- [ ] **Step 5: Run the tests**

Run: `npm test -- web/src/components/charts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(web): add ranked bars and the hour-by-weekday heatmap"
```

---

## Task 7: The time series

**Files:**
- Create: `web/src/components/charts/TimeSeries.tsx`, `web/src/lib/ranges.ts`
- Test: `web/src/components/charts/TimeSeries.test.tsx`, `web/src/lib/ranges.test.ts`

**Interfaces:**
- Produces:
  - `<TimeSeries buckets granularity>` where `buckets` is `{ bucket: string; clicks: number; uniques: number }[]`.
  - `PERIODS` — the preset ranges; `granularityFor(from, to): "hour" | "day" | "week"`; `rangeFor(preset): { from: number; to: number }`.

- [ ] **Step 1: Write the failing test `web/src/lib/ranges.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { PERIODS, granularityFor, rangeFor } from "./ranges";

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
});
```

- [ ] **Step 2: Write `web/src/lib/ranges.ts`**

```ts
const HOUR = 3600;
const DAY = 86_400;

export const PERIODS = [
  { id: "24h", label: "24 hours", seconds: DAY },
  { id: "7d", label: "7 days", seconds: 7 * DAY },
  { id: "30d", label: "30 days", seconds: 30 * DAY },
  { id: "90d", label: "90 days", seconds: 90 * DAY },
  { id: "12m", label: "12 months", seconds: 365 * DAY },
] as const;

export type PeriodId = (typeof PERIODS)[number]["id"];

/** Snapped to the hour so a refresh does not shift every bucket by a few
 *  seconds and invalidate the cache for no reason. */
export function rangeFor(id: PeriodId, nowSeconds = Math.floor(Date.now() / 1000)) {
  const period = PERIODS.find((p) => p.id === id) ?? PERIODS[1];
  const to = Math.floor(nowSeconds / HOUR) * HOUR;
  return { from: to - period.seconds, to };
}

/** Keeps the column count readable: at most ~48 hourly, ~90 daily, then weekly. */
export function granularityFor(from: number, to: number): "hour" | "day" | "week" {
  const span = to - from;
  if (span <= 2 * DAY) return "hour";
  if (span <= 90 * DAY) return "day";
  return "week";
}
```

- [ ] **Step 3: Write the failing test `web/src/components/charts/TimeSeries.test.tsx`**

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TimeSeries } from "./TimeSeries";

const buckets = [
  { bucket: "2026-03-10", clicks: 10, uniques: 8 },
  { bucket: "2026-03-11", clicks: 24, uniques: 20 },
  { bucket: "2026-03-12", clicks: 6, uniques: 6 },
];

describe("TimeSeries", () => {
  it("draws one area path per series", () => {
    const { container } = render(<TimeSeries buckets={buckets} granularity="day" />);
    expect(container.querySelectorAll("path[data-area]")).toHaveLength(2);
  });

  it("draws both series on one scale, never two axes", () => {
    const { container } = render(<TimeSeries buckets={buckets} granularity="day" />);
    // A second axis would mean a second set of tick labels on the right.
    expect(container.querySelectorAll("[data-axis]")).toHaveLength(2); // one x, one y
  });

  it("exposes an accessible summary of the whole series", () => {
    render(<TimeSeries buckets={buckets} granularity="day" />);
    expect(screen.getByRole("img", { name: /40 clicks/i })).toBeInTheDocument();
  });

  it("renders an empty state rather than an axis with nothing on it", () => {
    render(<TimeSeries buckets={[]} granularity="day" />);
    expect(screen.getByText(/no clicks in this period/i)).toBeInTheDocument();
  });

  it("survives a single bucket without dividing by a zero-width domain", () => {
    const { container } = render(
      <TimeSeries buckets={[{ bucket: "2026-03-10", clicks: 3, uniques: 3 }]} granularity="day" />,
    );
    expect(container.querySelectorAll("path[data-area]")).toHaveLength(2);
  });
});
```

- [ ] **Step 4: Write `TimeSeries.tsx`**

Two series — clicks and uniques — on **one** y-scale, because they are the same measure of the same thing and spec §6.4 forbids a second axis. Uniques is drawn over clicks in the second categorical slot, both as a 2px line with a faint area beneath.

The hover layer is a full-height crosshair with a tooltip, driven by the pointer's x position mapped back to the nearest bucket. It is keyboard-reachable: the plot has `tabIndex={0}` and left/right arrows move the active bucket, so the numbers are obtainable without a pointer.

Requirements the implementation must meet, beyond what the tests pin:

- `viewBox` with `preserveAspectRatio="none"` on the plot area only, so the chart is responsive without distorting stroke widths — draw at a fixed internal coordinate system and let CSS size the `<svg>` to `width: 100%`;
- 2px strokes, `strokeLinecap="round"`;
- the area fill at 12% opacity of its series colour, so overlap stays legible;
- y-axis ticks at four steps with a recessive `--color-rule` gridline and `--color-ink-faint` labels;
- x-axis labels thinned so they never collide: show at most eight, chosen by index;
- `role="img"` with an `aria-label` summarising the total, the peak and the period;
- the crosshair and tooltip hidden entirely under `prefers-reduced-motion` only if animated — a static crosshair stays.

- [ ] **Step 5: Run the tests**

Run: `npm test -- web/src`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(web): add the time series with a keyboard-reachable crosshair"
```

---

## Task 8: The world map

**Files:**
- Create: `web/src/components/charts/WorldMap.tsx`
- Test: `web/src/components/charts/WorldMap.test.tsx`

**Interfaces:**
- Produces: `<WorldMap slices>` — a choropleth over `{ value: <ISO 3166-1 alpha-2>, clicks }`, lazy-loaded.

Two constraints from spec §6.3 and §6.4 govern this component. It is a **sequential** encoding, so it uses the validated ramp rather than categorical hues — which is also why the three-series cap on all-pairs forms does not bite here: there are no series, only steps. And it is the heaviest asset in the dashboard, so it loads only when it is needed.

- [ ] **Step 1: Write the failing test `web/src/components/charts/WorldMap.test.tsx`**

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { WorldMap } from "./WorldMap";

const slices = [
  { value: "IT", clicks: 120, uniques: 90 },
  { value: "FR", clicks: 40, uniques: 35 },
];

describe("WorldMap", () => {
  it("always ships the ranked list beside the map, so the data is readable without it", async () => {
    render(<WorldMap slices={slices} />);
    expect(await screen.findByText("IT")).toBeInTheDocument();
    expect(await screen.findByText("120")).toBeInTheDocument();
  });

  it("renders the list even before the atlas has loaded", () => {
    render(<WorldMap slices={slices} />);
    expect(screen.getByText("FR")).toBeInTheDocument();
  });

  it("says so plainly when there is nothing to plot", () => {
    render(<WorldMap slices={[]} />);
    expect(screen.getByText(/no data/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Write `WorldMap.tsx`**

The component renders the ranked country list immediately and the map when the atlas resolves. That ordering is the point: the list is the data, the map is the illustration, and a reader on a slow connection or with the chunk blocked still gets the numbers.

Implementation notes the code must follow:

- import the atlas with a dynamic `import("world-atlas/countries-110m.json")` inside a `useEffect`, so it lands in its own chunk;
- convert with `topojson-client`'s `feature`, project with `geoNaturalEarth1` from `d3-geo`, and render one `<path>` per country;
- map a country's clicks onto the five validated ramp steps; a country with no clicks gets `--color-surface-sunken`, never the ramp's first step, so absence reads as absence;
- give each country path a `<title>` with the country and its click count — that is the per-mark hover layer spec §6.4 requires;
- the atlas keys on numeric ISO 3166-1 codes while the API returns alpha-2, so ship a small `alpha2ToNumeric` lookup in the same file and treat an unmatched code as "no data" rather than guessing.

- [ ] **Step 3: Run the tests**

Run: `npm test -- web/src/components/charts/WorldMap.test.tsx`
Expected: PASS.

- [ ] **Step 4: Confirm the atlas really is a separate chunk**

Run: `npm run build:web`
Expected: the build output lists a chunk containing the atlas, separate from the main entry. Paste the chunk list into your report. If the atlas is in the main bundle, the dynamic import was hoisted — fix it before committing.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(web): add the lazily loaded world map"
```

---

## Task 9: The links page

**Files:**
- Create: `web/src/pages/Links.tsx`, `web/src/components/links/LinkRow.tsx`, `web/src/components/links/CopyButton.tsx`
- Modify: `web/src/App.tsx`
- Test: `web/src/pages/Links.test.tsx`, `web/src/components/links/CopyButton.test.tsx`

**Interfaces:**
- Consumes: `useLinks`, `useTags`, `useSparklines` (Task 2); `Sparkline` (Task 5); `EmptyState`, `Button`, `Badge` (Task 4).
- Produces: the `/links` route.

Spec §6.1: this is the working list. Instant search, filters by tag and status, a seven-day sparkline per row, and copy-to-clipboard in one action. Below 640px the table becomes stacked cards rather than a horizontally scrolling table.

- [ ] **Step 1: Write the failing test `web/src/components/links/CopyButton.test.tsx`**

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CopyButton } from "./CopyButton";

afterEach(() => vi.unstubAllGlobals());

describe("CopyButton", () => {
  it("copies the value and confirms it", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });

    render(<CopyButton value="https://link.test/demo" label="Copy short link" />);
    await userEvent.click(screen.getByRole("button", { name: /copy short link/i }));

    expect(writeText).toHaveBeenCalledWith("https://link.test/demo");
    expect(await screen.findByText(/copied/i)).toBeInTheDocument();
  });

  it("says so when the clipboard is unavailable instead of silently doing nothing", async () => {
    vi.stubGlobal("navigator", {});
    render(<CopyButton value="https://link.test/demo" label="Copy short link" />);
    await userEvent.click(screen.getByRole("button", { name: /copy short link/i }));
    expect(await screen.findByText(/could not copy/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Write `CopyButton.tsx`**

Guard `navigator.clipboard` — it is absent over plain HTTP and in some embedded browsers, and a copy button that appears to work and does not is worse than one that says it cannot. Announce the result in a `role="status"` region so it is not visual-only. Reset the confirmation after two seconds.

- [ ] **Step 3: Write the failing test `web/src/pages/Links.test.tsx`**

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import Links from "./Links";

const LINKS = {
  links: [
    {
      id: 1,
      slug: "launch",
      shortUrl: "https://link.test/launch",
      targetUrl: "https://example.com/launch",
      title: "Launch",
      description: null,
      hasPassword: false,
      expiresAt: null,
      expiredUrl: null,
      isActive: true,
      createdAt: 1_800_000_000,
      updatedAt: 1_800_000_000,
      deletedAt: null,
      tags: [{ id: 7, name: "spring", color: "#199e70" }],
    },
  ],
  total: 1,
};

function stub(routes: Record<string, unknown>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) => {
      const path = new URL(String(input), "https://link.test").pathname;
      const body = routes[path];
      return body ? Response.json(body) : Response.json({ error: "not_found" }, { status: 404 });
    }),
  );
}

afterEach(() => vi.unstubAllGlobals());

function renderLinks() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Links />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Links", () => {
  it("lists each link with its slug and destination", async () => {
    stub({
      "/api/links": LINKS,
      "/api/tags": { tags: [] },
      "/api/stats/sparklines": { days: 7, series: { "1": [0, 1, 2, 0, 3, 1, 4] } },
    });
    renderLinks();
    expect(await screen.findByText("launch")).toBeInTheDocument();
    expect(screen.getByText("https://example.com/launch")).toBeInTheDocument();
  });

  it("shows a link's tags", async () => {
    stub({
      "/api/links": LINKS,
      "/api/tags": { tags: [] },
      "/api/stats/sparklines": { days: 7, series: {} },
    });
    renderLinks();
    expect(await screen.findByText("spring")).toBeInTheDocument();
  });

  it("searches by typing, and asks the API rather than filtering in the browser", async () => {
    stub({
      "/api/links": LINKS,
      "/api/tags": { tags: [] },
      "/api/stats/sparklines": { days: 7, series: {} },
    });
    renderLinks();
    await screen.findByText("launch");

    await userEvent.type(screen.getByRole("searchbox", { name: /search/i }), "spr");

    const calls = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    const searched = calls.some((c) => String(c[0]).includes("search=spr"));
    expect(searched).toBe(true);
  });

  it("offers an empty state with a way forward when there are no links", async () => {
    stub({
      "/api/links": { links: [], total: 0 },
      "/api/tags": { tags: [] },
      "/api/stats/sparklines": { days: 7, series: {} },
    });
    renderLinks();
    expect(await screen.findByText(/no links yet/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /new link/i })).toBeInTheDocument();
  });

  it("marks a deactivated link in words, not only by styling", async () => {
    stub({
      "/api/links": { links: [{ ...LINKS.links[0], isActive: false }], total: 1 },
      "/api/tags": { tags: [] },
      "/api/stats/sparklines": { days: 7, series: {} },
    });
    renderLinks();
    expect(await screen.findByText(/inactive/i)).toBeInTheDocument();
  });

  it("surfaces an API failure instead of showing an empty list", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ error: "boom" }, { status: 500 })),
    );
    renderLinks();
    expect(await screen.findByRole("alert")).toHaveTextContent(/could not load/i);
  });
});
```

- [ ] **Step 4: Write the page**

Structure: a header with the page title and a "New link" button; a filter row holding the search box (`type="search"`, labelled, debounced 250ms into the query key), a status `Select`, and a tag `Select`; then the list.

Each `LinkRow` shows the slug in the display face, the destination truncated beneath it, tag badges, a seven-day sparkline pulled from the `useSparklines` map by link id, the click total, a copy button, and a menu with Edit, QR, Deactivate and Delete. A row links to `/links/:id` for the detail page.

Below `sm`, the row becomes a stacked card: slug and status on one line, destination on the next, sparkline and actions on a third. Above `sm`, a grid with columns. Do not use a `<table>` here — the rows are navigational cards rather than tabular data, and the responsive collapse is far cleaner without one.

Pagination is a "Load more" button rather than numbered pages: the API takes `limit` and `offset`, the list is chronological, and a cursor the reader has to think about adds nothing.

- [ ] **Step 5: Run the tests**

Run: `npm test -- web/src`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(web): add the links list with search and filters"
```

---

## Task 10: Creating and editing links, and the command palette

**Files:**
- Create: `web/src/components/links/LinkForm.tsx`, `LinkDialog.tsx`, `TagPicker.tsx`, `CommandPalette.tsx`, `ConfirmDialog.tsx`
- Modify: `web/src/pages/Links.tsx`, `web/src/components/layout/AppShell.tsx`, `web/src/components/links/LinkRow.tsx`
- Test: `web/src/components/links/LinkForm.test.tsx`, `CommandPalette.test.tsx`, `LinkRow.test.tsx`

**Interfaces:**
- Consumes: `useCreateLink`, `useUpdateLink`, `useTags`, `useSetLinkTags` (Task 2); `Dialog`, `Field`, `Button` (Task 4).
- Produces: `<LinkDialog mode="create"|"edit" link? open onOpenChange>`; a `⌘K` palette mounted in the shell.

- [ ] **Step 1: Write the failing test `web/src/components/links/LinkForm.test.tsx`**

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LinkForm } from "./LinkForm";

afterEach(() => vi.unstubAllGlobals());

function renderForm(props: Partial<Parameters<typeof LinkForm>[0]> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <LinkForm mode="create" onDone={() => {}} {...props} />
    </QueryClientProvider>,
  );
}

describe("LinkForm", () => {
  it("requires a destination before it will submit", async () => {
    renderForm();
    await userEvent.click(screen.getByRole("button", { name: /create/i }));
    expect(await screen.findByText(/enter a destination/i)).toBeInTheDocument();
  });

  it("rejects a destination that is not http or https before calling the API", async () => {
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    renderForm();
    await userEvent.type(screen.getByLabelText(/destination/i), "javascript:alert(1)");
    await userEvent.click(screen.getByRole("button", { name: /create/i }));
    expect(await screen.findByText(/must start with http/i)).toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();
  });

  it("sends an optional slug only when one was typed", async () => {
    const spy = vi.fn().mockResolvedValue(Response.json({ link: { id: 1, slug: "x" } }));
    vi.stubGlobal("fetch", spy);
    renderForm();
    await userEvent.type(screen.getByLabelText(/destination/i), "https://example.com");
    await userEvent.click(screen.getByRole("button", { name: /create/i }));
    const body = JSON.parse(String((spy.mock.calls[0] as [string, RequestInit])[1].body));
    expect(body).not.toHaveProperty("slug");
  });

  it("maps the API's slug_taken to the slug field rather than a generic banner", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ error: "slug_taken" }, { status: 409 })),
    );
    renderForm();
    await userEvent.type(screen.getByLabelText(/destination/i), "https://example.com");
    await userEvent.type(screen.getByLabelText(/custom slug/i), "taken");
    await userEvent.click(screen.getByRole("button", { name: /create/i }));
    expect(await screen.findByText(/already in use/i)).toBeInTheDocument();
  });

  it("maps reserved_slug to a message that says which slugs are reserved", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ error: "reserved_slug" }, { status: 422 })),
    );
    renderForm();
    await userEvent.type(screen.getByLabelText(/destination/i), "https://example.com");
    await userEvent.type(screen.getByLabelText(/custom slug/i), "api");
    await userEvent.click(screen.getByRole("button", { name: /create/i }));
    expect(await screen.findByText(/reserved/i)).toBeInTheDocument();
  });

  it("explains the rate limit rather than showing a raw 429", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ error: "rate_limited" }, { status: 429 })),
    );
    renderForm();
    await userEvent.type(screen.getByLabelText(/destination/i), "https://example.com");
    await userEvent.click(screen.getByRole("button", { name: /create/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/too many links/i);
  });

  it("offers clearing the password when editing a protected link", () => {
    renderForm({
      mode: "edit",
      link: {
        id: 1,
        slug: "x",
        shortUrl: "https://link.test/x",
        targetUrl: "https://example.com",
        title: null,
        description: null,
        hasPassword: true,
        expiresAt: null,
        expiredUrl: null,
        isActive: true,
        createdAt: 0,
        updatedAt: 0,
        deletedAt: null,
        tags: [],
      },
    });
    expect(screen.getByRole("button", { name: /remove password/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npm test -- web/src/components/links/LinkForm.test.tsx`
Expected: FAIL — the module does not exist.

- [ ] **Step 3: Write `LinkForm.tsx`**

`react-hook-form` with a `zod` resolver. The schema mirrors the API's own validation so the obvious mistakes never leave the browser, but the API stays authoritative — every error code it can return is mapped to a field or to a banner:

| API error | Where it lands | Message |
| --- | --- | --- |
| `slug_taken` | slug field | "That slug is already in use." |
| `reserved_slug` | slug field | "That slug is reserved. Pick another." |
| `invalid_slug` | slug field | "Use letters, digits, dashes and underscores." |
| `unsupported_protocol` | destination | "Only http and https destinations are allowed." |
| `self_reference` | destination | "A link cannot point at the shortener itself." |
| `invalid` / `too_long` | destination | "That does not look like a URL." |
| `invalid_expired_url` | fallback field | "That does not look like a URL." |
| `rate_limited` | banner | "Too many links created recently. Try again shortly." |
| anything else | banner | "Something went wrong. Try again." |

Fields: destination (required), custom slug (optional, with the generated-by-default hint), title, description, expiry (a `datetime-local` mapped to unix seconds), fallback URL shown only when an expiry is set, password, and the tag picker. When editing a link that has a password, a "Remove password" button sends `password: null` — that is the whole reason the API distinguishes absent from null.

On success in create mode, copy the new short URL to the clipboard immediately and confirm it in a toast. Creating a link and then hunting for a copy button is the single most repeated action in this product.

- [ ] **Step 4: Write the failing test `web/src/components/links/CommandPalette.test.tsx`**

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { CommandPalette } from "./CommandPalette";

function renderPalette() {
  const client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <CommandPalette />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("CommandPalette", () => {
  it("is closed until it is asked for", () => {
    renderPalette();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens on the platform shortcut", async () => {
    renderPalette();
    await userEvent.keyboard("{Meta>}k{/Meta}");
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("opens on Control-K too, for anyone not on a Mac", async () => {
    renderPalette();
    await userEvent.keyboard("{Control>}k{/Control}");
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("closes on Escape", async () => {
    renderPalette();
    await userEvent.keyboard("{Meta>}k{/Meta}");
    await screen.findByRole("dialog");
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("offers creating a link and reaching each section", async () => {
    renderPalette();
    await userEvent.keyboard("{Meta>}k{/Meta}");
    expect(await screen.findByText(/new link/i)).toBeInTheDocument();
    expect(screen.getByText(/overview/i)).toBeInTheDocument();
    expect(screen.getByText(/settings/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 5: Write `CommandPalette.tsx`**

Built on `cmdk`. Bind both `Meta+K` and `Control+K`, and do not swallow the shortcut when focus is inside a text input where the browser's own behaviour matters. Actions: New link, then one per section, then the most recent links by title so a reader can jump to a detail page by name.

- [ ] **Step 6: Reintroduce the row menu in `LinkRow.tsx`, with every item wired**

Task 9 built this menu with four items and no handlers, and it was removed
rather than shipped inert: Radix's `DropdownMenu.Item disabled` sets
`aria-disabled` but also passes `focusable: !disabled` into the roving-focus
group, whose arrow handler cycles only focusable entries — so a disabled item is
skipped by exactly the interaction an ARIA menu is operated with, showing a
sighted user a greyed entry while telling a screen-reader user nothing.

**Until this step lands there is no way to edit, deactivate or delete a link
anywhere in the interface.** That is the reason this step is here and not
deferred again.

Restore the trigger and four items. Wire each one:

- **Edit** opens `<LinkDialog mode="edit" link={link}>` — the dialog this task
  already builds.
- **QR code** navigates to `/links/:id`, where Task 11 renders the panel. Do not
  build a second QR surface here.
- **Deactivate / Activate** calls `useUpdateLink` with the flipped `isActive`.
  This one is reversible in a single click, so it needs no confirmation.
- **Delete** opens `ConfirmDialog` and only calls `useDeleteLink` on
  confirmation. It never deletes on the menu click itself.

`ConfirmDialog` wraps the `Dialog` primitive from Task 4: a heading naming the
exact object being destroyed (the slug, not "this link"), the consequence in one
sentence, a cancel that is the default focus, and a confirm carrying
`--color-critical`. Cancel must be what `Escape` and an outside click both do.

An item that is genuinely unavailable to the user later — a permission they lack
rather than a feature not yet built — must use a plain `aria-disabled="true"`
passthrough plus `onSelect={(e) => e.preventDefault()}`, keeping it inside the
roving-focus set. Never Radix's `disabled` prop, for the reason above.

Test in `LinkRow.test.tsx`: Edit opens the dialog in edit mode with the link's
current values; Deactivate calls the mutation with the flipped flag; **Delete
does not call the mutation until the confirmation is accepted**, and cancelling
leaves it uncalled. That third one is the test that matters — write it so it
fails if the confirmation is bypassed.

- [ ] **Step 7: Run the tests, then commit**

Run: `npm test -- web/src`

```bash
git add -A
git commit -m "feat(web): add link creation, editing and the command palette"
```

---

## Task 11: The link detail page

**Files:**
- Create: `web/src/pages/LinkDetail.tsx`, `web/src/components/links/QrPanel.tsx`, `web/src/components/charts/LiveFeed.tsx`
- Modify: `web/src/App.tsx`, `web/src/lib/queries.ts`, `src/db/clicks.ts`, `src/routes/api/stats.ts`
- Test: `web/src/pages/LinkDetail.test.tsx`, `web/src/components/links/QrPanel.test.tsx`, `test/routes/stats-api.test.ts`

**Interfaces:**
- Consumes: every chart from Tasks 5 to 8; `useLink`, `useSummary`, `useTimeseries`, `useDimension`, `useLive`.
- Produces: the `/links/:id` route.

**Step 0 comes first, and without it this task cannot be correct.** The four
stats hooks in `web/src/lib/queries.ts` take a range and no link, so a detail
page built on them as they stand would show every link's numbers under one
link's name — a page that lies rather than one that is merely incomplete.

Three of the four API routes already accept an optional `linkId` (`rangeSchema`
in `src/routes/api/stats.ts` declares it and passes it straight through to the
db layer), so for `summary`, `timeseries` and `dimension` only the client is
missing. `/live` is the exception: it takes a limit and nothing else, and
`recentClicks` has no link filter at all.

- [ ] **Step 0: Scope the stats to one link, end to end**

Give `recentClicks(db, limit, linkId?)` an optional link filter — a `WHERE
c.link_id = ?` when one is supplied, the current unfiltered query when it is
not. Give `/live` the same optional `linkId` the other three routes already
accept, parsed the same way.

Then thread an optional `linkId` through `useSummary`, `useTimeseries`,
`useDimension` and `useLive`. **It must be part of each query key**, or the
detail page will serve one link's numbers out of the cache for another.

Do not filter the global live feed on the client instead. The feed returns the
50 most recent clicks across all links, so a link outside that window would
render as "no recent activity" while it is in fact being clicked — a false
statement, not a missing one.

Worker tests in `test/routes/stats-api.test.ts`: each of the four routes, given two
links with clicks, returns only the requested link's rows when `linkId` is
supplied and both links' rows when it is not. Write them so they fail if the
filter is dropped.

This is the "ricchissima" screen spec §6.1 describes: every dimension the API exposes, as a ranked list with proportional bars, plus the heatmap, the live feed, the QR code and the outcome breakdown.

The dimension panels, in this order — the order matters because it moves from *who* to *how* to *where from*:

| Panel | Dimension | Notes |
| --- | --- | --- |
| Countries | `country` | with a flag glyph derived from the alpha-2 code |
| Cities | `city` | |
| Devices | `device` | |
| Operating systems | `os` | |
| Browsers | `browser` | |
| Languages | `language` | |
| Networks | `asn_org` | |
| Channels | `referrer_type` | direct, search, social, email, AI, other |
| Referrers | `referrer_host` | |
| Campaigns | `utm_campaign` | shown only when non-empty |
| Sources | `utm_source` | shown only when non-empty |
| Mediums | `utm_medium` | shown only when non-empty |
| Scans vs clicks | `source` | |
| Outcomes | `outcome` | how many hit an expired link or failed a password |

Each panel is a `ChartFrame` wrapping `RankedBars`, which means each gets a table view for free.

- [ ] **Step 1: Write the failing test `web/src/pages/LinkDetail.test.tsx`**

Cover, with the same `stub` helper shape as Task 9: the page shows the link's slug and short URL; a period selector changes the range sent to the API; the heatmap renders; the live feed lists recent clicks; the outcome panel appears; a 404 from the API renders "That link does not exist" rather than an empty shell; and the UTM panels are absent when their dimensions return no slices.

- [ ] **Step 2: Write the failing test `web/src/components/links/QrPanel.test.tsx`**

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { QrPanel } from "./QrPanel";

describe("QrPanel", () => {
  it("points at the API's SVG endpoint for this link", () => {
    render(<QrPanel linkId={42} slug="demo" />);
    expect(screen.getByRole("img", { name: /qr code for demo/i })).toHaveAttribute(
      "src",
      "/api/links/42/qr.svg",
    );
  });

  it("offers an SVG download", () => {
    render(<QrPanel linkId={42} slug="demo" />);
    expect(screen.getByRole("link", { name: /download svg/i })).toHaveAttribute(
      "download",
      "demo.svg",
    );
  });

  it("explains that scans are counted separately", () => {
    render(<QrPanel linkId={42} slug="demo" />);
    expect(screen.getByText(/counted separately/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Implement**

`QrPanel` renders `<img src={/api/links/${linkId}/qr.svg}>` with a real `alt`, a download link for the SVG, and a PNG download produced by drawing the SVG onto a canvas at 1024px — done in the browser so no new endpoint is needed. It states plainly that a scan is counted separately from a click, because that is a genuine analytic distinction a reader will otherwise miss.

`LiveFeed` lists recent clicks with a relative timestamp, country, device, channel and outcome, refreshing every ten seconds through `useLive`. Wrap the list in `aria-live="polite"` **off** — an auto-refreshing feed that announces itself every ten seconds is hostile to a screen-reader user. Provide a "Pause" toggle instead, and let the reader ask for updates.

- [ ] **Step 4: Run the tests, then commit**

```bash
git add -A
git commit -m "feat(web): add the link detail page with every dimension"
```

---

## Task 12: The overview page

**Files:**
- Create: `web/src/pages/Overview.tsx`, `web/src/components/PeriodPicker.tsx`
- Modify: `web/src/App.tsx`, `web/src/lib/queries.ts`, `src/db/stats.ts`, `src/routes/api/stats.ts`
- Test: `web/src/pages/Overview.test.tsx`, `web/src/components/PeriodPicker.test.tsx`, `test/routes/stats-api.test.ts`

**Interfaces:**
- Consumes: `PERIODS`, `rangeFor`, `granularityFor` (Task 7); `StatTile`, `TimeSeries`, `RankedBars`, `WorldMap`, `Heatmap`.
- Produces: the `/` route; `<PeriodPicker value onChange>`; `useTopLinks(range, limit)`.

- [ ] **Step 0: Give the top-links panel a real data source**

The grid below calls for a "top links" panel, and nothing can currently answer
it. `DIMENSION_COLUMNS` has no link dimension, `/api/links` carries no click
count and cannot sort by one, and `useSparklines` is a fixed trailing-N-days
window that ignores the period picker entirely — using it would show one period's
ranking under another period's heading.

Add `topLinks(db, range, limit)` to `src/db/stats.ts`:

```sql
SELECT l.id AS id, l.slug AS slug, l.title AS title,
       COUNT(*) AS clicks,
       COUNT(DISTINCT c.visitor_hash) AS uniques
FROM clicks c
JOIN links l ON l.id = c.link_id
WHERE c.ts >= ? AND c.ts < ? AND c.is_bot = 0 AND l.deleted_at IS NULL
GROUP BY l.id
ORDER BY clicks DESC, l.slug ASC
LIMIT ?
```

Write the WHERE clause out rather than reusing `scope()`. That helper emits bare
`ts` and `link_id`, which happen to be unambiguous under this join today only
because `links` has neither column — a fragile thing to depend on, and it also
has a `linkId` branch that makes no sense for a ranking across links.

Soft-deleted links are excluded deliberately. A top-N list never sums to the
period total anyway, so their absence introduces no discrepancy a reader could
misread, and every row in this panel links to a detail page that a deleted link
does not have.

Expose it at `/api/stats/top-links`, parsing the same `from`/`to` the other stats
routes take and a `limit` bounded like `/dimension`'s. Then add
`useTopLinks(range, limit)` to `web/src/lib/queries.ts`, with the range in the
query key.

Worker tests in `test/routes/stats-api.test.ts`: ranks by click count within the
window; excludes clicks outside it; excludes bot clicks; excludes soft-deleted
links; and breaks ties by slug so the order is deterministic. Write them so each
fails if its clause is dropped.

Layout, top to bottom: the period picker; a row of four stat tiles (clicks, unique visitors, countries reached, bot share) each with a delta against the preceding window; the time series; then a two-column grid holding top links, the world map, devices and channels; then the heatmap full width.

**Only two of the four tiles get a sparkline, and that is deliberate.**
`useSummary` returns `{ current, previous }`, so all four have their delta. But
the only per-bucket source is `useTimeseries`, which returns `bucket, clicks,
uniques` and nothing else — and its query carries `AND is_bot = 0`, so a bot
series is impossible from it by construction, not merely absent. There is no
per-bucket country count anywhere.

So: clicks and uniques take their `spark` from the timeseries buckets; countries
and bots pass no `spark` at all (`StatTile`'s prop is optional). Do not
fabricate a two-point series from `current` and `previous` to fill the space — a
sparkline that is really a single delta drawn as a line is a chart that lies
about how much it knows.

Extending `/api/stats/timeseries` to carry per-bucket countries and bots would
change the semantics of a chart already shipped and reviewed in Tasks 7 and 11,
including tests that pin its `linkId` scoping. That is a deliberate change with
its own review, not a drive-by inside a page task.

**Bot share is `bots / (clicks + bots)`.** `summary.clicks` already excludes
bots — `SUM(CASE WHEN is_bot = 0 ...)` — so dividing by `clicks` alone would be
a share of the wrong denominator and could exceed 100%. The denominator is every
recorded hit. The `--color-warning` threshold of 50% therefore means "more than
half of all recorded traffic was automated", which is the sentence a reader will
form on seeing it.

The summary and the time series agree on what a click is: both exclude bots.
Nothing on this page should imply otherwise.

- [ ] **Step 1: Write the failing test `web/src/components/PeriodPicker.test.tsx`**

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PeriodPicker } from "./PeriodPicker";

describe("PeriodPicker", () => {
  it("is a radio group, so arrow keys move between periods", () => {
    render(<PeriodPicker value="7d" onChange={() => {}} />);
    expect(screen.getByRole("radiogroup", { name: /period/i })).toBeInTheDocument();
  });

  it("marks the current period for assistive technology", () => {
    render(<PeriodPicker value="7d" onChange={() => {}} />);
    expect(screen.getByRole("radio", { name: /7 days/i })).toBeChecked();
  });

  it("reports the chosen period", async () => {
    const onChange = vi.fn();
    render(<PeriodPicker value="7d" onChange={onChange} />);
    await userEvent.click(screen.getByRole("radio", { name: /30 days/i }));
    expect(onChange).toHaveBeenCalledWith("30d");
  });
});
```

- [ ] **Step 2: Write the failing test `web/src/pages/Overview.test.tsx`**

Cover: the four stat tiles render with values from `/api/stats/summary`; changing the period re-queries with a different `from`; the unique-visitor tile carries the caveat that summed daily uniques count a returning visitor once per day — spec §6.4 requires that limitation be surfaced where a consumer sees it, and this is that place; a failing summary shows an alert rather than four zeros.

The caveat text to assert: `/counted once per day/i`.

- [ ] **Step 3: Implement**

`PeriodPicker` is a Radix-free radio group — native `<input type="radio">` styled as segmented controls, because that gives roving arrow-key navigation with no JavaScript. The selected period wears the accent, which is the accent's job.

The unique-visitor tile's `hint` reads: "A visitor returning on several days is counted once per day — the privacy design rotates their code at midnight."

Bot share is rendered as a percentage of total clicks with the raw bot count as its hint, and it uses `--color-warning` only when it exceeds 50%, with the word "high" beside it.

- [ ] **Step 4: Run the tests, then commit**

```bash
git add -A
git commit -m "feat(web): add the overview page"
```

---

## Task 13: Tags and settings

**Files:**
- Create: `web/src/pages/Tags.tsx`, `web/src/pages/Settings.tsx`
- Modify: `web/src/App.tsx`, `web/src/lib/queries.ts`, `web/src/vite-env.d.ts`, `web/vite.config.ts`, `src/routes/api.ts`
- Test: `web/src/pages/Tags.test.tsx`, `web/src/pages/Settings.test.tsx`, `test/routes/meta.test.ts`

**Interfaces:**
- Consumes: `useTags`, `useCreateTag`, `useDeleteTag`, `useSessions`, `useRevokeSession`, `useRevokeAllSessions`, `useLogout`.
- Produces: the `/tags` and `/settings` routes; `useMeta()`.

- [ ] **Step 0: Give the About and Data groups something to read**

Two of the three facts Settings is meant to display have no client-visible
source. `RAW_RETENTION_DAYS` and `SHORT_DOMAIN` are Worker environment
variables — used by the cron and by the server-rendered `/privacy` page, and
reachable from no API. The dashboard cannot state a retention window it has no
way to learn, and inventing a constant in the client would be a number that
drifts silently from the one the deletion job actually uses.

Add `GET /api/meta`, authenticated like every other `/api` route, returning:

```json
{ "retentionDays": 180, "shortDomain": "link.margio.uk" }
```

`retentionDays` is `Number(env.RAW_RETENTION_DAYS)`. Neither value is a secret —
both are already stated on the public `/privacy` page — but the route stays
behind the session like the rest of `/api`, because there is no reason to widen
the anonymous surface for them.

Then add `useMeta()` to `web/src/lib/queries.ts`.

Worker tests in `test/routes/meta.test.ts`: the route requires a session; it
returns the retention days as a **number**, not the environment's string; and it
returns the configured short domain. Write the number assertion so it fails if
the value is passed through unconverted — `"180"` and `180` are different
answers and only one of them formats correctly.

The version is a separate matter and belongs to the build, not the API: inject
`package.json`'s version via Vite's `define` in `web/vite.config.ts`, declare it
in `web/src/vite-env.d.ts`, and read it in the About group. Do not add it to the
meta endpoint — the Worker and the dashboard are built together here, but the
version a reader wants in About is the one baked into the assets they are
looking at.

- [ ] **Step 1: Write the failing tests**

`Tags.test.tsx` covers: existing tags are listed with their colour swatch **and** their name as text; creating a tag sends name and colour; a duplicate name (`409 tag_exists`) shows "A tag with that name already exists"; deleting asks for confirmation first and explains that links keep existing; the colour input rejects a non-hex value before calling the API.

`Settings.test.tsx` covers: active sessions are listed with their device label and last-seen time; the current session is marked as such and its individual revoke control is absent — signing yourself out is what the Sign out button is for; "Revoke all other sessions" asks for confirmation; the retention window is shown as a read-only fact with its source named ("set by RAW_RETENTION_DAYS on the Worker"); and the export control downloads what the API returns.

- [ ] **Step 2: Implement**

Settings shows three groups: **Sessions** (the list plus the two revoke actions), **Data** (the retention window read-only, and a CSV export built in the browser from the links list plus the stats endpoints — no new endpoint), and **About** (the deployment's short domain and retention window from `useMeta()`, a link to `/privacy`, and the project's version injected at build time by Vite's `define`).

The CSV export pages through `/api/links` rather than exporting one page. The
list is paginated at 50, so an export that takes only the first page would hand
a reader a file that looks complete and silently is not — the worst shape of
wrong, and one this plan has already had to fix twice. If the export cannot
complete, say so; do not produce a partial file without saying it is partial.

The retention figure is read-only on purpose: it is a Worker environment variable, and a control that appears to change it but cannot would be a lie. Say where it is set.

- [ ] **Step 3: Run the tests, then commit**

```bash
git add -A
git commit -m "feat(web): add the tags and settings pages"
```

---

## Task 14: Accessibility, integration and the completion gate

**Files:**
- Modify: `README.md`, `CHANGELOG.md`, `web/src/styles/app.css`, whatever the audit turns up
- Test: `web/src/a11y.test.tsx`

**Interfaces:**
- Consumes: every page.
- Produces: nothing new — this task hardens and proves what exists.

- [ ] **Step 0: Seven items carried forward from earlier tasks**

Each was found during an earlier review, judged real, and deliberately deferred
to this task because it needs the whole application in view rather than one
page. None is a licence to redesign; each is a decision to take with evidence.

1. **The not-found page.** `App.tsx` has a `/*` catch-all rendering
   `<Placeholder />`, which was correct while `/tags` and `/settings` were
   unbuilt — turning it into a 404 then would have broken two live navigation
   links. Task 13 finished those pages, so every entry in
   `PrimaryNav.SECTIONS` now resolves and the catch-all is pure leftover: a
   mistyped URL shows a development scaffold. Replace it, and delete
   `Placeholder` if nothing else uses it.

2. **A failed tags query is not announced.** The "Tag filter unavailable" note
   on the links page is not a live region, so a mid-session load-to-error
   transition changes the page silently for a screen-reader user. Judge whether
   `role="status"` belongs there, and check every other panel that swaps to an
   error state after a successful first render for the same gap.

3. **`ChartFrame` with two series, in light mode.** §6.4 requires a legend
   whenever there are two or more series, direct labels at four or fewer, and
   treats a contrast WARN as obliging visible labels or a table view rather than
   as dismissable. The overview and detail time series both draw clicks and
   uniques. Task 11's reviewer flagged that it could not judge this from its own
   diff because `ChartFrame` predates that task. Check it in both themes.

4. **Route-level code splitting.** The main entry was measured at 643.97 kB raw
   / 208.43 kB gzip, with every route inside it. The only chunk that splits is
   the world atlas, and only because Task 8 was told to import it dynamically.
   The two candidates are the link detail page, which pulls every chart
   including the map for a reader who may only open the overview, and the login
   screen, which is the one page an unauthenticated visitor sees and currently
   arrives with the whole authenticated dashboard behind it.

   **Measure before splitting, and split only where a real page's first paint
   improves.** A dozen small chunks on an internal dashboard behind a login can
   cost more in requests than they save in bytes. Reporting "measured, not worth
   it" is a complete and acceptable answer.

5. **The detail page has no edit, deactivate or delete control of its own.**
   Every action lives in the links list's row menu, so a reader who has
   navigated into a link must go back to change it. Judge whether that round
   trip is acceptable. **Do not add them reflexively:** duplicating a
   destructive action onto a second surface doubles the ground on which the
   confirmation can be bypassed, and the list's menu is the tested path.

6. **The bot-share tile carries a word but no icon.** §6.3's literal text asks
   for both. The codebase's own `Badge` treats colour plus word as sufficient,
   so there is a precedent either way. Decide once, for the whole application,
   and make the two agree.

7. **Stat tiles have no table view.** Every `ChartFrame` provides one; `StatTile`
   does not, because it predates the rule. Judge whether a tile showing one
   number and a sparkline needs one — the sparkline is the only part carrying
   data a table could restate.

- [ ] **Step 1: Write `web/src/a11y.test.tsx`**

A cross-cutting sweep that renders each page against stubbed API responses and asserts the properties spec §6.2 commits to:

```tsx
// For each page: Overview, Links, LinkDetail, Tags, Settings
// - exactly one <h1>
// - heading levels never skip (h1 then h2, never h1 then h3)
// - every <img> has alt text, or aria-hidden when decorative
// - every form control has an accessible name
// - every button has an accessible name
// - no element uses a positive tabIndex
// - every chart is inside a section with an accessible name
```

Write it as a `describe.each` over the pages so adding a page later means adding one line, not a new file.

- [ ] **Step 2: Run it and fix what it finds**

Run: `npm test -- web/src/a11y.test.tsx`

Fix the components, not the test. Report anything you fix.

- [ ] **Step 3: Verify the colour contract by running the validator**

The palette in `tokens.css` must still be the one spec §6.3 recorded. Run, from the repository root:

```bash
node /private/tmp/claude-501/bundled-skills/2.1.252/dc517f86f9702fe0c511ff649de8fb05/dataviz/scripts/validate_palette.js \
  "#3987e5,#d95926,#199e70,#c98500,#d55181,#008300,#9085e9,#e66767" \
  --mode dark --surface "#12100E"
```

That path was confirmed to exist when this task was written. It lives in a
temporary skill bundle, so if it has gone, find it with
`find / -name validate_palette.js -path '*dataviz*'` and say in your report that
it moved — do not skip the step and do not reason about the palette by hand.

and the light equivalent with surface `#FAF7F2`. Paste both reports into your report. Both must pass; the light report's contrast WARN is expected and is discharged by the table view every `ChartFrame` provides.

- [ ] **Step 4: Check the bundle**

Run: `npm run build:web`

Report the chunk sizes. The main entry should be well under 300KB gzipped and the world atlas must be its own chunk. If the entry has grown past that, say what is in it rather than shipping it quietly.

- [ ] **Step 5: Run the whole gate**

```bash
npm test
npm run check
npm run typecheck
npm run build:web
npx wrangler deploy --dry-run
```

All five must pass, with output shown.

- [ ] **Step 6: Drive the real thing**

```bash
npm run build:web
npx wrangler dev
```

Then, in a browser: sign in, create a link from the command palette, follow the short link in another tab, watch it appear in the live feed, open the link's detail page, switch a chart to its table view, toggle the theme, and walk the whole interface with the keyboard alone — no pointer.

**If you have no browser automation available, say so plainly and stop at that
point rather than describing what you believe would happen.** The controller has
browser tooling and will drive this step. An invented walkthrough is worse than
an absent one: it is the only step in this plan whose whole purpose is to test
the thing no test can.

Report what you did and what you saw. Capture a screenshot of the overview in both themes. **If any of it does not work, report it rather than fixing it silently** — a defect found here matters more than a tidy report.

- [ ] **Step 7: Update the documentation**

`README.md`: replace the "Status" note and the Roadmap section, since the dashboard now exists. Document how to reach it (`/app`), what it does, and that it is built and served by the same Worker. Add the two new npm scripts.

`CHANGELOG.md`: add the dashboard under Unreleased → Added, written from an operator's point of view.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "docs: describe the dashboard and record the accessibility sweep"
```

---

## Task 15: End-to-end tests in CI

**Files:**
- Create: `e2e/playwright.config.ts`, `e2e/fixtures.ts`, `e2e/seed.ts`, `e2e/auth.spec.ts`, `e2e/keyboard.spec.ts`, `e2e/artefacts.spec.ts`, `e2e/a11y.spec.ts`
- Modify: `package.json`, `.github/workflows/ci.yml`, `.gitignore`, `README.md`, `CONTRIBUTING.md`

**Interfaces:**
- Consumes: the built Worker, served by `wrangler dev`.
- Produces: `npm run e2e`, and a CI job that runs it on every pull request.

**Why this task exists, in one sentence:** every serious defect that reached a
review on this branch was invisible to 600 passing tests and visible in a
browser in seconds.

That is not an accident. `jsdom` has no CSS cascade, no layout, no real focus
model, no canvas, and no navigation. So it cannot see a focus ring that never
renders, a redirect that loops, a PNG that comes out blank, or a colour that
fails contrast. Task 14's Step 6 asked a human to check those by hand once —
which proves nothing about tomorrow. This task replaces that step with
something a pull request has to pass.

**Every scenario below is derived from a defect this branch actually shipped.**
None is hypothetical, and each names the commit that fixed it so a future reader
can see why the test exists.

- [ ] **Step 1: Install and configure**

Add `@playwright/test` and `@axe-core/playwright` as devDependencies, and add
`"e2e": "playwright test"` plus `"e2e:ui": "playwright test --ui"` to the
scripts.

`e2e/playwright.config.ts` uses Playwright's `webServer` to build the dashboard
and start the Worker, and waits for it before running:

```ts
webServer: {
  command: "npm run build:web && npx wrangler dev --port 8787 --local",
  url: "http://localhost:8787/_health",
  reuseExistingServer: !process.env.CI,
  timeout: 120_000,
}
```

Use `chromium` only. A second engine doubles CI time for this suite and none of
the defects it covers were engine-specific; say so in a comment so the choice
reads as a decision rather than an oversight.

Set `trace: "retain-on-failure"` and `video: "retain-on-failure"`. When this
suite catches something, the person reading the CI log needs to see it.

Add `e2e/.artifacts/`, `test-results/` and `playwright-report/` to `.gitignore`.

- [ ] **Step 2: Deterministic credentials and seed data**

The suite must never depend on a developer's real `.dev.vars`, and CI has no
secrets for it. `e2e/seed.ts` and the CI job both use fixed values:

```
ADMIN_USER=e2e
ADMIN_PASSWORD=e2e-password-not-a-secret
HASH_SECRET=e2e-hash-secret-not-a-secret
```

CI writes those into `.dev.vars` before starting the server. State in a comment
that these are test values with no production meaning — a reader who finds a
password in a workflow file should be able to tell in one line whether to panic.

`e2e/seed.ts` creates, through the real API rather than by touching the
database: two links (one with a title that begins `=1+1`, one soft-deleted), a
tag, and enough clicks across several days and countries that the overview,
the map and the heatmap all have something to draw. An empty dashboard proves
almost nothing — every panel renders its empty state and no chart is exercised.

- [ ] **Step 3: `e2e/auth.spec.ts` — the navigation defects**

Fixed in `2236979`. `BrowserRouter basename="/app"` prepends `/app` itself, and
two call sites passed targets that already carried it, producing `/app/app/...`,
which matched no route. 599 tests were green because every test file mounted a
router **without** a basename.

- Signing in lands on the overview, and the URL is exactly `/app`.
- Visiting `/app/links` with no session redirects to `/app/login` — **once**.
  Assert the final URL and that the page shows the sign-in form, and fail if the
  browser recorded more than a couple of navigations: the original bug was an
  infinite loop, and a test that only checks the final state could pass while
  the browser spun.
- Signing out returns to `/app/login`.
- A mistyped path such as `/app/lnks` shows the not-found page, not a
  development placeholder.

- [ ] **Step 4: `e2e/keyboard.spec.ts` — the focus defects**

Fixed in `acb7738`. The period picker's focus ring could never render: the
`peer-focus-visible:` classes sat on the input's **parent**, and that variant
compiles to a sibling combinator. No test in the suite could see it.

- Tab to each period option and assert `outline-width` on the focused control's
  styled box is not `0px` and its `outline-color` is not transparent, read from
  `getComputedStyle`. This is the assertion the old suite structurally could not
  make.
- Reach and operate the command palette, the create-link dialog and the delete
  confirmation using the keyboard alone — no `page.click`. Assert the delete
  confirmation takes focus on **Cancel**, that `Escape` dismisses it, and that
  the mutation did not fire.
- Walk the primary navigation with `Tab` and assert focus never leaves the
  document and never lands on something with no accessible name.

- [ ] **Step 5: `e2e/artefacts.spec.ts` — the files we hand to people**

Fixed in `ebe93a8` and `b34c31d`. The QR PNG encoded a different URL than the
server's SVG, so a scan of a printed code would never have counted as a scan;
and the CSV export was open to formula injection.

- Download the QR PNG, decode it with `jsqr` (already a devDependency), and
  assert it decodes to the short URL **including** the `?s=qr` marker. This is
  the one assertion that catches a QR which renders perfectly and encodes the
  wrong thing, and it needs a real canvas — which is exactly why jsdom could
  not make it.
- Download the SVG and assert it encodes the same target as the PNG. Two codes
  for one link is the defect that was there.
- Download the CSV and assert the row for the `=1+1` link is neutralised, that
  the file opens with a UTF-8 BOM, and that a non-ASCII title survives intact.

- [ ] **Step 6: `e2e/a11y.spec.ts` — the contract, checked by a machine**

Run `@axe-core/playwright` against every page, in **both themes**, and fail on
any violation at `serious` or `critical`. Light mode is not optional: the
contrast defect Task 9 fixed existed only there, because the light values had
been inherited from dark rather than stepped independently.

Assert, per page, the properties §6.2 commits to that axe does not check: one
`<h1>`, heading levels that never skip, and every chart inside a region with an
accessible name.

Where a violation is a deliberate, documented choice rather than a defect,
suppress it **by rule and by selector with a comment naming the reason** — never
by lowering the threshold. A blanket exclusion is how this kind of suite quietly
stops meaning anything.

- [ ] **Step 7: The CI job**

Add an `e2e` job to `.github/workflows/ci.yml`, parallel to `verify`:

```yaml
  e2e:
    name: End-to-end
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version-file: .nvmrc
          cache: npm
      - run: npm ci
      - run: npx playwright install --with-deps chromium
      # Test-only values. They have no production meaning and unlock nothing:
      # the suite runs against a throwaway local D1 inside the runner.
      - name: Write test credentials
        run: |
          printf 'ADMIN_USER=e2e
ADMIN_PASSWORD=e2e-password-not-a-secret
HASH_SECRET=e2e-hash-secret-not-a-secret
' > .dev.vars
      - run: npm run e2e
      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: playwright-report
          path: playwright-report/
          retention-days: 7
```

The report upload on failure is the point of the job: a red end-to-end run that
a reader cannot see inside is a red run they will learn to ignore.

- [ ] **Step 8: Prove the suite can fail**

A suite that has never failed is a suite nobody has tested. For **each** of the
four specs, reintroduce the defect it was written for — restore the doubled
`/app`, put back `peer-focus-visible:`, strip the `?s=qr` marker from the PNG's
target, remove the CSV neutralisation — run that spec, paste the verbatim
failure, then revert.

Four reverts, four green runs. Anything that does not fail when its defect
returns is not protecting us and must be rewritten until it does.

- [ ] **Step 9: Document it**

`README.md` and `CONTRIBUTING.md`: how to run the suite locally, that it needs
`npx playwright install chromium` once, and — briefly — why it exists, so the
next contributor understands it covers what `jsdom` structurally cannot rather
than duplicating the unit tests.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "test(e2e): cover in a browser what jsdom cannot reach"
```
