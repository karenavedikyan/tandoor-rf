# Client sales summary on v3 card & list — PREPARATION ONLY

**Status:** draft PR only — **NOT DEPLOYED**, no production SQL/import/FTP/restarts.

## Scope

- Overview tab (holding/legal): month selector, three summary tiles, expanded legal breakdown table, link to existing Sales tab.
- Optional list columns: `sales_income_total`, `sales_quantity_total`, `sales_legal_count` (not in default column sets).
- Month persistence: URL `v3salesMonth=YYYY-MM` on list and card.
- API: `GET /api/clients/v3/client-sales/months`, `GET /api/clients/v3/client-sales/card`, `POST /api/clients/v3/client-sales/batch` (≤100 ids).
- Source: `onec_v3_legal_sales_lines` aggregate only; no migration 049; no returns netting.

## Rollback (code-only)

Revert the PR merge commit and redeploy the previous app release. **Do not** reverse September 2026 import data.

## Rollout (when approved separately)

Deploy app bundle after review; no DB migration. Verify card overview + list columns on staging with real import month.
