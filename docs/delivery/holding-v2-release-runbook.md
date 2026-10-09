# Holding v2 — release runbook (pipeline + UI)

**Stack:** PR #73 parser/validator → PR #74 storage/reconcile → PR pipeline/UI (feature flag).  
**Production default:** `ONEC_HOLDING_V2_PIPELINE_ENABLED` unset/false → v2 payloads **`APPLY_BLOCKED`**.

## Status matrix

| Capability | Implemented | Local test-DB | Published branch | Prod confirmed |
|------------|-------------|---------------|------------------|----------------|
| Parser/diagnostics v2 (#73) | yes | yes | draft #73 | no |
| Reconcile tables + internal apply (#74) | yes | yes | draft #74 | no |
| Atomic `applyClientsImport` + reconcile | yes | yes | draft pipeline PR | no |
| API/UI type_category + composition | yes | yes | draft pipeline PR | no |
| Feature flag OFF default | yes | yes | — | n/a |

## Pre-release

1. **Backup** PostgreSQL (full snapshot + `pg_dump` schema+data for `onec_*` holding v2 tables).
2. **Drain jobs:** pause scheduled 1C exchange (`onec-scheduled-exchange`, nightly tick) per [import-runbook.md](./import-runbook.md).
3. **Migration gate:** ensure migration `041_onec_holding_v2_reconciliation.sql` applied on staging; verify empty `onec_holding_v2_apply_state` row id=1.
4. **Deploy** application build with **`ONEC_HOLDING_V2_PIPELINE_ENABLED` unset** (OFF).

## Read-only audit (before enable)

```bash
export AUDIT_CLIENTS_PATH=/secure/path/all_clients.json
node --import tsx scripts/holding-v2-diagnose-clients-file.ts
```

Record stdout `sha256`, `compositionTallies`, `typeCategoryStats` in change ticket. Do **not** import production file until audit signed off.

## Dry-run

1. Staging DB: run legacy apply on current production SHA (flag OFF) — regressions unchanged.
2. Validate v2 file bytes only (`validateHoldingV2ClientsFileBytes`) — no writes.
3. Optional: test-DB full pipeline test suite (`test/integration/onec-holding-v2-pipeline.test.ts`).

## Manual enable (production)

1. Maintenance window; exchange jobs still off.
2. Set env `ONEC_HOLDING_V2_PIPELINE_ENABLED=true` on app + worker processes.
3. Run **controlled** clients apply with v2-validated payload + matching verification fingerprint (operator CLI / admin update path — not FTP auto until explicitly approved).
4. Verify:
   - `onec_holding_v2_apply_state.last_normalized_state_sha256` populated
   - `onec_holding_v2_reconcile_runs` latest status `success` or `no_changes`
   - Sample client card API: `holdingV2.compositionLabel`, `type_category` fields visible within scope
   - Legacy list/card F1–F5 fields unchanged
5. Re-enable scheduled exchange only after smoke pass.

## Rollback dimensions

| Layer | Action |
|-------|--------|
| Flag | Set `ONEC_HOLDING_V2_PIPELINE_ENABLED=false` → immediate **APPLY_BLOCKED** for v2 |
| App | Redeploy previous build |
| Data | v2 tables are additive; rollback **does not** auto-delete links. Restore from backup if bad reconcile committed |
| Exchange | Re-point to last known-good `onec_clients` SHA via controlled apply (legacy schema) |

## Verification commands (local/CI)

```bash
npm run typecheck
npm run build
node --import tsx --test --test-concurrency=1 test/integration/onec-holding-v2-reconcile.test.ts
node --import tsx --test --test-concurrency=1 test/integration/onec-holding-v2-pipeline.test.ts
```

## Out of scope for this runbook

- Production merge/deploy (manual operator)
- FTP/scheduled import switch to v2 validator
- Holding-based scope expansion / grants changes
