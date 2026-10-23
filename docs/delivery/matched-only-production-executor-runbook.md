# Matched-only production executor (prepare ≠ approve ≠ execute)

**Development only in PR105.** No merge, deploy, migration 049 apply, FTP, or production data access from this tooling.

## Separation of concerns

| Phase | Who | What runs |
|-------|-----|-----------|
| **Prepare** | Engineering | Plan, manifest template, code review, draft 049 SQL evidence |
| **Approve** | Owner (out of band) | Human decision ref, `approvedExecutionHash`, manifest `APPROVED`, business backup export permission |
| **Execute** | Operator (future) | Production CLI with verified `DATABASE_URL`, matching manifest, explicit write mode |

Machine checks vs external evidence:

- **Machine:** PostgreSQL `targetDbFingerprint` via identity resolver; migration filenames 047–049 in `schema_migrations` (filename/applied_at only — not a checksum); guarded table column types; manifest `contentHash` (binds approval metadata except `approvedExecutionHash`); `executionBudget.matchedTotals` per dataset (scale-4 money / scale-6 quantity, not aggregate+items sums); source-derived plan hash; backup SHA vs bytes; import lock; pre-COMMIT row/key/value materialization checks; preflight `REPEATABLE READ` RO snapshot (`BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`).
- **Executable artifact:** verified write requires manifest `provenance.expectedExecutableArtifactSha256` matching runtime `MATCHED_ONLY_EXECUTABLE_ARTIFACT_SHA256` (or SHA of `MATCHED_ONLY_EXECUTABLE_ARTIFACT_PATH`) — label alone is not proof.
- **Private capture:** separate `privateBackupCapture` consent (`approvedCaptureHash`, `humanCaptureRef`, `validUntil`) plus CLI `--approved-capture-hash`; apply manifest must be `APPROVED`; exclusive destination create (no overwrite); live DB fingerprint must match plan.
- **External (required):** Timeweb control-plane App `258307` / DB `4212461` match operator context; owner approval hash; private backup file custody; migration 049 apply on production (not done by this CLI).

Pinned production DB fingerprint (stop if live differs):

`42946d0cc9e541918783dbd963c483227afb20428cad51af64481c3b2ab38f0f`

Draft 049 SQL SHA-256 (release evidence, not applied in production yet):

`992e21c6dce071bab2a4e915612618c576be0862d2afe963ad957249dcd612eb`

## Test-only vs production entrypoints

| Entry | Writes | Database |
|-------|--------|----------|
| `onec-v3-sales-matched-bundle-import` | apply/rollback only with `TEST_DATABASE_URL` | test channel |
| `onec-v3-sales-matched-bundle-production` | default read-only; DML only `--write-apply` / `--write-rollback` + approved manifest | `DATABASE_URL` only (never `TEST_DATABASE_URL` fallback) |

## NOT_APPROVED manifest template (no real parameters)

```bash
npm run build
node dist/cli/onec-v3-sales-matched-bundle-production.js --emit-not-approved-template --template-operation apply
```

Template fields `plan`, `planHash`, backup paths, money totals, and approval hash remain `null` until owner-approved artifacts exist.

## Read-only preflight (example shape — no real URLs or hashes)

```bash
export DATABASE_URL='postgresql://…'   # production runtime URL only
node dist/cli/onec-v3-sales-matched-bundle-production.js \
  --preflight \
  --operation apply \
  --manifest-file /private/execution-manifest.NOT_APPROVED.json
```

Fails closed on: missing approval, wrong target fingerprint, schema not ready (`SCHEMA_NOT_READY`, 0 writes), manifest drift, mixed test/prod URL.

## Future write (not executable now)

Requires separate owner approvals for code release, 049 apply, business backup, and one apply operation. Operator passes **out-of-band** `--approved-execution-hash` matching manifest `approval.approvedExecutionHash` (not derived from the same file by the tool).

```bash
# Illustration only — do not run without approved manifest and owner sign-off
export DATABASE_URL='postgresql://…'
export MATCHED_ONLY_CODE_ARTIFACT_LABEL='<release-artifact-id>'
node dist/cli/onec-v3-sales-matched-bundle-production.js \
  --write-apply \
  --manifest-file /private/execution-manifest.APPROVED.json \
  --approved-execution-hash '<operator-supplied-hash>'
```

No auto-retry, no force bypass, `COMMIT_UNCERTAIN` remains manual reconcile.

## Validate backup proof (sanitized stdout)

```bash
node dist/cli/onec-v3-sales-matched-bundle-production.js \
  --validate-backup-proof \
  --operation apply \
  --manifest-file /private/execution-manifest.json
```

Stdout includes `backupProof` metadata only, not full backup payload.
