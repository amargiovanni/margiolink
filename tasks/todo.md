# ML-5 — Public landing page, demo data, screenshots

Branch: `feature/ML-5-landing-and-screenshots`.
One commit per numbered item.

The product is finished and invisible: `/` answers nothing, the README has no
picture of the dashboard it spends three pages describing, and a fresh clone
shows empty states until somebody hand-creates links. All three are the same
gap — nothing shows what this is.

- [x] 1. **Demo seed** (`scripts/seed-demo.mjs`, `npm run db:seed:demo`).
      Deterministic (fixed-seed PRNG, same database twice in a row), writes
      raw `clicks` straight into local D1 so it can vary the two things the
      e2e seed provably cannot — country and day — then aggregates
      `click_daily`/`click_daily_dim` with the same grouping `rollupDay` uses.
      Local only: refuses to run against `--remote`.
      Test: `test/demo-seed.test.ts` — shape, schema parity in both
      directions, and the bulk rollup diffed against the real `rollupDay`.
- [x] 2. **Landing page** at `/`. `web/index.html` becomes the landing and the
      dashboard shell moves to `web/app.html`, because Cloudflare's asset
      router serves `web/dist/index.html` at `/` before the Worker runs — so
      today `/` already serves the dashboard shell to anonymous visitors.
      Built by Vite with the dashboard's own tokens and self-hosted fonts, no
      JS needed for content, theme-aware, WCAG 2.2 AA.
      `robots.txt` starts allowing the root it now has something to show.
      `index` joins `RESERVED_SLUGS` — the asset router shadows it.
      Tests: `test/routes/landing.test.ts` (the built document, and that every
      image it references resolves), `test/routes/public.test.ts` (robots),
      `test/lib/slug.test.ts`, and `e2e/landing.spec.ts` — real browser, real
      asset router, axe in both themes.
- [x] 3. **Screenshots** (`scripts/screenshots.mjs`, `npm run screenshots`).
      Playwright against a seeded local Worker; 23 shots covering every
      dashboard surface, the charts up close, the public interstitials and the
      landing, in both themes and on a phone. Committed to `docs/screenshots/`;
      the landing embeds three of them.
- [x] 4. **README** — hero shot under the title, a screenshot gallery, and the
      landing, the demo seed and the screenshot command documented where a
      reader will look for them. CHANGELOG updated.
- [x] 5. **Verification** — `npm run check`, `npm run typecheck`, `npm test`
      (700), `npm run e2e` (32), all four green with output shown.

## Found along the way

- [x] **Fixed:** the links list drew a full-width bar with an ellipsis under
      every row — `LinkRow`'s grid declared four columns for five cells, so the
      actions menu wrapped into the first column of an implicit second row.
      Invisible to jsdom; pinned now by `e2e/links-layout.spec.ts`.
- [x] **Fixed:** `npm run check` could not run at all on a machine with a
      worktree under `.claude/worktrees/` — Biome refuses to start when it
      finds a nested root configuration. The scripts now name the source
      directories instead of passing `.`.
- [ ] **Not fixed, flagged:** the link detail page's live feed renders fifty
      rows with no scroll container, so the panel is several thousand pixels
      tall and the QR card beside it stretches to match. A `max-height` with
      its own scroll would fix both; it is a change to the dashboard's layout
      and does not belong in this PR.
- [ ] **Not fixed, flagged:** on the overview, "Top links" shows five rows
      while "Clicks by country" shows twenty, and the grid stretches the
      shorter card to match — a tall empty panel in the middle of the page.
