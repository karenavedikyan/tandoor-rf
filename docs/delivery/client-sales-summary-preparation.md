# Client sales summary on v3 card & list — PREPARATION ONLY

**Status:** draft PR only — **NOT DEPLOYED**, no production SQL/import/FTP/restarts.

## Scope

- Overview tab (holding/legal): month selector, three summary tiles, expanded legal breakdown table, link to existing Sales tab.
- Optional list columns: `sales_income_total`, `sales_quantity_total`, `sales_legal_count`, `sales_by_legal` (not in default column sets).
- List filter bar: month selector (`v3salesMonth`) synced with card Back link and batch API territory params.
- Month persistence: URL `v3salesMonth=YYYY-MM` on list and card; legal Sales tab reads the same month from URL.
- API: `GET /api/clients/v3/client-sales/months`, `GET /api/clients/v3/client-sales/card`, `POST /api/clients/v3/client-sales/batch` on **readChain** (≤100 targets; body `{ month, targets[] }`).
- Incomplete holdings: missing import row for any in-scope legal ⇒ `dataState=incomplete`, no partial totals/shares.
- Source: `onec_v3_legal_sales_lines` aggregate only; no migration 049; no returns netting.

## Rollback (code-only)

Revert the PR merge commit and redeploy the previous app release. **Do not** reverse September 2026 import data.

## Rollout (when approved separately)

Deploy app bundle after review; no DB migration. Verify card overview + list columns on staging with real import month.

## Verification (agent run)

- `npm run typecheck` / `npm run build`
- `node --import tsx --test test/integration/client-sales-summary-v3.test.ts` (14 tests: territory, denial, batch query budget, UUID validation)
- `node --import tsx --test test/browser/client-sales-summary-v3.browser.test.ts` (4 Chromium UI tests; screenshots under store `media/client-sales-summary-v3/`)
- Production deploy / September import: **not run** (preparation-only).
