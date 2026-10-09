# Holding v2 — release runbook (pipeline + UI)

**Stack:** PR #73 → #74 → #75.  
**Site (manual operator UI):** https://lk.tandoor.ru  
**Production default:** `ONEC_HOLDING_V2_PIPELINE_ENABLED` unset/false → v2 **`APPLY_BLOCKED`**.  
**Scheduled 1C exchange:** always **OFF** (including lk.tandoor.ru); updates use **manual regular-update / admin path only**.

## Status matrix

| Capability | Implemented | Local test-DB | Published branch | Prod real-data confirmed |
|------------|-------------|---------------|------------------|---------------------------|
| Parser/diagnostics v2 (#73) | yes | yes | draft #73 | no |
| Reconcile storage (#74) | yes | yes | draft #74 | no |
| Stable read + regular-update v2 path (#75) | yes | yes | draft #75 | no |
| Atomic apply + reconcile | yes | yes | draft #75 | no |
| Scoped API/UI composition + type_category | yes | yes | draft #75 | no |
| Browser E2E (1440/390) with login | yes | yes | draft #75 | no |

## Pre-release (production — owner-approved only)

1. **Backup / restore plan:** full PostgreSQL snapshot (`onec_holding_v2_*`, `onec_clients`, import runs). Verify restore procedure on a non-prod clone before any prod step.
2. **Drain:** no `running` apply in `onec_client_import_runs`; complete or cancel pending admin/operator jobs.
3. **Migrations:** apply through `041_onec_holding_v2_reconciliation.sql` on production **only after explicit owner approval** for prod migration. Staging/test-DB migration does **not** count as production migration.
4. **Deploy application** with **`ONEC_HOLDING_V2_PIPELINE_ENABLED` unset (OFF)** on lk.tandoor.ru app + worker.

## Production enablement sequence (verified order)

Do **not** run a v2 apply while the pipeline flag is OFF (apply remains blocked). Do **not** apply first and enable the flag afterward unless this sequence was re-validated on a clone.

1. Backup + drain (above).
2. Prod migrations (owner-approved).
3. Deploy code with flag **OFF**.
4. **Read-only audit** of the current 1C clients file — confirm explicit **v2** contract (self-ref heads, diagnostics), e.g.:
   ```bash
   export AUDIT_CLIENTS_PATH=/secure/path/all_clients.json
   node --import tsx scripts/holding-v2-diagnose-clients-file.ts
   ```
5. **Coordinated flag ON:** set `ONEC_HOLDING_V2_PIPELINE_ENABLED=true` on app + worker; confirm **no queued jobs** and scheduled exchange still **OFF**.
6. **Standard dry-run** (regular-update or admin 1C update UI on lk.tandoor.ru) → capture `verificationFingerprint` (bundle + roster stable read).
7. **Exactly one owner-approved manual apply** with matching `--expected-fingerprint` / admin apply action.
8. **Post-apply verification:** DB sample (`onec_holding_v2_*`, F1–F5), API scoped reads, UI sample (composition, type/category v2). Repeat identical bundle → **`NO_CHANGES`** without a new success import run.

## Dry-run (staging / test-DB)

- Flag OFF: legacy validation; v2 apply blocked.
- Flag ON: `readStableImportBundle` uses explicit v2 contract; apply writes clients + reconcile atomically.
- Gate compares **persisted v2 tables vs desired projection** (not stale `apply_state` alone).
- Repeat apply → `NO_CHANGES` when fingerprint and F1–F5/G3/roster unchanged.

## Rollback

| Layer | Action | Safe? |
|-------|--------|-------|
| Flag OFF | Blocks new v2 apply immediately | yes for **new** writes |
| App redeploy (legacy code) | Stops v2 code paths | **not** data-safe if v2 tables already written |
| DB restore | Full restore from pre-v2 backup | yes when v2 apply committed |
| Legacy-only apply after v2 | May leave v2 tables stale vs `onec_clients` | **requires** owner decision + possible restore |

Returning legacy **code** after a successful v2 apply does **not** automatically revert v2 link/metadata tables.

## Verification (local CI)

```bash
export TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/tandoor_rf_test
npm run typecheck && npm run build
node --import tsx --test --test-concurrency=1 test/integration/onec-holding-v2-stable-read.test.ts
node --import tsx --test --test-concurrency=1 test/integration/onec-holding-v2-pipeline.test.ts
node --import tsx --test --test-concurrency=1 test/integration/onec-holding-v2-reconcile.test.ts
node --import tsx --test --test-concurrency=1 test/integration/onec-holding-v2-outlet-drift.test.ts
node --import tsx --test --test-concurrency=1 test/integration/onec-holding-v2-regular-update-backfill.test.ts
node --import tsx --test --test-concurrency=1 test/integration/onec-holding-v2-pipeline-lock.test.ts
node --import tsx --test --test-concurrency=1 test/integration/clients-holding-v2-api.test.ts
node --import tsx --test test/browser/holding-v2-e2e.browser.test.ts
```

## Out of scope

- Production merge/deploy/migrate by agent without owner approval
- Enabling scheduled exchange
- Holding-based scope/grant expansion
