# Дозагрузка `other_fields` (узкий CLI, без auto-run)

Цель: после merge PR заполнить `onec_v3_legal_entities.other_fields` всеми ключами `other` из уже применённого clients SHA, **без** полного regular-update и без затрагивания назначений/адресов.

## Таблицы

| Таблица | Поле | Назначение |
|---------|------|------------|
| `onec_v3_legal_entities` | `other_fields` JSONB | все ключи `all_clients.json.other` |
| `onec_v3_legal_sales_lines` | строки продаж | отдельный apply `sale.json` |
| `onec_v3_legal_sales_import_state` | метаданные apply | `id=1`, `source_sha256`, `row_count` |

Production source path: **`/LC/clients/all_clients.json`** (FTP, если `--clients-file` не передан). Для test/synthetic — локальный файл через `--clients-file`.

## CLI (узкий инструмент)

```bash
npm run build
export DATABASE_URL="$TEST_DATABASE_URL"

node dist/cli/onec-v3-legal-other-fields-backfill.js --dry-run \
  --clients-file /path/to/all_clients.json
```

В выводе JSON: `sourceSha256`, `targetDbFingerprint`, `plan.planHash`, `plan.updateCount`, `plan.unknownGuids`.

Apply (только test DB, после dry-run того же файла):

```bash
node dist/cli/onec-v3-legal-other-fields-backfill.js --apply \
  --clients-file /path/to/all_clients.json \
  --expected-source-sha256 <sourceSha256_из_dry-run> \
  --expected-plan-hash <plan.planHash_из_dry-run> \
  --confirm-target-db <targetDbFingerprint_из_dry-run>
```

Форма `--flag=value` тоже поддерживается.

Guards:

- SHA файла = `--expected-source-sha256`
- fingerprint БД = `--confirm-target-db`
- hash плана = `--expected-plan-hash`
- `UPDATE` только при `other_fields` **равном** снимку до изменения (`previousOtherFields`)
- optional: строки с `last_source_sha256` ≠ ожидаемому SHA пропускаются на apply
- advisory import lock на apply

**Не** использовать `onec-regular-update` с `--clients-file` — эти аргументы не поддерживаются (`UNKNOWN_ARGUMENT`).

## Backup / rollback (только `other_fields`)

```sql
CREATE TABLE IF NOT EXISTS backup_legal_other_fields_YYYYMMDD AS
SELECT guid_client, other_fields, last_source_sha256, last_imported_at
FROM onec_v3_legal_entities;
```

Rollback с guard (только если `other_fields` **совпадает** с ожидаемым post-apply снимком из плана, не просто «отличается от backup»):

```sql
UPDATE onec_v3_legal_entities le
SET other_fields = snap.previous_other_fields
FROM backfill_apply_snapshot snap
WHERE le.guid_client = snap.guid_client
  AND le.other_fields = snap.expected_post_other_fields;
```

`backfill_apply_snapshot` формируется из dry-run/apply плана (`previousOtherFields` + `expectedPostOtherFields` на строку). Если после apply было ручное изменение — `rowCount=0`, позднее состояние не затирается.

## Продажи (отдельное разрешение)

```bash
node dist/cli/onec-v3-legal-sales-import.js --help
```

```sql
SELECT row_count, imported_at FROM onec_v3_legal_sales_import_state WHERE id = 1;
SELECT COUNT(*) FROM onec_v3_legal_sales_lines;
```

## Запреты

- Не запускать на production без отдельного разрешения владельца.
- Не подменять узкий backfill полным regular-update.
