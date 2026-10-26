# September 2026 one-shot load — operator approval package

**Not a PR105 release.** Draft PR105 (`cursor/matched-only-sales-import-e6eb`) remains unchanged in scope; this document describes a **separate, manual** operator artifact for a **single** `2026-09` matched-only load into existing **047–048** tables only (no migration 049, no new DDL).

**This package does not authorize any production run.** Default CLI mode is **read-only preflight**. Backup, apply, and rollback require `SEPTEMBER_2026_EXTERNAL_AUTHORIZATION_REF` set **after** separate human approval; this development task does not supply production before-state digests, backup SHA, or monetary totals.

## Target (frozen)

| Item | Value |
|------|--------|
| Timeweb App | `258307` |
| Timeweb DB | `4212461` |
| DB fingerprint | `42946d0cc9e541918783dbd963c483227afb20428cad51af64481c3b2ab38f0f` |
| Catalog entities | `2747` |
| Catalog GUID set SHA | `33cd0d4220afdbd310b54db4564117ee4112f58305bb022e104e80f450c607be` (`SHA256(JSON.stringify(sorted lower(guid_client)))`) |
| Unknown GUIDs in sources | `414` |
| Sale month | `2026-09-01` only |
| App compatibility ref (main) | `6109c1a23a2528a1471da92c4a126b492ff6ca84` |

## Source file pins (FTP `/LC/sale/`)

| File | SHA-256 | full / matched / excluded |
|------|---------|---------------------------|
| `sale.json` | `93892acff9ae8c99aba3cd6d78257e6c9e68c320d65b387cb085a8910c784361` | 4415 / 3416 / 999 |
| `sale(items).json` | `63dc03737858ddabe34aa0f7e7001caeefe8f7b961eb9f264c8ba545dda43def` | 26928 / 24030 / 2898 |
| `returne.json` | `dc31bbb982e081b26c0587163164303f6e14c083ee55b1f69760eadc7e161dbb` | 462 / 413 / 49 |
| `returne(items).json` | `755560ee94a1001802cee6c91e5ddca40a296447f011999a76fa97d6bb7e7164` | 775 / 697 / 78 |

Any deviation in preflight → **STOP** and report; do not auto-expand scope.

## Read-only preflight executable (portable `.cjs`)

**Deliverable for Timeweb console (App 258307):** single bundled entry — not the PR105 executor and not `dist/` app CLI.

| Item | Value |
|------|--------|
| File | `operator-bundles/september-2026-one-shot-operator.cjs` |
| SHA-256 (file bytes) | `b7048b1b9498a70944ebee4f3dea232cc25974cdab09462d0d5ca1458f4dc065` |
| Rebuild | `npm run september-2026-read-only-preflight:build` |
| Verify SHA | `npm run september-2026-read-only-preflight:sha` |

**Runtime resolution (not bundled):** Node ≥22, npm package **`pg`** (and native optional `pg-native`) must be resolvable from the console working directory (`require('pg')`). No other runtime deps.

**No env bypasses** in this entry: `SEPTEMBER_2026_SYNTHETIC_HARNESS`, `TEST_DATABASE_URL`, or fake code-proof env vars are rejected.

### Runtime config (all four FTP inputs required, in RAM only)

Sources are **not** read from disk paths inside the bundle. Operator supplies one JSON config with pinned FTP paths and **base64** payloads (fetch FTP → memory in the parent shell; bundle does not write raw files):

```json
{
  "v": 1,
  "databaseUrl": "<runtime DATABASE_URL>",
  "sources": {
    "saleAggregate": { "path": "/LC/sale/sale.json", "contentBase64": "..." },
    "saleItems": { "path": "/LC/sale/sale(items).json", "contentBase64": "..." },
    "returnsAggregate": { "path": "/LC/sale/returne.json", "contentBase64": "..." },
    "returnItems": { "path": "/LC/sale/returne(items).json", "contentBase64": "..." }
  }
}
```

Run:

```bash
node operator-bundles/september-2026-one-shot-operator.cjs --runtime-config-json /path/to/runtime-config.json
```

Or `SEPTEMBER_2026_READ_ONLY_RUNTIME_CONFIG_JSON='…'` (inline JSON string).

### Read-only behaviour

1. **Target DB fingerprint** checked on the read-only connection **before** catalog / month-9 line / state reads. Wrong DB → `TARGET_FINGERPRINT_MISMATCH`, `catalog.code: NOT_RUN_WRONG_TARGET`, no private row reads.
2. **RR read-only** session (`REPEATABLE READ READ ONLY`); allowed reads only: schema 047–048, `onec_import_jobs` counts, catalog GUID set, month-9 line tables (PG-native snapshot digest), import state id=1, month activation 9.
3. **Safe JSON stdout:** target fingerprint, catalog fingerprint/count, four source SHA + full/matched/excluded, period, unknown unique count (414 pin), parity flags, exact decimal money/qty rollups (full/matched/excluded), before PG-native counts/digest, `readOnlyProof`. No row payloads, client names, secrets. `appReleaseRef` is a **compatibility_constraint**, not a live release probe.
4. **No** backup/apply/rollback/auto-write/049/DDL.

**Frozen snapshot directory (read-only, no FTP refresh):** `/tmp/tandoor-source-snapshot-20261024-4c64a1a4` with manifest SHA `cb390602949e493ce678706c471dc19bd502c7eb3ff1886b250eb0791b556cb5`.

**Operator data scope (candidate, not write authorization):** bytes SHA `f1daa71dce9172f93ab8590148634c0d09013ae07b60f5f8a6675392c793d9aa` — kind `FROZEN_SEPTEMBER_MATCHED_ONLY_SCOPE_CANDIDATE_NOT_WRITE_AUTHORIZATION`; `sources[*].guidFields` / `legacyIdFields` are numeric counters; `beforeCounts.*Json`; `excludedRows: 4024`; `allowedMetadata` is a single string. **All write flags stay false on this pinned candidate** (validator rejects `applyAuthorized: true` on bytes matching `f1daa…`). Human authorization is **not** flipping flags on the candidate file — it is a **separate** future grant/channel plus verified backup artifacts while the candidate scope remains read-only metadata.

**Backup CLI (`--backup`, after human approval):** requires `SEPTEMBER_2026_EXTERNAL_AUTHORIZATION_REF`, `SEPTEMBER_2026_BACKUP_GRANT_REF`, `SEPTEMBER_2026_BACKUP_PRIVATE_ROOT` (directory `0700`, not symlink), destination paths for payload + receipt, and pinned candidate scope path. Same preflight as apply under lock (target fingerprint, jobs, catalog, empty before). Payload written via `publishPrivateBackupJson` (pretty JSON + newline); returned **`fileSha256` is readback file bytes**, not compact `JSON.stringify(backup)`. Receipt built with `buildSeptemberBackupReceiptFromVerifiedPayload`. Stdout: paths + SHA only (no business values).

**Production apply channel (future):** `SEPTEMBER_2026_PRODUCTION_APPLY_CHANNEL_REF`, `SEPTEMBER_2026_APPLY_GRANT_REF`, candidate scope `f1daa…`, `SEPTEMBER_2026_BACKUP_RECEIPT_PATH` + SHA, `SEPTEMBER_2026_BACKUP_PAYLOAD_PATH`, and **mandatory** `SEPTEMBER_2026_BACKUP_PRIVATE_ROOT` (payload must live under `0700` root). CLI `--apply` without channel → `APPLY_NOT_AUTHORIZED` before scope. Integration tests may set `skipBackupPayloadPathSecurity` only in `testContext`.

**Empty before-state digest (September scope only):** `b8b0946873bc8079c559c9b5f746e7388bfa6c4555c2d33bcc611947b14b8ce5`.

Apply path: `runSeptember2026OneShotApply` / `--apply` (fail-closed `APPLY_NOT_AUTHORIZED` until production channel + authorized scope + backup receipt). Order under lock: target identity → import lock → gates (schema, all pending/running import **and** diagnostic jobs, nightly scheduler env disabled, catalog) → empty before + receipt binding → writes; after-digest computed inside the open transaction before `COMMIT`. Snapshot loader: directory `0700`, files `0600`, no symlinks, 32 MiB cap, manifest/sources bound to scope.

**Rollback CLI mode:** restore helpers exist (`rollback-047-048.ts`) but there is **no** production-ready bundled rollback operator mode yet — only-empty-before / strict after-guard apply to future rollback grants.

Legacy TS manifest hash (`code-bundle-manifest.ts`) is for dev traceability only — **operator handoff uses the `.cjs` file SHA above**.

## Backup / apply / rollback (code only)

Implemented in `september-2026-one-shot/` modules; default CLI remains read-only — **`--backup`** and **`--apply`** are explicit modes after authorization:

| Operation | Scope |
|-----------|--------|
| Backup | Four line tables month 9; four `*_import_state` id=1; `month_activation` month 9. Row payloads: **PostgreSQL `json_agg(row_to_json)` as raw text** (snapshot `v: 2`) — no JS `Number`/`Date` coercion; restore via `json_populate_recordset` / `json_to_recordset`. **Global sequences are not restored.** |
| Apply | Single transaction + lock; `sidecar049: false` (no 049 quarantine/stats/apply_runs); matched rows only in line tables; full materialization verify before COMMIT |
| Audit receipt | External private JSON (not 049) |
| Rollback | `rollback-047-048.ts` — separate authorization; identity + backup SHA + optional live-after guard; drift → STOP |

Private backup file: approved root `0700`, file `0600`, `wx` exclusive, readback hash, cleanup on failure.

## Local synthetic QA

`test/integration/september-2026-one-shot-synthetic.test.ts` (9 cases, local `TEST_DATABASE_URL` only):

| Scenario | Status |
|----------|--------|
| Read-only preflight harness (explicit `testContext` in tests) | **RUN** (integration) |
| External authorization gate / `DATABASE_URL`≠`TEST_DATABASE_URL` on writes | **RUN** |
| Private backup `wx` no-overwrite + `0700` root | **RUN** |
| Code bundle SHA stability | **RUN** |
| Frozen month pin | **RUN** |
| 047–048 backup JSON roundtrip + preserve August | **RUN** |
| PG JSON exact `NUMERIC` / `INTEGER` / `timestamptz` microsecond roundtrip | **RUN** |
| Source file SHA pin reject (synthetic bytes) | **RUN** |
| Rollback live-after drift STOP | **RUN** |
| Production RR preflight + FTP four-file pins + catalog SHA | **NOTRUN** (no authorization / no FTP in this task) |
| Production backup / apply / rollback | **NOTRUN** |
| Full matched-only apply matrix (idempotent repeat, commit-uncertain) | **NOTRUN** here — covered by existing `pr105-independent` on synthetic DB, not September pins |

`test/integration/september-2026-read-only-preflight.test.ts` — missing sources, wrong target before private SELECT, URL bypass, sanitization, `.cjs` SHA reproducibility (**RUN**).

`test/integration/september-2026-one-shot-apply-core.test.ts` (8), `september-2026-backup-receipt-payload.test.ts` (4), `september-2026-one-shot-backup-flow.test.ts` (6): file-byte SHA vs compact digest, `runSeptember2026OneShotBackup` → apply, private root required / `0755` / symlink refusal (**RUN**, `--test-concurrency=1`). Structural fixture: `test/fixtures/september-2026-operator-data-scope.structural.json` (synthetic money only).

`npm run typecheck` — **RUN** after changes. All `test/integration/september-2026-*.test.ts` (**34** cases, Node 22, `TEST_DATABASE_URL`, `--test-concurrency=1`, non-root) — **RUN** on localhost test DB. Production console preflight — **NOTRUN** from Cursor (operator runs bundled `.cjs` manually with SHA check).

## Explicitly out of scope

- PR105 universal production executor / grant / manifest approval path as deliverable
- Migration 049 tables, new DDL, main app UI changes, raw source import into app
- Any production backup/apply/rollback execution in this task
