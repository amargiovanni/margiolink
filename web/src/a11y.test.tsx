import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import LinkDetail from "./pages/LinkDetail";
import Links from "./pages/Links";
import Overview from "./pages/Overview";
import Settings from "./pages/Settings";
import Tags from "./pages/Tags";

/** A cross-cutting sweep — spec §6.2 — over every page's happy-path render,
 *  rather than another pass over each component in isolation (each already
 *  has its own tests). What a component-level test cannot see is the
 *  composition: whether the *page* built from already-accessible pieces
 *  still ends up with one `<h1>`, headings that never skip a level, and
 *  every chart landing inside a named region. Each property below failed at
 *  least once while this file was being written — see the task report for
 *  what was fixed, and why the fixes belong in the pages/components rather
 *  than here. */

type Handler = unknown | ((url: URL) => unknown);

/** Same stub shape used by every page's own test file — a record of path
 *  (optionally "METHOD /path") to response. */
function stub(routes: Record<string, Handler>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = new URL(String(input), "https://link.test");
      const key = `${init?.method ?? "GET"} ${url.pathname}`;
      const entry = routes[key] ?? routes[url.pathname];
      if (entry === undefined) return Response.json({ error: "not_found" }, { status: 404 });
      const resolved = typeof entry === "function" ? (entry as (u: URL) => unknown)(url) : entry;
      return Response.json(resolved);
    }),
  );
}

function dimensionByName(byName: Record<string, unknown>, fallback: unknown = { slices: [] }) {
  return (url: URL) => byName[url.searchParams.get("name") ?? ""] ?? fallback;
}

/** Waits past every panel still showing a pending-query placeholder. Every
 *  "Loading…" string in this app (grepped across `pages/` and
 *  `components/`) is conditional on `isPending` and disappears once that
 *  query settles — there is no permanent copy containing the word — so its
 *  absence is a reliable "every independent query on this page has
 *  resolved" signal. This matters because a page's own identifying text is
 *  sometimes a *static* prop (a `ChartFrame` `title`, for instance) that
 *  renders on the very first pass, before any stubbed fetch has resolved:
 *  a `ready()` built only from that text can resolve before the panels
 *  fed by other, independent queries have populated, understating what the
 *  sweep actually inspects. Caught in review: `Overview`'s "Clicks by
 *  country" heading is exactly such a static title, and without this wait
 *  the sweep below found zero `tabIndex` on `Overview` — not because the
 *  page has none (`TimeSeries`'s crosshair carries `tabIndex={0}`), but
 *  because it hadn't finished rendering yet. */
async function waitForSettled(container: HTMLElement) {
  await waitFor(() => {
    expect(container.textContent, "a panel is still showing a Loading placeholder").not.toMatch(
      /Loading/,
    );
  });
}

afterEach(() => vi.unstubAllGlobals());

function withClient(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

const SUMMARY = {
  current: { clicks: 1234, uniques: 800, bots: 60, countries: 12 },
  previous: { clicks: 1000, uniques: 700, bots: 50, countries: 10 },
};
const TIMESERIES = {
  buckets: [
    { bucket: "2026-08-26", clicks: 100, uniques: 80 },
    { bucket: "2026-08-27", clicks: 200, uniques: 150 },
  ],
  granularity: "day",
};
const A_SLICE = (value: string) => ({ slices: [{ value, clicks: 10, uniques: 8 }] });
const DOW_HOUR_SLICES = { slices: [{ value: "1-09", clicks: 5, uniques: 4 }] };
const TOP_LINKS = {
  links: [{ id: 1, slug: "launch", title: "Launch", clicks: 42, uniques: 30 }],
};
const LINK = {
  id: 1,
  slug: "demo",
  shortUrl: "https://link.test/demo",
  targetUrl: "https://example.com",
  title: "Demo link",
  description: null,
  hasPassword: false,
  expiresAt: null,
  expiredUrl: null,
  isActive: true,
  createdAt: 1_800_000_000,
  updatedAt: 1_800_000_000,
  deletedAt: null,
  tags: [{ id: 7, name: "spring", color: "#199e70" }],
};
const TAGS = { tags: [{ id: 7, name: "spring", color: "#199e70" }] };
const SPARKLINES = { days: 7, series: { "1": [0, 1, 2, 0, 3, 1, 4] } };

/** "some" — this page is expected to render at least one such element, so
 *  the corresponding check below asserts a non-zero count *before* looping,
 *  which fails loudly if a regression (or a broken fixture) empties it out.
 *  "none" — this page genuinely has none, by its own design, stated here
 *  explicitly with the reason, rather than left for an empty `for` loop to
 *  report a silent, unearned pass. No assertion in this suite is allowed to
 *  pass by matching nothing — every property is either checked against a
 *  guaranteed-non-empty set, or explicitly marked not applicable. */
interface ElementExpectations {
  /** Real `<img>` elements. Every icon in this app (`lucide-react`) and
   *  every chart renders as inline `<svg>`, never `<img>` — the one
   *  exception is `QrPanel`'s QR code, fetched from the API, which only
   *  `LinkDetail` renders. */
  images: "some" | "none";
  /** `input`/`select`/`textarea`/`[role='combobox']`. `LinkDetail`'s period
   *  selector is a `<fieldset>` of plain `<button>`s (not native radios —
   *  contrast `PeriodPicker`, which Overview uses), and its other controls
   *  are all buttons too, so it has none. `Settings`' session list and
   *  About group are read-only text plus buttons — no inputs anywhere on
   *  that page either. */
  formControls: "some" | "none";
  /** `[tabindex]`. The only explicit `tabIndex` in this app is
   *  `TimeSeries`'s crosshair overlay (`tabIndex={0}`) — every other
   *  interactive element (buttons, native radios, Radix triggers) is
   *  natively tabbable with no attribute needed. Only `Overview` and
   *  `LinkDetail` render a `TimeSeries`. */
  tabbable: "some" | "none";
  /** Composite chart marks (`chartMarkElements`, below). `Links`, `Tags`
   *  and `Settings` render no `ChartFrame` chart at all — a working list, a
   *  tag manager and a settings page, respectively, none of them plotting
   *  anything. */
  charts: "some" | "none";
}

/** One entry per swept page — adding a page later means adding one line
 *  here, not a new file. `ready` waits for a piece of text that only
 *  appears once the page has settled on its real, loaded content: every
 *  property below is about what a *finished* render looks like, and
 *  asserting against a still-loading page would only prove the loading
 *  state is accessible, which nobody asked. It is composed with
 *  `waitForSettled` inside each test below rather than made to do that
 *  waiting itself, because a page's identifying text is not always a
 *  reliable proxy for "every query resolved" — see `waitForSettled`'s own
 *  comment for the case that caught this. */
const PAGES: ({
  name: string;
  renderPage: () => ReturnType<typeof render>;
  ready: () => Promise<unknown>;
} & ElementExpectations)[] = [
  {
    name: "Overview",
    renderPage: () => {
      stub({
        "/api/stats/summary": SUMMARY,
        "/api/stats/timeseries": TIMESERIES,
        "/api/stats/dimension": dimensionByName({
          country: A_SLICE("IT"),
          device: A_SLICE("desktop"),
          referrer_type: A_SLICE("direct"),
          dow_hour: DOW_HOUR_SLICES,
        }),
        "/api/stats/top-links": TOP_LINKS,
      });
      return render(withClient(<Overview />));
    },
    ready: () => screen.findByText("Clicks by country"),
    images: "none",
    formControls: "some", // PeriodPicker's 5 native radios
    tabbable: "some", // TimeSeries's crosshair
    charts: "some",
  },
  {
    name: "Links",
    renderPage: () => {
      stub({
        "/api/links": { links: [LINK], total: 1 },
        "/api/tags": TAGS,
        "/api/stats/sparklines": SPARKLINES,
      });
      return render(withClient(<Links />));
    },
    ready: () => screen.findByText("demo"),
    images: "none",
    formControls: "some", // the search input, the status and tag Selects
    tabbable: "none",
    charts: "none",
  },
  {
    name: "LinkDetail",
    renderPage: () => {
      stub({
        "/api/links/1": { link: LINK },
        "/api/stats/summary": SUMMARY,
        "/api/stats/timeseries": TIMESERIES,
        "/api/stats/dimension": dimensionByName({
          country: A_SLICE("IT"),
          city: A_SLICE("Rome"),
          device: A_SLICE("desktop"),
          os: A_SLICE("iOS"),
          browser: A_SLICE("Safari"),
          language: A_SLICE("it-IT"),
          asn_org: A_SLICE("Acme ISP"),
          referrer_type: A_SLICE("direct"),
          referrer_host: A_SLICE("example.com"),
          utm_campaign: A_SLICE("spring-sale"),
          utm_source: A_SLICE("newsletter"),
          utm_medium: A_SLICE("email"),
          source: A_SLICE("click"),
          outcome: A_SLICE("redirect"),
          dow_hour: DOW_HOUR_SLICES,
        }),
        "/api/stats/live": {
          clicks: [
            {
              id: "c1",
              ts: 1_800_000_000,
              country: "IT",
              device: "desktop",
              referrerType: "direct",
              outcome: "redirect",
            },
          ],
        },
      });
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      return render(
        <QueryClientProvider client={client}>
          <MemoryRouter initialEntries={["/links/1"]}>
            <Routes>
              <Route path="/links/:id" element={<LinkDetail />} />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>,
      );
    },
    ready: () => screen.findByText("demo"),
    images: "some", // QrPanel's QR code <img>
    formControls: "none", // period selector here is plain buttons, not radios
    tabbable: "some", // TimeSeries's crosshair
    charts: "some",
  },
  {
    name: "Tags",
    renderPage: () => {
      stub({ "/api/tags": TAGS });
      return render(withClient(<Tags />));
    },
    ready: () => screen.findByText("spring"),
    images: "none",
    formControls: "some", // the create form's name and colour inputs
    tabbable: "none",
    charts: "none",
  },
  {
    name: "Settings",
    renderPage: () => {
      stub({
        "/api/auth/sessions": {
          sessions: [
            {
              id: "sess-current",
              createdAt: 1_800_000_000,
              lastSeenAt: 1_800_000_000,
              expiresAt: 1_800_600_000,
              device: "Chrome on macOS",
              current: true,
            },
            {
              id: "sess-other",
              createdAt: 1_799_000_000,
              lastSeenAt: 1_799_500_000,
              expiresAt: 1_799_600_000,
              device: "Safari on iOS",
              current: false,
            },
          ],
        },
        "/api/meta": { retentionDays: 180, shortDomain: "link.margio.uk" },
        "/api/stats/sparklines": SPARKLINES,
      });
      return render(withClient(<Settings />));
    },
    ready: () => screen.findByText("Safari on iOS"),
    images: "none",
    formControls: "none", // sessions and About are read-only text plus buttons
    tabbable: "none",
    charts: "none",
  },
];

/** Composite chart marks, in the vocabulary spec §6.4 and this codebase's
 *  components already use (`data-line`, `data-area` for the time series;
 *  `data-cell` for the heatmap; `data-bar` for ranked-bar panels, including
 *  the ones `TopLinksPanel` and `WorldMap` build by hand). Excludes marks
 *  inside an `<svg role="img">` — that is `Sparkline`'s own signature (see
 *  `Sparkline.tsx`), the one form spec §6.4 explicitly exempts from the rest
 *  of the chart apparatus ("no axes, no labels, no tooltip — it exists only
 *  to show shape beside a number"): it self-names with a complete
 *  `aria-label` on its own `<svg>` and sits beside a number rather than
 *  standing as a page-level analytical view, so — unlike TimeSeries, the
 *  heatmap and every ranked-bar panel — it is not held to living inside a
 *  named section. */
function chartMarkElements(container: HTMLElement): Element[] {
  return Array.from(
    container.querySelectorAll("[data-line], [data-area], [data-cell], [data-bar]"),
  ).filter((el) => !el.closest("svg[role='img']"));
}

/** The accessible name a `<section>` (or any element) exposes via
 *  `aria-label`/`aria-labelledby` — the two mechanisms every named region in
 *  this codebase actually uses (see `ChartFrame`, `LiveFeed`'s and
 *  `QrPanel`'s wrapping `<section>`s, `Settings`' `<h2 id>` sections). Not a
 *  full accessible-name computation (no fallback to text content for a
 *  `<section>`, which has none by default) — sections in this app always
 *  name themselves one of these two ways, so anything else is a real gap,
 *  not a case this helper fails to reach. */
function sectionAccessibleName(el: Element): string {
  const label = el.getAttribute("aria-label");
  if (label?.trim()) return label.trim();
  const labelledBy = el.getAttribute("aria-labelledby");
  if (!labelledBy) return "";
  return labelledBy
    .split(/\s+/)
    .map((id) => el.ownerDocument.getElementById(id)?.textContent?.trim() ?? "")
    .filter(Boolean)
    .join(" ");
}

/** The accessible name a form control or button exposes, by the same two
 *  mechanisms plus the ones native HTML provides. Every control in this
 *  codebase reaches its name one of these ways — `Field` wires
 *  `label[for]`, `Select`/icon-only `Button`s require `aria-label` at the
 *  type level (see `Button.tsx`), and a text button's own content is its
 *  name — so, as with `sectionAccessibleName` above, anything this cannot
 *  find is a real gap. */
function controlAccessibleName(el: Element): string {
  const label = el.getAttribute("aria-label");
  if (label?.trim()) return label.trim();
  const labelledBy = el.getAttribute("aria-labelledby");
  if (labelledBy) {
    const text = labelledBy
      .split(/\s+/)
      .map((id) => el.ownerDocument.getElementById(id)?.textContent?.trim() ?? "")
      .filter(Boolean)
      .join(" ");
    if (text) return text;
  }
  const id = el.getAttribute("id");
  if (id) {
    const label = el.ownerDocument.querySelector(`label[for="${CSS.escape(id)}"]`);
    if (label?.textContent?.trim()) return label.textContent.trim();
  }
  const wrappingLabel = el.closest("label");
  if (wrappingLabel?.textContent?.trim()) return wrappingLabel.textContent.trim();
  const text = el.textContent?.trim();
  if (text) return text;
  const title = el.getAttribute("title");
  return title?.trim() ?? "";
}

describe.each(PAGES)(
  "$name — accessibility sweep (spec §6.2)",
  ({ renderPage, ready, images, formControls, tabbable, charts }) => {
    it("has exactly one <h1>", async () => {
      const { container } = renderPage();
      await ready();
      await waitForSettled(container);
      expect(container.querySelectorAll("h1")).toHaveLength(1);
    });

    it("never skips a heading level", async () => {
      const { container } = renderPage();
      await ready();
      await waitForSettled(container);
      const headings = Array.from(container.querySelectorAll("h1, h2, h3, h4, h5, h6")).map((el) =>
        Number(el.tagName[1]),
      );
      // Every page has at least its own <h1> — guaranteed by the check above,
      // restated here so this loop can never silently run zero times either.
      expect(headings.length).toBeGreaterThan(0);
      let deepestSoFar = 1;
      for (const level of headings) {
        expect(
          level,
          `heading level jumped to h${level} without an intervening h${deepestSoFar + 1}`,
        ).toBeLessThanOrEqual(deepestSoFar + 1);
        deepestSoFar = Math.max(deepestSoFar, level);
      }
    });

    it("gives every <img> alt text, or marks it decorative", async () => {
      const { container } = renderPage();
      await ready();
      await waitForSettled(container);
      const imgs = Array.from(container.querySelectorAll("img"));
      if (images === "none") {
        // Explicit, not an empty loop reporting an unearned pass — see
        // `ElementExpectations.images` for why this page has none.
        expect(imgs, "expected no <img> on this page, but found one").toHaveLength(0);
        return;
      }
      expect(imgs.length, "expected at least one <img> on this page, found none").toBeGreaterThan(
        0,
      );
      for (const img of imgs) {
        const alt = img.getAttribute("alt");
        const decorative = img.getAttribute("aria-hidden") === "true";
        expect(
          decorative || Boolean(alt?.trim()),
          `<img src="${img.getAttribute("src")}"> has neither alt text nor aria-hidden`,
        ).toBe(true);
      }
    });

    it("names every form control", async () => {
      const { container } = renderPage();
      await ready();
      await waitForSettled(container);
      const controls = Array.from(
        container.querySelectorAll("input, select, textarea, [role='combobox']"),
      ).filter((control) => control.getAttribute("type") !== "hidden");
      if (formControls === "none") {
        // Explicit, not an empty loop — see `ElementExpectations.formControls`
        // for why this page has none.
        expect(controls, "expected no form controls on this page, but found one").toHaveLength(0);
        return;
      }
      expect(
        controls.length,
        "expected at least one form control on this page, found none",
      ).toBeGreaterThan(0);
      for (const control of controls) {
        expect(
          controlAccessibleName(control),
          `<${control.tagName.toLowerCase()}> has no accessible name: ${control.outerHTML}`,
        ).not.toBe("");
      }
    });

    it("names every button", async () => {
      const { container } = renderPage();
      await ready();
      await waitForSettled(container);
      const buttons = Array.from(container.querySelectorAll("button"));
      // Every page carries at least one button (a nav action, a "Table"
      // toggle, a "New link"/"New tag" trigger) — no `ElementExpectations`
      // field needed, but still asserted so a page that stopped rendering
      // entirely fails here rather than passing over zero buttons.
      expect(buttons.length, "expected at least one <button>, found none").toBeGreaterThan(0);
      for (const button of buttons) {
        expect(
          controlAccessibleName(button),
          `<button> has no accessible name: ${button.outerHTML}`,
        ).not.toBe("");
      }
    });

    it("uses no positive tabIndex", async () => {
      const { container } = renderPage();
      await ready();
      await waitForSettled(container);
      const withTabIndex = Array.from(container.querySelectorAll("[tabindex]"));
      if (tabbable === "none") {
        // Explicit, not an empty loop — see `ElementExpectations.tabbable`
        // for why this page carries no explicit `tabindex` at all.
        expect(withTabIndex, "expected no [tabindex] on this page, but found one").toHaveLength(0);
        return;
      }
      expect(
        withTabIndex.length,
        "expected at least one [tabindex] on this page, found none",
      ).toBeGreaterThan(0);
      for (const el of withTabIndex) {
        const value = Number(el.getAttribute("tabindex"));
        expect(value, `${el.tagName.toLowerCase()} has a positive tabindex`).toBeLessThanOrEqual(0);
      }
    });

    it("puts every chart inside a section with an accessible name", async () => {
      const { container } = renderPage();
      await ready();
      await waitForSettled(container);
      await waitFor(() => {
        const marks = chartMarkElements(container);
        if (charts === "none") {
          // Explicit, not an empty loop — see `ElementExpectations.charts`
          // for why this page renders no composite chart at all.
          expect(marks, "expected no chart on this page, but found a mark").toHaveLength(0);
          return;
        }
        expect(marks.length, "expected at least one chart mark, found none").toBeGreaterThan(0);
        for (const mark of marks) {
          const section = mark.closest("section");
          expect(section, `chart mark outside any <section>: ${mark.outerHTML}`).not.toBeNull();
          expect(
            section ? sectionAccessibleName(section) : "",
            `chart's <section> has no accessible name: ${section?.outerHTML.slice(0, 120)}`,
          ).not.toBe("");
        }
      });
    });
  },
);
