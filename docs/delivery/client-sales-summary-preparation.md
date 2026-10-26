# Client sales summary on v3 card & list — PREPARATION ONLY

**Status:** draft PR only — **NOT DEPLOYED**, no production SQL/import/FTP/restarts.

## Scope

- Overview tab (holding/legal): month selector, three summary tiles, expanded legal breakdown table, link to existing Sales tab.
- Optional list columns: `sales_income_total`, `sales_quantity_total`, `sales_legal_count`, `sales_by_legal` (not in default column sets).
- List filter bar: month selector (`v3salesMonth`) synced with card Back link and batch API territory params.
- Month persistence: URL `v3salesMonth=YYYY-MM` on list and card; legal Sales tab reads the same month from URL.
- API: `GET /api/clients/v3/client-sales/months`, `GET /api/clients/v3/client-sales/card`, canonical `GET /api/clients/v3/client-sales/batch?month=YYYY-MM&target=holding:UUID&target=legal:UUID` on **readChain** (≤100 targets). POST remains a compatibility alias outside employee preview; the UI uses GET. The global preview write policy is unchanged.
- Incomplete holdings: missing import row for any in-scope legal ⇒ `dataState=incomplete`, no partial totals/shares.
- Source: `onec_v3_legal_sales_lines` aggregate only; no migration 049; no returns netting.
- The selected month survives legacy/v3 state conversion, column changes, card navigation, Details, Back and reload. A requested unavailable month is not replaced by the latest month. Existing `/sales?...` return paths are preserved.
- The four sales fields are display-only, not fake per-page sorting/filtering. Existing saved/default column selections are not replaced.
- API scope is the effective employee/delegation scope intersected with the selected territory. Hidden sibling totals/counts are not exposed. Scalar list fields carry an accessible-part explanation.
- Authorization and financial aggregation are set-based; 1 vs 100 targets has a bounded query budget. Revenue is summed using database numeric/existing decimal helpers, by unique legal GUID, not retail-outlet joins.

## Rollback (code-only)

Revert the PR merge commit and redeploy the previous app release. **Do not** reverse September 2026 import data.

## Rollout (when approved separately)

Deploy app bundle after review; no DB migration. Verify card overview + list columns on staging with real import month.

## Verification

- `npm run typecheck` / `npm run build`
- `node --import tsx --test test/integration/client-sales-summary-v3.test.ts` (16 tests: territory, denial, batch query budget, UUID validation, real admin-preview GET success and continued POST denial).
- `node --import tsx --test test/browser/client-sales-summary-v3.browser.test.ts` (5 Chromium UI tests: actual checkbox selection, real month selector, Details, Back/reload, fullscreen, mobile 375px, existing Sales return path; no DOM injection to simulate rendered sales columns).
- Existing access/preview/delegation/v3/team API regression suites and existing full-card/card-parity/stage2-list browser suites are included in the final review.
- Final review result: 16 feature integration tests + 44 existing integration regressions passed; 5 feature browser tests + 19 existing browser regressions passed. Typecheck and build passed. These results are from an isolated local synthetic environment, not a production acceptance run.
- Run DB tests sequentially against an isolated synthetic test database only. Never point `TEST_DATABASE_URL` at production.
- Production deploy / September import: **not run** (preparation-only).

## Release gates

- PR review and explicit production release approval are still required.
- After the approved code-only deploy, verify real September 2026 data on one holding and its legal entities, selected-employee scoping, columns, fullscreen/mobile and Back. Do not use synthetic amounts as real imported values.
- No new credentials, import runs, jobs or database changes are needed for this block. Do not restore a backup taken before the successful September import as a code rollback.
