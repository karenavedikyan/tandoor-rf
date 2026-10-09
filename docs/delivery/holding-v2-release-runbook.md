# Holding v2 — release runbook (pipeline + UI)

**Stack:** PR #73 → #74 → #75.  
**Production default:** `ONEC_HOLDING_V2_PIPELINE_ENABLED` unset/false → v2 **`APPLY_BLOCKED`**.  
**Scheduled 1C exchange:** remains **OFF** on rf.tandoor.ru; updates use **manual regular-update / admin path only**.

## Status matrix

| Capability | Implemented | Local test-DB | Published branch | Prod real-data confirmed |
|------------|-------------|---------------|------------------|---------------------------|
| Parser/diagnostics v2 (#73) | yes | yes | draft #73 | no |
| Reconcile storage (#74) | yes | yes | draft #74 | no |
| Stable read + regular-update v2 path (#75) | yes | yes | draft #75 | no |
| Atomic apply + reconcile | yes | yes | draft #75 | no |
| Scoped API/UI composition + type_category | yes | yes | draft #75 | no |
| Browser E2E (1440/390) with login | yes | partial | draft #75 | no |

## Pre-release

1. **Backup:** full PostgreSQL snapshot; include `onec_holding_v2_*` and `onec_clients`.
2. **Drain:** wait for `onec_client_import_runs` / operator jobs — no `running` apply; cancel or complete pending admin update jobs.
3. **Migrations:** apply through `041_onec_holding_v2_reconciliation.sql` on staging; verify singleton `onec_holding_v2_apply_state` row `id=1`.
4. **Deploy** build with **`ONEC_HOLDING_V2_PIPELINE_ENABLED` unset (OFF)**.

## Manual update path (production)

1. Operator **dry-run** regular-update (or admin 1C update UI) — capture `verificationFingerprint`.
2. Read-only audit:
   ```bash
   export AUDIT_CLIENTS_PATH=/secure/path/all_clients.json
   node --import tsx scripts/holding-v2-diagnose-clients-file.ts
   ```
3. Apply with matching `--expected-fingerprint` (same bundle + roster). **Do not** enable FTP/scheduled auto-import for v2 until owner sign-off.
4. After owner approval only: set `ONEC_HOLDING_V2_PIPELINE_ENABLED=true` on app + worker; repeat controlled apply; verify DB + UI sample.

## Dry-run (staging / test-DB)

- Legacy apply with flag OFF — F1–F5 regressions unchanged.
- Flag ON: `readStableImportBundle` validates v2 contract; apply runs clients + reconcile atomically.
- Repeat apply → `NO_CHANGES` (gate includes v2 normalized hash).

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
npm run typecheck && npm run build
node --import tsx --test --test-concurrency=1 test/integration/onec-holding-v2-stable-read.test.ts
node --import tsx --test --test-concurrency=1 test/integration/onec-holding-v2-pipeline.test.ts
node --import tsx --test --test-concurrency=1 test/integration/onec-holding-v2-reconcile.test.ts
node --import tsx --test --test-concurrency=1 test/integration/clients-holding-v2-api.test.ts
node --import tsx --test --test-concurrency=1 test/integration/onec-holding-v2-regular-update-backfill.test.ts
node --import tsx --test --test-concurrency=1 test/integration/onec-holding-v2-pipeline-lock.test.ts
node --import tsx --test --test-concurrency=1 test/browser/holding-v2-e2e.browser.test.ts
```

## Out of scope

- Production merge/deploy/migrate by agent
- Enabling scheduled exchange
- Holding-based scope/grant expansion
