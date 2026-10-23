# Matched-only sales bundle import (plan / backup / apply / rollback)

Read-only by default. Production apply is out of scope for this document; operators use verified backups on a private destination.

## Prerequisites

- Migrations through **049** applied on the target database (sidecar tables).
- `TEST_DATABASE_URL` for any write path (`--apply`, `--rollback`, `--capture-backup` before apply).
- Four September 2026 source files under `/LC/sale/` with verified SHA-256 (full files, not matched subsets).
- Target DB fingerprint from `npm run onec-exchange-v3-target-db-identity:local`.

## 1. Plan (default, no writes)

```bash
npm run build
TEST_DATABASE_URL='postgresql://…' node dist/cli/onec-v3-sales-matched-bundle-import.js \
  --plan \
  --sale-aggregate /path/sale.json \
  --sale-items '/path/sale(items).json' \
  --returns-aggregate /path/returne.json \
  --return-items '/path/returne(items).json' \
  --out-plan /private/plan.json
```

Record `planHash` from stdout. Plan includes `policy: matched-only`, four source SHAs, parity flags, catalog fingerprint, unknown union digest, per-dataset full/matched/excluded counts, and `beforeStateSha256`.

## 2. Capture verified backup (before apply)

After plan is approved, capture scoped rows for plan months:

```bash
node dist/cli/onec-v3-sales-matched-bundle-import.js \
  --capture-backup \
  --plan-file /private/plan.json \
  --out-backup /private/backup.json
```

Store `backupSha256` from stdout with the backup file.

## 3. Validate backup

```bash
node dist/cli/onec-v3-sales-matched-bundle-import.js \
  --validate-backup \
  --plan-file /private/plan.json \
  --backup-file /private/backup.json \
  --expected-backup-sha256 <backupSha256>
```

## 4. Guarded apply (test DB only)

```bash
export TEST_DATABASE_URL='postgresql://…'
node dist/cli/onec-v3-sales-matched-bundle-import.js \
  --apply \
  --plan-file /private/plan.json \
  --backup-file /private/backup.json \
  --approved-plan-hash <planHash> \
  --expected-backup-sha256 <backupSha256> \
  --sale-aggregate /path/sale.json \
  --sale-items '/path/sale(items).json' \
  --returns-aggregate /path/returne.json \
  --return-items '/path/returne(items).json'
```

Guards: plan hash, source SHAs, catalog fingerprint, before-state digest, backup proof, parity. Unknown GUID rows go to `onec_v3_legal_sales_import_quarantine_rows`; line tables receive **matched only**.

## 5. Rollback (same plan scope, drift-protected)

```bash
node dist/cli/onec-v3-sales-matched-bundle-import.js \
  --rollback \
  --plan-file /private/plan.json \
  --backup-file /private/backup.json \
  --approved-plan-hash <planHash>
```

Fails with `ROLLBACK_DRIFT_AFTER_STATE` if current DB state does not match the apply receipt `afterStateSha256`.

## Error codes (selected)

| Code | Meaning |
|------|---------|
| `BUNDLE_PARITY_FAILED` | Aggregate/items parity check failed |
| `PLAN_HASH_MISMATCH` | Operator hash ≠ computed plan |
| `PLAN_BEFORE_STATE_DRIFT` | DB changed since plan |
| `PLAN_CATALOG_DRIFT` | Legal entity catalog changed |
| `BACKUP_*` | Backup does not match plan |
| `IMPORT_LOCK_BUSY` | Another import holds the lock |
| `TEST_DATABASE_REQUIRED` | Apply/rollback without TEST_DATABASE_URL |
| `COMMIT_UNCERTAIN` | Prior apply outcome unknown; reconcile manually |

## Receipt (apply)

JSON receipt includes `planHash`, `beforeStateSha256`, `afterStateSha256`, `backupSha256`, inserted row counts, and quarantined count summary. Same `planHash` with no drift → no-op re-apply.
