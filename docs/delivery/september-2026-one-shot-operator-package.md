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
| `sale.json` | `1e7db83fce17f3a10bc9d63d3c913283db4f900794e1212666d6e44d76d51d5e` | 4415 / 3416 / 999 |
| `sale(items).json` | `9e35a3fae84e8cd46d8413277b8251ecbd0429447654499fc1d0c51878d762cc` | 26928 / 24030 / 2898 |
| `returne.json` | `dc31bbb982e081b26c0587163164303f6e14c083ee55b1f69760eadc7e161dbb` | 462 / 413 / 49 |
| `returne(items).json` | `755560ee94a1001802cee6c91e5ddca40a296447f011999a76fa97d6bb7e7164` | 775 / 697 / 78 |

Any deviation in preflight → **STOP** and report; do not auto-expand scope.

## Self-contained code bundle

Operator entry (not HTTP/cron/public API):

```bash
npm run build
npm run september-2026-operator:code-bundle-sha   # SHA-256 over listed operator sources
node dist/cli/onec-v3-sales-september-2026-operator.js --preflight
```

Sources listed in `src/onec-sales/september-2026-one-shot/code-bundle-manifest.ts`.

**Executable operator code bundle SHA-256 (listed files only):** `47ff7f1586555d7dac0e8ff9e1e600263831aad52a91a46903b681e83a409526`  
Recompute after any change: `npm run september-2026-operator:code-bundle-sha`.

Preflight (read-only, RR snapshot):

- `DATABASE_URL` — production runtime URL only when `SEPTEMBER_2026_PREFLIGHT_ALLOW_RUNTIME_DATABASE=1` after approval; **never** set `TEST_DATABASE_URL` to production URL.
- Optional local path overrides for source verification (bytes not committed):  
  `SEPTEMBER_2026_SOURCE_SALE_AGGREGATE`, `SEPTEMBER_2026_SOURCE_SALE_ITEMS`, `SEPTEMBER_2026_SOURCE_RETURNS_AGGREGATE`, `SEPTEMBER_2026_SOURCE_RETURN_ITEMS`

Output: JSON technical report (`beforeStateDigest`, line counts for month 9, catalog/schema/target checks, source pin results). No SQL writes, no raw payload persistence.

## Backup / apply / rollback (code only)

Implemented in `september-2026-one-shot/` modules; **not** wired to default CLI (explicit separate invocation after authorization):

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
| Read-only preflight harness (`SEPTEMBER_2026_SYNTHETIC_HARNESS=1`) | **RUN** (integration) |
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

`npm run typecheck` — **RUN** after changes. Full `npm test` — recommended before merge; not re-run for this doc-only SHA pin unless CI requires it.

## Explicitly out of scope

- PR105 universal production executor / grant / manifest approval path as deliverable
- Migration 049 tables, new DDL, main app UI changes, raw source import into app
- Any production backup/apply/rollback execution in this task
