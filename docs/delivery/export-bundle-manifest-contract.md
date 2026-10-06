# Export bundle manifest contract (1C → FTP)

**Status:** required for regular update apply in ЛК (`onec-regular-update`).  
Stable reads and combined verification fingerprint alone do **not** prove that `all_clients.json` and `all_employees.json` belong to the same 1C export release.

## File

| Property | Value |
|----------|--------|
| Path | `{ONEC_FTP_BASE_PATH}/clients/export_bundle_manifest.json` |
| Publish order | **After** both data files are fully written |
| Ready-marker alone | **Not sufficient** — marker must not replace this manifest |

## JSON schema (v1)

```json
{
  "v": 1,
  "export_batch_id": "550e8400-e29b-41d4-a716-446655440000",
  "export_formed_at": "2026-10-06T14:30:00",
  "files": {
    "all_clients.json": { "sha256": "<lowercase hex SHA-256 of file bytes>" },
    "all_employees.json": { "sha256": "<lowercase hex SHA-256 of file bytes>" }
  }
}
```

### Required fields

| Field | Type | Rule |
|-------|------|------|
| `v` | number | Must be `1` |
| `export_batch_id` | string | Non-zero UUID shared by this release |
| `files.all_clients.json.sha256` | string | 64-char hex of exact FTP file bytes |
| `files.all_employees.json.sha256` | string | 64-char hex of exact FTP file bytes |

### Optional fields

| Field | Type | Rule |
|-------|------|------|
| `export_formed_at` | string | Business timestamp of export formation (not FTP mtime); surfaced as `sourceExportAt` when present |

## ЛК behaviour

| Mode | Manifest absent / unreadable | Manifest invalid | Manifest valid |
|------|------------------------------|------------------|----------------|
| `--dry-run` | SUCCESS, `applyPermitted: false`, message: release consistency not confirmed | REJECTED | SUCCESS, `applyPermitted: true` |
| `--apply` | REJECTED (`RELEASE_CONSISTENCY_NOT_CONFIRMED`), no DB writes | REJECTED | Proceeds to existing import guards |

## Open questions for 1C

1. Confirm atomic publish sequence (temp files + rename vs sequential overwrite).
2. Confirm timezone/format for `export_formed_at`.
3. Confirm whether partial roster or dismissal will use separate manifest flags in a future schema version.
