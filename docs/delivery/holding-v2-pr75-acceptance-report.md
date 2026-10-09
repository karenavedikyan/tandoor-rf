# Holding v2 PR #75 — acceptance report (test DB)

**Branch:** `cursor/holding-v2-pipeline-ui-9e11` (Draft PR #75)  
**Stack:** #73 → #74 → **#75**  
**Base (stack):** `cursor/holding-v2-storage-phase2-9e11` / merge-base with `main`: `53712c1`  
**Acceptance start commit (owner):** `ead3a45`  
**Acceptance HEAD:** _(set after push — see git log on branch)_  
**Environment:** `TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/tandoor_rf_test`  
**Pipeline flag (tests):** `ONEC_HOLDING_V2_PIPELINE_ENABLED=true` via test helpers  

**Status labels:** local test-DB verified on this branch ≠ published on lk.tandoor.ru ≠ production real-data sign-off.

## Summary of this pass

1. **R10 — scoped list filters (server-side):** `holdingV2Composition`, `holdingV2NameType`, `holdingV2NameCategory` in query/registry → SQL via `applyClientHoldingV2ListFilters` **after** scope merge (totals before pagination) → scoped options in `/api/clients/options` → UI selects + URL parse/serialize + reset. Composition token SQL mirrors visibility (`unknown` vs `withheld`); partial manager scope cannot filter by visible `mono_network` when composition is withheld.
2. **Fix:** `field_presence` JSON keys use camelCase (`nameType`, `nameCategory`) in filters/options SQL.
3. **Browser E2E (real API):** 1440 + 390 — filter UI → API `total` → card composition → second TT → reload URL → reset (desktop); mobile repeats filter + list + card flow.
4. **R11/R12:** Targeted integration re-run on final tree (preview read-only, F1–F5 fields, G3 roster team array, holding v2 API/filters/composition).

Prior pass items (composition scope TT+legal, flat `compositionDetail`, `?store=` deep-link) remain as documented in R1–R9 below.

## Requirement checklist

| ID | Requirement | Verification | Result |
|----|-------------|--------------|--------|
| R1 | Full composition requires all legal entities in scope | `clients-holding-v2-api.test.ts` | Pass |
| R2 | Full composition requires all holding TT in outlet scope | Same suite (mono 2×TT / partial manager) | Pass |
| R3 | Withheld → no aggregate composition type/label leak | API + list filters (`withheld` token, no `mono_network` in manager options) | Pass |
| R4 | Flat API + UI sections, type+category on LE and TT | `holding-v2-composition-detail.test.ts` + browser card asserts | Pass |
| R5 | TT link `?store=`, reload, back | `holding-v2-e2e.browser.test.ts` `assertCompositionNavigation` | Pass |
| R6 | Drift gate regression | `onec-holding-v2-outlet-drift.test.ts` | Pass |
| R7 | Mono composition loader | `holding-v2-composition-detail.test.ts` | Pass |
| R8 | v2 pipeline / stable read / lock / reconcile | Pipeline batch (29 tests) | Pass |
| R9 | Scoped list columns (composition, type, category) | UI columns + API summaries | Pass |
| R10 | **Scoped list filters + URL** (composition / type v2 / category v2) | `clients-holding-v2-list-filters.test.ts` + browser filter flow | **Pass** |
| R11 | Preview read-only / ID substitution / role scope | `clients-f6-api-access-scope.test.ts` (preview start/stop, manager outlet scope) | Pass (re-run this pass) |
| R12 | F1–F5 / G3 regressions (touched paths) | F1–F5 integration suites + `onec-roster-team-array.test.ts` | Pass (62/62 targeted integration) |

## R10 detail (non-optional)

| Check | Evidence |
|-------|----------|
| SQL before pagination | Integration asserts `total` matches filtered `items` for admin + manager |
| Options scoped | Admin: `mono_network` in options, not `withheld`; manager partial TT: `withheld` only, no `mono_network` |
| `unknown` vs `withheld` | Token subquery + manager filter cases in `clients-holding-v2-list-filters.test.ts` |
| Entity `outlets` | Query rejects `holdingV2*` params (existing validation in `query.ts`) |
| URL / reload / reset | Browser `applyHoldingV2ScopedFilters` + `assertFilteredListReloadAndReset` |

## Commands run (test DB)

| Step | Command | Pass | Fail |
|------|---------|------|------|
| Typecheck | `npm run typecheck` | 1 | 0 |
| Build | `npm run build` | 1 | 0 |
| Unit (project baseline) | `npm test` | 641 | 18 |
| R10 filters | `node --import tsx --test test/integration/clients-holding-v2-list-filters.test.ts` | 2 | 0 |
| Holding v2 API | `node --import tsx --test test/integration/clients-holding-v2-api.test.ts` | 3 | 0 |
| Composition loader | `node --import tsx --test test/integration/holding-v2-composition-detail.test.ts` | 1 | 0 |
| R11 preview / scope | `node --import tsx --test test/integration/clients-f6-api-access-scope.test.ts` | (in batch) | 0 |
| F1–F5 integration | `node --import tsx --test test/integration/clients-f{1..5}-*.test.ts` | (in batch) | 0 |
| G3 roster teams | `node --import tsx --test test/integration/onec-roster-team-array.test.ts` | 6 | 0 |
| **Targeted integration batch** | `--test-concurrency=1` all of the above in one invocation | **62** | **0** |
| Pipeline + reconcile | `node --import tsx --test --test-concurrency=1 test/integration/onec-holding-v2-{pipeline,pipeline-lock,stable-read,outlet-drift,regular-update-backfill}.test.ts test/integration/onec-holding-v2-reconcile.test.ts` | 29 | 0 |
| Browser E2E v2 + filters | `TANDOOR_BROWSER_SCREENSHOT_DIR=…/media node --import tsx --test test/browser/holding-v2-e2e.browser.test.ts` | 1 | 0 |

**Unit baseline note:** `npm test` reports **641 pass / 18 fail** — same unrelated pre-existing failures as on stack base (not introduced by R10); failures not rewritten in this PR.

## Screenshots (1440 / 390)

| Viewport | File |
|----------|------|
| Desktop list + v2 filters | `/cursor/stores/bc-01a0c95b-ccc6-786a-8dc8-f91f60a1cd82/media/holding-v2-list-filters-desktop.png` |
| Mobile list + v2 filters | `…/holding-v2-list-filters-mobile.png` |
| Desktop card + composition | `…/holding-v2-card-desktop.png`, `…/holding-v2-composition-desktop.png` |
| Mobile card + composition | `…/holding-v2-card-mobile.png`, `…/holding-v2-composition-mobile.png` |

## Explicitly out of scope (unchanged)

- Merge, deploy, production migration, FTP, import schedule, PR #72.
- lk.tandoor.ru publication and real-data confirmation.

## External blockers

None for local test-DB acceptance. Production access is not required for the scenarios above.
