# Export bundle manifest contract (1C → FTP)

**Status:** optional for regular update apply in ЛК (`onec-regular-update`).  
Ручная кнопка и ночной обмен читают `/LC/clients/all_clients.json` и `/LC/clients/all_employees.json` без обязательного manifest.  
Стабильное повторное чтение обоих файлов и combined verification fingerprint **не доказывают**, что они сформированы одним заданием 1С.

## File

| Property | Value |
|----------|--------|
| Path | `{ONEC_FTP_BASE_PATH}/clients/export_bundle_manifest.json` |
| Required for apply | **No** — ЛК применяет комплект по стабильному чтению и валидации |
| When present and valid | Подтверждает `releaseConsistencyConfirmed`, заполняет `exportBatchId` и `sourceExportAt` |

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

### Required fields (when manifest is published)

| Field | Type | Rule |
|-------|------|------|
| `v` | number | Must be `1` |
| `export_batch_id` | string | Non-zero UUID shared by this release |
| `files.all_clients.json.sha256` | string | 64-char hex of exact FTP file bytes |
| `files.all_employees.json.sha256` | string | 64-char hex of exact FTP file bytes |

### Optional fields

| Field | Type | Rule |
|-------|------|------|
| `export_formed_at` | string | Business timestamp of export formation (not FTP mtime); surfaced as `sourceExportAt` when present and valid |

## ЛК behaviour

| Signal | Meaning |
|--------|---------|
| `applyPermitted: true` | Оба файла прочитаны стабильно, прошли JSON/GUID/roster validation; apply разрешён |
| `releaseConsistencyConfirmed: true` | Только при **валидном** manifest с совпадающими SHA обоих файлов |
| `sourceExportAt` | Из `export_formed_at` manifest; **null**, если 1С не передала дату (время скачивания не подставляется) |

| Mode | Manifest absent / unreadable / invalid | Manifest valid |
|------|----------------------------------------|----------------|
| `--dry-run` | SUCCESS, `applyPermitted: true`, `releaseConsistencyConfirmed: false` | SUCCESS, `applyPermitted: true`, `releaseConsistencyConfirmed: true` |
| `--apply` / worker / nightly | Proceeds to existing import guards (fingerprint, shrink, lock, …) | Same; metadata from manifest preserved in result |

Invalid or stale manifest on FTP **не блокирует** apply и **не** выставляет `releaseConsistencyConfirmed=true`.

## Ограничение для операторов

Стабильное чтение двух файлов защищает от drift во время скачивания, но **не доказывает** единый выпуск 1С. Для явного подтверждения одного задания 1С может публиковать manifest; без него apply опирается на остальные guards (fingerprint, shrink, combined validation).

## Open questions for 1C

1. Confirm atomic publish sequence (temp files + rename vs sequential overwrite).
2. Confirm timezone/format for `export_formed_at` if manifest will be published later.
3. Confirm whether partial roster or dismissal will use separate manifest flags in a future schema version.
