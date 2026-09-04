# MargioLink Dashboard Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the complete authenticated MargioLink application into a polished editorial command desk without changing its data, API, or accessibility semantics.

**Architecture:** Add small layout primitives, then restyle the existing shell and pages around them. Query hooks and mutations stay where they are; only presentation, grouping, and the number of ranked rows shown in chart view change. The existing full table view remains the untruncated data surface.

**Tech Stack:** React 19, TypeScript 7, Tailwind CSS 4, Radix UI, TanStack Query, Vitest, Testing Library, Playwright, axe-core.

**Spec:** `docs/superpowers/specs/2026-09-04-margiolink-dashboard-redesign-design.md`

## Global Constraints

- Do not change API routes, database code, query semantics, authentication, retention, or destructive-action safeguards.
- Keep all repository code, identifiers, comments, and user-facing application copy in English.
- Keep Fraunces and IBM Plex Sans self-hosted.
- Preserve the existing analytical palette; amber represents actions and selection, never data.
- Preserve one primary navigation landmark, one page `h1`, the skip link, visible focus, reduced motion, table alternatives, and screen-reader status/error announcements.
- No new charting or animation dependency.
- Work around unrelated existing worktree changes; never reset or discard them.
- Every behavioural markup change starts with a failing user-observable test.

---

## File structure

**Create**

- `web/src/components/layout/BrandMark.tsx` — shared product identity.
- `web/src/components/layout/PageHeader.tsx` — one page title hierarchy and action slot.
- `web/src/components/layout/SectionHeading.tsx` — labelled page sections with anchor targets.
- `web/src/components/layout/InsightNav.tsx` — in-page links for Link detail.
- `web/src/components/ui/Panel.tsx` — reusable editorial surface.
- `web/src/components/layout/EditorialLayout.test.tsx` — semantic tests for the new primitives.

**Modify**

- `web/src/styles/tokens.css`, `web/src/styles/app.css` — editorial surface tokens, atmosphere, transitions, responsive utilities.
- `web/src/components/layout/AppShell.tsx`, `PrimaryNav.tsx`, `ThemeToggle.tsx` — desktop rail, mobile utility header, active navigation, global actions.
- `web/src/components/ui/Button.tsx`, `Field.tsx`, `Select.tsx`, `Badge.tsx`, `Dialog.tsx` — shared control polish.
- `web/src/components/charts/ChartFrame.tsx`, `StatTile.tsx`, `RankedBars.tsx`, `WorldMap.tsx` — panel hierarchy and bounded visual rankings.
- `web/src/pages/Overview.tsx`, `Links.tsx`, `LinkDetail.tsx`, `Tags.tsx`, `Settings.tsx`, `Login.tsx` — page-specific composition.
- Existing component and page tests beside the modified files.
- `e2e/a11y.spec.ts`, `e2e/links-layout.spec.ts`, `e2e/panel-heights.spec.ts` — browser-level layout and accessibility contracts.
- `scripts/screenshots.mjs` — definitive populated dashboard capture list if a missing proof is found.

---

### Task 1: Editorial layout primitives and visual foundation

**Files:**

- Create: `web/src/components/layout/BrandMark.tsx`
- Create: `web/src/components/layout/PageHeader.tsx`
- Create: `web/src/components/layout/SectionHeading.tsx`
- Create: `web/src/components/ui/Panel.tsx`
- Create: `web/src/components/layout/EditorialLayout.test.tsx`
- Modify: `web/src/styles/tokens.css`
- Modify: `web/src/styles/app.css`

**Interfaces:**

- Produces: `BrandMark({ compact?: boolean })`, `PageHeader({ eyebrow, title, description, actions? })`, `SectionHeading({ id, eyebrow?, title, description? })`, and `Panel({ as?, className?, children })`.
- Consumes: existing `cn()` utility, token names, Fraunces, and IBM Plex Sans.

- [ ] **Step 1: Write semantic tests for the new primitives**

```tsx
it("gives every page one labelled title and optional action area", () => {
  render(
    <PageHeader
      eyebrow="Analytics workspace"
      title="Overview"
      description="See what changed and what deserves attention."
      actions={<button type="button">Change period</button>}
    />,
  );
  expect(screen.getByRole("heading", { name: "Overview", level: 1 })).toBeInTheDocument();
  expect(screen.getByText("Analytics workspace")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Change period" })).toBeInTheDocument();
});

it("renders the product name in the shared brand", () => {
  render(<BrandMark />);
  expect(screen.getByText("MargioLink")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the new test and verify the missing modules fail**

Run: `npx vitest run web/src/components/layout/EditorialLayout.test.tsx`

Expected: FAIL because `BrandMark`, `PageHeader`, `SectionHeading`, and `Panel` do not exist.

- [ ] **Step 3: Implement the small presentational components**

Use typed props with `ReactNode`; `PageHeader` renders one `h1`; `SectionHeading` renders an `h2` inside a section-introduction block; `Panel` forwards semantic element choice without fetching or owning state.

```tsx
export function PageHeader({ eyebrow, title, description, actions }: PageHeaderProps) {
  return (
    <header className="page-header">
      <div className="min-w-0">
        <p className="page-eyebrow">{eyebrow}</p>
        <h1 className="page-title">{title}</h1>
        <p className="page-description">{description}</p>
      </div>
      {actions ? <div className="page-actions">{actions}</div> : null}
    </header>
  );
}
```

- [ ] **Step 4: Extend the visual foundation**

Keep the existing data colours unchanged. Add semantic custom properties for rail, workspace glow, panel shadow, strong rule, and control hover. Add `.app-workspace`, `.page-enter`, `.page-header`, `.page-eyebrow`, `.page-title`, `.page-description`, `.page-actions`, `.editorial-panel`, and `.section-heading` classes. Apply a subtle radial amber glow and grain-free CSS texture; do not load remote assets.

- [ ] **Step 5: Run focused tests and checks**

Run: `npx vitest run web/src/components/layout/EditorialLayout.test.tsx web/src/styles/tokens.test.ts`

Run: `npm run typecheck`

Expected: PASS.

### Task 2: Shared shell, navigation, controls, and login

**Files:**

- Modify: `web/src/components/layout/AppShell.tsx`
- Modify: `web/src/components/layout/PrimaryNav.tsx`
- Modify: `web/src/components/layout/ThemeToggle.tsx`
- Modify: `web/src/components/layout/AppShell.test.tsx`
- Modify: `web/src/pages/Login.tsx`
- Modify: `web/src/pages/Login.test.tsx`
- Modify: `web/src/components/ui/Button.tsx`
- Modify: `web/src/components/ui/Field.tsx`
- Modify: `web/src/components/ui/Select.tsx`
- Modify: `web/src/components/ui/Badge.tsx`
- Modify: `web/src/components/ui/Dialog.tsx`

**Interfaces:**

- Consumes: `BrandMark`, existing `CommandPalette`, router basename, and existing UI component props.
- Produces: one responsive application shell and unchanged public component APIs.

- [ ] **Step 1: Add shell behaviour tests**

```tsx
it("offers the global creation path and command hint", () => {
  renderShell("/");
  expect(screen.getByRole("link", { name: /new link/i })).toHaveAttribute("href", "/links?new=1");
  expect(screen.getByText(/command menu/i)).toBeInTheDocument();
});

it("keeps exactly one primary navigation landmark", () => {
  renderShell("/");
  expect(screen.getAllByRole("navigation", { name: "Primary" })).toHaveLength(1);
});
```

- [ ] **Step 2: Run the shell test and confirm the new assertions fail**

Run: `npx vitest run web/src/components/layout/AppShell.test.tsx web/src/pages/Login.test.tsx`

Expected: FAIL because the global New link path, command hint, and login brand are absent.

- [ ] **Step 3: Build the responsive editorial shell**

Put `BrandMark`, the four section links, `to="/links?new=1"`, a visible Command menu hint, theme control, and privacy note in the desktop rail. Use the same `PrimaryNav` element as a bottom bar under 1024px. Add a mobile utility header outside the navigation landmark with a compact `BrandMark` and New link control. Preserve `#main`, `tabIndex={-1}`, and the skip link.

- [ ] **Step 4: Restyle shared controls without changing their APIs**

Increase primary button height and shadow, give ghost buttons a raised hover state, use 10-pixel control radii, keep `:focus-visible` global, and preserve all disabled/loading semantics. Align Radix portals with the editorial panel surface and shadow.

- [ ] **Step 5: Bring login into the product language**

Use the brand mark, a split editorial composition at desktop, a privacy statement, and the existing form in a raised panel. Preserve labels, submit semantics, error region, redirect behaviour, and no external requests.

- [ ] **Step 6: Run shell, login, and shared UI tests**

Run: `npx vitest run web/src/components/layout web/src/pages/Login.test.tsx web/src/components/ui`

Expected: PASS.

### Task 3: Overview hierarchy and compact analytical panels

**Files:**

- Modify: `web/src/components/charts/RankedBars.tsx`
- Modify: `web/src/components/charts/RankedBars.test.tsx`
- Modify: `web/src/components/charts/WorldMap.tsx`
- Modify: `web/src/components/charts/WorldMap.test.tsx`
- Modify: `web/src/components/charts/ChartFrame.tsx`
- Modify: `web/src/components/charts/ChartFrame.test.tsx`
- Modify: `web/src/components/charts/StatTile.tsx`
- Modify: `web/src/components/charts/StatTile.test.tsx`
- Modify: `web/src/pages/Overview.tsx`
- Modify: `web/src/pages/Overview.test.tsx`

**Interfaces:**

- Extends: `RankedBars` with `limit?: number` and `WorldMap` with `listLimit?: number`.
- Extends: `StatTile` with `featured?: boolean`.
- Extends: `ChartFrame` with `headingLevel?: 2 | 3`, defaulting to `2`.
- Consumes: `PageHeader`, `Panel`, existing query hooks, table data, and chart status.

- [ ] **Step 1: Test bounded chart rankings and preserved full inputs**

```tsx
it("shows a bounded leading set when a visual limit is provided", () => {
  render(<RankedBars slices={slices} label="Countries" limit={2} />);
  expect(screen.getAllByRole("listitem")).toHaveLength(2);
  expect(screen.getByText(/showing top 2 of 3/i)).toBeInTheDocument();
  expect(screen.queryByText("unknown")).not.toBeInTheDocument();
});
```

Add a WorldMap test with seven country slices, `listLimit={3}`, three list items, and a rendered map. Its parent `ChartFrame` table continues receiving all seven slices.

- [ ] **Step 2: Run focused chart tests and verify failure**

Run: `npx vitest run web/src/components/charts/RankedBars.test.tsx web/src/components/charts/WorldMap.test.tsx web/src/components/charts/ChartFrame.test.tsx web/src/components/charts/StatTile.test.tsx`

Expected: FAIL because the new props and top-count note are not implemented.

- [ ] **Step 3: Implement bounded visual rankings**

Compute `visible = limit ? slices.slice(0, limit) : slices`, scale against the full first/max value, render `visible`, and add a visible note only when `slices.length > visible.length`. Pass `listLimit` from `WorldMap` to `RankedBars`. Do not mutate or truncate the `table` prop in parent pages.

- [ ] **Step 4: Implement editorial chart and statistic variants**

Render the correct `h2` or `h3` in `ChartFrame`, keep `aria-labelledby`, and retain its button semantics. Make `featured` a visual class on the same StatTile markup rather than a separate code path.

- [ ] **Step 5: Recompose Overview**

Use `PageHeader` with period controls, a lead Clicks tile, the main time series, an asymmetrical focus grid for Top links and country reach, then the supporting device/channel grid and full-width heatmap. Pass six-row limits to country and ranked breakdown chart views while passing complete data to every table.

- [ ] **Step 6: Run the Overview and chart suites**

Run: `npx vitest run web/src/pages/Overview.test.tsx web/src/components/charts`

Expected: PASS.

### Task 4: Daily-work pages — Links, Tags, and Settings

**Files:**

- Modify: `web/src/pages/Links.tsx`
- Modify: `web/src/pages/Links.test.tsx`
- Modify: `web/src/components/links/LinkRow.tsx`
- Modify: `web/src/components/links/LinkRow.test.tsx`
- Modify: `web/src/pages/Tags.tsx`
- Modify: `web/src/pages/Tags.test.tsx`
- Modify: `web/src/pages/Settings.tsx`
- Modify: `web/src/pages/Settings.test.tsx`

**Interfaces:**

- Consumes: `PageHeader`, `Panel`, existing query and mutation hooks, existing `LinkDialog`, `Select`, and `Field` APIs.
- Produces: unchanged route behaviour and mutation paths with a clearer visual hierarchy.

- [ ] **Step 1: Add user-visible hierarchy tests**

```tsx
it("reports the populated result scope beside the filters", async () => {
  renderPage();
  expect(await screen.findByText("2 links")).toBeInTheDocument();
});

it("introduces the settings sections with descriptive headings", async () => {
  renderSettings();
  expect(await screen.findByRole("heading", { name: "Sessions", level: 2 })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Data", level: 2 })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "About", level: 2 })).toBeInTheDocument();
});
```

- [ ] **Step 2: Run page tests and verify the result-scope test fails**

Run: `npx vitest run web/src/pages/Links.test.tsx web/src/components/links/LinkRow.test.tsx web/src/pages/Tags.test.tsx web/src/pages/Settings.test.tsx`

Expected: the new result-scope assertion fails; existing behavioural assertions remain green.

- [ ] **Step 3: Recompose Links**

Use `PageHeader` for title and New link, wrap search/status/tag controls in one `Panel`, show the total count after successful loading, and place rows in one `Panel`. Add row hover and focus-within affordances, a more distinct slug/target hierarchy, and compact numerical utilities. Do not alter debounce, query parameters, pagination, copy, restore, edit, activate, or delete behaviour.

- [ ] **Step 4: Recompose Tags and Settings**

Use the same page header and panel language. Keep all Tag forms and confirmations intact. Place Sessions in the wide Settings column and Data/About in a supporting column; retain the current heading order in the DOM so mobile and assistive reading order stay logical.

- [ ] **Step 5: Run all daily-work page tests**

Run: `npx vitest run web/src/pages/Links.test.tsx web/src/components/links web/src/pages/Tags.test.tsx web/src/pages/Settings.test.tsx`

Expected: PASS.

### Task 5: Grouped Link detail and in-page insight navigation

**Files:**

- Create: `web/src/components/layout/InsightNav.tsx`
- Modify: `web/src/components/layout/EditorialLayout.test.tsx`
- Modify: `web/src/pages/LinkDetail.tsx`
- Modify: `web/src/pages/LinkDetail.test.tsx`
- Modify: `web/src/components/charts/ChartFrame.tsx`
- Modify: `web/src/components/charts/RankedBars.tsx`

**Interfaces:**

- Produces: `InsightNav({ items: { id: string; label: string }[] })` with same-page anchor links.
- Consumes: `PageHeader`, `SectionHeading`, `ChartFrame headingLevel={3}`, and bounded `RankedBars` chart views.

- [ ] **Step 1: Test section grouping and navigation**

```tsx
it("groups analytics into navigable sections", async () => {
  renderPage();
  expect(await screen.findByRole("navigation", { name: "Link insights" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Audience" })).toHaveAttribute("href", "#audience");
  expect(screen.getByRole("heading", { name: "Performance", level: 2 })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Countries", level: 3 })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Delivery", level: 2 })).toBeInTheDocument();
});
```

- [ ] **Step 2: Run Link detail tests and verify the missing structure fails**

Run: `npx vitest run web/src/pages/LinkDetail.test.tsx web/src/components/layout/EditorialLayout.test.tsx`

Expected: FAIL because Link insight navigation and section headings are absent.

- [ ] **Step 3: Implement InsightNav**

Render one `<nav aria-label="Link insights">` with links to `#performance`, `#audience`, `#acquisition`, and `#delivery`. Style it as sticky below the utility header on desktop and horizontally scrollable on narrow screens. Keep it in document order directly after the page header.

- [ ] **Step 4: Group existing panels without changing queries**

Move existing rendered panels into four `<section id>` blocks in the exact grouping defined by the spec. Give every nested `ChartFrame` `headingLevel={3}`. Pass a seven-row visual limit to ranked breakdowns; keep all rows in their table data. Keep Live feed and QR code as named regions under Delivery.

- [ ] **Step 5: Run Link detail and chart tests**

Run: `npx vitest run web/src/pages/LinkDetail.test.tsx web/src/components/charts web/src/components/layout/EditorialLayout.test.tsx`

Expected: PASS.

### Task 6: Browser verification and definitive populated screenshots

**Files:**

- Modify: `e2e/a11y.spec.ts`
- Modify: `e2e/links-layout.spec.ts`
- Modify: `e2e/panel-heights.spec.ts`
- Read: `scripts/screenshots.mjs`
- Regenerate: `docs/screenshots/*`

**Interfaces:**

- Consumes: the real Worker, local D1, deterministic 180-day demo seed, Chromium, existing screenshot credentials.
- Produces: current local screenshots and browser evidence covering the complete redesign.

- [ ] **Step 1: Add browser-level layout assertions**

Assert at 1440 pixels that the primary navigation is a left rail, the Overview lead stat and main plot are visible without horizontal scrolling, and the Link detail in-page navigation links to all four section IDs. Assert at 390 pixels that the bottom navigation does not cover the last focusable content and filter controls do not overflow.

- [ ] **Step 2: Run the new E2E cases and fix only proven layout failures**

Run: `npm run e2e -- e2e/links-layout.spec.ts e2e/panel-heights.spec.ts e2e/a11y.spec.ts`

Expected: PASS with no serious or critical axe violations in light and dark themes.

- [ ] **Step 3: Run the complete local verification set**

Run: `npm test`

Run: `npm run typecheck`

Run: `npm run check`

Run: `npm run build:verify`

Run: `npm run e2e`

Expected: every command exits 0.

- [ ] **Step 4: Generate screenshots from the rich local dataset**

Run: `npm run screenshots`

The command must report a 180-day demo seed and write populated Overview, Links, Link detail, Tags, Settings, dialog, palette, and chart images under `docs/screenshots/`.

- [ ] **Step 5: Run the screenshot command a second time**

Run: `npm run screenshots`

Expected: embedded landing screenshots and freshly generated dashboard screenshots are byte-aligned; no stale-embed warning remains.

- [ ] **Step 6: Inspect the definitive images**

Open `overview-dark.jpg`, `overview-light.jpg`, `overview-mobile.jpg`, `links-dark.png`, `link-detail-dark.png`, `link-detail-full.jpg`, `tags.png`, `settings.jpg`, `command-palette.png`, and `link-form.png`. Reject any image with clipping, accidental empty areas, unreadable contrast, a covered control, an unbounded ranked list, or sparse demo data.

- [ ] **Step 7: Record final repository state without disturbing unrelated work**

Run: `git status --short`

Run: `git diff --check`

Report exactly which files belong to the redesign and which pre-existing changes were left untouched.
