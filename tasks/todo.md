# Final fix wave — `feature/ML-1-backend`

Source: `.superpowers/sdd/2026-09-01-margiolink-backend/final-review-report.md`.
One commit per numbered item. TDD where behaviour changes.

- [x] 1. `HASH_SECRET` fails closed — single guard at every consumption site
      (redirect GET/POST, click ingestion, login), min 32 chars; README secrets
- [x] 2. Stop storing `referrer_url` — insert, `ReferrerInfo`, migration 0002
      + rollback, data map, spec §3.2; run the rollback for real
- [x] 3. Throttle `POST /:slug` on `ipHash:slug`, 429 + `Retry-After`,
      outcome `password_failed`
- [x] 4. Retention refuses to delete raw rows for a day with no `click_daily`
      row, and logs the refusal
- [x] 5. Retention DELETE runs in bounded batches with an iteration cap
- [x] 6. Route guard: pin `PUBLIC_API_ROUTES`, stop skipping `ALL` blindly,
      pin the intentionally public non-`/api` routes
- [x] 7. Compliance test matches column names exactly, both directions
- [x] 8. crypto test covers UA and slug leakage; interstitial renders `link.slug`
- [x] 9. Documentation only: rate-limit daily-rotation ceiling (comment + LIA),
      stats.ts under-reporting/uniques note, "counts, not personal data"
      wording drift in spec §2.3/§4.3 and the plan
