# Holding v2 PR #75 — acceptance report (test DB)

**Branch:** `cursor/holding-v2-pipeline-ui-9e11` (Draft PR #75)  
**Stack:** #73 → #74 → **#75**  
**Base at start of this pass:** `d0d3911`  
**Acceptance HEAD:** _(see git log after push; replaces `d0d3911` on same branch)_  
**Environment:** `TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/tandoor_rf_test`  
**Pipeline flag (tests):** `ONEC_HOLDING_V2_PIPELINE_ENABLED=true` via test helpers  

**Status labels:** local test-DB verified on this branch ≠ published on lk.tandoor.ru ≠ production real-data sign-off.

## Summary of changes in this pass

1. **Composition visibility (legal + TT):** `resolveHoldingV2CompositionVisibility` counts all active `onec_holding_v2_outlet_links` against `buildOutletScope` as well as legal entities. Partial outlet visibility → `withheld`; no mono/group label leak via `compositionSiteType` / list summaries.
2. **Flat composition contract:** `HoldingV2CompositionDetailDto` → `{ legalEntities[], outlets[] }` (no nested `legalEntities[].outlets`). UI: sibling sections «Юрлица» / «Торговые точки»; type + category per row.
3. **Outlet navigation:** composition links use `/clients/<guidClient>?store=<guidStore>&return=…`; client card deep-link selects and scrolls to `data-outlet-guid` (reload-safe).
4. **Tests:** integration (partial-outlet manager), composition loader, browser E2E (2 TT, second link, reload, back; mobile opens card from list click).

## Requirement checklist

| ID | Requirement | Verification | Result |
|----|-------------|--------------|--------|
| R1 | Full composition requires all legal entities in scope | Existing multi-entity manager test + admin full view | Pass |
| R2 | Full composition requires all holding TT in outlet scope | `clients-holding-v2-api` mono 2×TT / M1 sees S1 only | Pass |
| R3 | Withheld → no aggregate composition type/label leak | API asserts `compositionSiteType=unknown`, label «Скрыто…», list column withheld | Pass |
| R4 | Flat API + UI sections, type+category on LE and TT | Loader + `renderHoldingV2Composition` + browser text asserts | Pass |
| R5 | TT link opens selected store (`?store=`), reload, back | Browser `assertCompositionNavigation` desktop + mobile | Pass |
| R6 | Drift gate regression (accepted fix) | `onec-holding-v2-outlet-drift.test.ts` | Pass (1/1) |
| R7 | Mono composition loader | `holding-v2-composition-detail.test.ts` | Pass (1/1) |
| R8 | v2 pipeline / stable read / lock / reconcile | Integration suites listed below | Pass |
| R9 | Scoped list columns (composition, type, category) | Columns in UI + API summaries | Pass |
| R10 | **Scoped list filters + URL persistence for v2 composition/type/category** | No `holdingV2*` keys in `src/clients/query.ts` / field-filter registry | **Not implemented** (columns only; filters remain future work) |
| R11 | Preview read-only / ID substitution | Covered by existing access tests on branch stack; not re-run in this pass | Refer to #73–#74 suites |
| R12 | F1–F5 / G3 regressions | Full browser matrix not re-run here; unit baseline unchanged vs base | See baseline section |

## Commands run (sequential on test DB)

| Step | Command | Pass | Fail |
|------|---------|------|------|
| Typecheck | `npm run typecheck` | 1 | 0 |
| Build | `npm run build` | 1 | 0 |
| Unit (full baseline) | `npm test` | 641 | 18 |
| Composition loader | `node --import tsx --test test/integration/holding-v2-composition-detail.test.ts` | 1 | 0 |
| Clients v2 API | `node --import tsx --test test/integration/clients-holding-v2-api.test.ts` | 3 | 0 |
| Drift | `node --import tsx --test test/integration/onec-holding-v2-outlet-drift.test.ts` | 1 | 0 |
| Regular-update backfill | `node --import tsx --test test/integration/onec-holding-v2-regular-update-backfill.test.ts` | (included in batch) | 0 |
| Pipeline + lock + stable read | `node --import tsx --test --test-concurrency=1 test/integration/onec-holding-v2-{pipeline,pipeline-lock,stable-read,outlet-drift,regular-update-backfill}.test.ts` | 9 | 0 |
| Reconcile (4 composition types, omitted/empty/closure paths) | `node --import tsx --test --test-concurrency=1 test/integration/onec-holding-v2-reconcile.test.ts` | 20 | 0 |
| Browser E2E v2 | `TANDOOR_BROWSER_SCREENSHOT_DIR=…/media node --import tsx --test test/browser/holding-v2-e2e.browser.test.ts` | 1 | 0 |

**Unit baseline note:** at both `d0d3911` and this branch HEAD, `npm test` reports **641 pass / 18 fail** (same as base; failures treated as pre-existing unrelated).

## Screenshots (1440 / 390)

| Viewport | File |
|----------|------|
| Desktop list | `/cursor/stores/bc-01a0c95b-ccc6-786a-8dc8-f91f60a1cd82/media/holding-v2-list-desktop.png` |
| Mobile list | `…/holding-v2-list-mobile.png` |
| Desktop card + composition | `…/holding-v2-card-desktop.png`, `…/holding-v2-composition-desktop.png` |
| Mobile card + composition | `…/holding-v2-card-mobile.png`, `…/holding-v2-composition-mobile.png` |

Browser run: no new console errors observed in Playwright session; API 200 for exercised paths; no 5xx on holding v2 E2E flow.

## Explicitly out of scope (unchanged)

- Merge, deploy, production migration, FTP, import schedule, PR #72.
- lk.tandoor.ru publication and real-data confirmation.

## Remaining for owner / Computer final pass

1. End-to-end sign-off on lk.tandoor.ru per runbook (flag, schedule OFF).
2. Optional: implement scoped **filters** + URL state for `holdingV2CompositionLabel` / type / category (R10).
3. Full F1–F5 / G3 browser regression grid if required beyond unchanged unit baseline.
