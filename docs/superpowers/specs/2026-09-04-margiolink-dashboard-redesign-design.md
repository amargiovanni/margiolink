# MargioLink Dashboard Redesign

**Date:** 2026-09-04
**Status:** Approved for autonomous implementation
**Direction:** Editorial command

## Goal

Redesign the complete authenticated MargioLink application so it feels as intentional as the public landing page while remaining fast, accessible, and useful with a large dataset. The redesign covers the shared shell, Overview, Links, Link detail, Tags, Settings, login, dialogs, and data visualisations.

The existing API, routes, data semantics, query behaviour, authentication model, and destructive-action safeguards remain unchanged.

## Product character

The interface is an editorial command desk: warm near-black and paper surfaces, amber as the action colour, Fraunces for hierarchy, IBM Plex Sans for working text, blue and orange for analytical series, and restrained depth from hairline borders and low shadows.

It should feel calm and authoritative, not like a generic SaaS template. The memorable element is the contrast between the dark navigation frame and the paper-like workspace, with one dark lead statistic anchoring each overview.

Both light and dark themes remain first-class. Existing analytical colours retain their meanings and validated contrast relationships.

## Shared shell

On desktop, a 240-pixel navigation rail contains:

- the MargioLink wordmark and a small amber monogram;
- the four primary destinations with a clear filled active state;
- a persistent New link action;
- the Command menu shortcut;
- theme control and a compact privacy-first product note at the bottom.

The content column receives a quiet top bar with the current section context and utility controls. Page content sits in a centered, generous workspace with a maximum readable width rather than stretching edge to edge.

On mobile, the logo and primary action move to a compact top bar while the same single navigation landmark remains a fixed bottom bar. Labels stay visible. Safe-area padding and the current keyboard/skip-link behaviour are preserved.

## Page hierarchy

Every screen uses one consistent page header: eyebrow, specific title, one-sentence purpose, and at most one primary action. Loading and error states occupy the same visual structure as loaded content.

### Overview

The Overview answers three questions in order:

1. What changed?
2. What deserves attention?
3. Where did the traffic come from?

The period picker belongs in the page header. A four-stat editorial grid follows, with Clicks as the dark lead tile and the remaining measures on raised paper cards. The main time series is the visual anchor. Top links and country reach form the next focus row; devices, channels, and activity-by-hour form the supporting breakdown.

Large ranked datasets show a useful top subset in the chart view and keep the full dataset in the existing table view. This prevents a twenty-row country list from determining the height and rhythm of the page.

### Links

The links screen is the daily working surface. Search and filters become one toolbar card directly below the page header. Results live in a single raised list surface with stronger row hierarchy, hover/focus affordance, compact trend information, and unchanged copy/action menus.

The visible result count and active filters make the current scope obvious. Mobile rows retain the same content and actions but stack identity above the numerical and utility line.

### Link detail

The detail page is reorganised into four labelled sections:

- **Performance:** summary, time series, and hourly activity;
- **Audience:** countries, cities, devices, operating systems, browsers, and languages;
- **Acquisition:** channels, referrers, campaigns, sources, and mediums;
- **Delivery:** networks, scans versus clicks, outcomes, live feed, and QR code.

A compact sticky section index appears below the page header on wide screens and becomes horizontally scrollable on smaller screens. Each chart keeps its table toggle. Ranked chart views show a bounded top subset; the table view exposes all returned rows. No edit or destructive control is duplicated from the tested Links-row workflow.

### Tags

Tag management becomes a compact workspace rather than an unframed list: creation is the header action, tags are grouped in one raised surface, colour remains secondary to the written name, and rename/delete behaviours remain unchanged.

### Settings

Settings becomes a responsive two-column composition: Sessions receives the wider primary card, while Data and About use quieter supporting cards. Sign out and session revocation remain clearly separated from informational controls. Configuration facts are written as human-readable facts first and implementation variables second.

### Login and overlays

Login adopts the same monogram, editorial hierarchy, and atmospheric background as the authenticated shell. Dialogs, command palette, selects, tooltips, badges, and notifications receive the same surface, radius, shadow, and motion language without changing their accessible primitives.

## Component boundaries

The redesign introduces small presentational components rather than page-specific duplication:

- `BrandMark` renders the shared product identity;
- `PageHeader` provides eyebrow, title, description, and action slots;
- `SectionHeading` introduces grouped analytical regions and optional anchor targets;
- `InsightNav` links the Link detail sections without owning their data;
- `Panel` provides the shared editorial surface used by charts and settings.

Existing query hooks and mutations remain at their current page/component boundaries. Presentational components accept rendered content and do not fetch.

## Data presentation

- Existing formatter functions and tabular figures remain authoritative.
- Analytical colour continues to encode data; amber continues to encode actions and selection only.
- Chart frames gain clearer headers, softer plotting surfaces, and compact chart/table switches.
- Ranked visualisations may show only the leading entries, but this is explicitly labelled and never truncates the table view.
- Sparklines remain summaries, not interactive charts.
- Motion is limited to one short page entrance and direct hover/pressed feedback; `prefers-reduced-motion` disables it.

## Responsive behaviour

- Below 640px: one-column content, two-column statistics, stacked toolbars, bottom navigation, full-width primary actions where useful.
- From 640px: filters align horizontally and detail panels can pair when their data density permits.
- From 1024px: fixed desktop rail, section index, four-column statistics, and editorial asymmetry for primary versus supporting panels.
- Extremely long URLs and labels truncate visually while retaining their accessible text and existing copy controls.

## Accessibility and usability invariants

- Preserve one primary navigation landmark, one page `h1`, sequential section headings, the skip link, and programmatic focus target.
- Preserve visible focus, keyboard access, minimum touch targets, reduced motion, screen-reader status/error announcements, and all Radix focus-management behaviour.
- No information is carried only by colour.
- The chart/table alternative remains reachable on every analytical panel.
- Contrast is checked in both themes with axe in a real browser.
- Existing route protection, link action confirmations, and error handling do not change.

## Testing and visual proof

Implementation uses focused component tests before each behavioural markup change, then runs the complete frontend suite, type checking, formatting checks, build-budget verification, and Playwright accessibility/layout coverage.

The final proof is generated from the deterministic 180-day local demo dataset. The screenshot runner must capture, at minimum:

- Overview in light and dark at desktop size;
- Overview on mobile;
- Links with populated results;
- one richly populated Link detail overview and its full-page grouped layout;
- Tags and Settings;
- the command palette and New link dialog.

Every final screenshot is inspected visually for hierarchy, overflow, clipping, empty space, contrast, fixed-navigation overlap, and representative data density.

## Non-goals

- No API, database, analytics, authentication, or retention changes.
- No new charting dependency.
- No user-customisable dashboard layout.
- No duplicate mutation paths on Link detail.
- No remote deployment or production-data mutation.
