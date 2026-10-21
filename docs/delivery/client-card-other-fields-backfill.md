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

После успешного `--apply` CLI автоматически пишет строки в `onec_v3_legal_other_backfill_snapshots` (миграция `046_onec_v3_legal_other_backfill_snapshots.sql`):

| Колонка | Смысл |
|---------|--------|
| `guid_client`, `plan_hash` | PK снимка apply |
| `source_sha256` | SHA clients-файла |
| `previous_other_fields` | JSON до apply |
| `expected_post_other_fields` | post JSON **с тем же trusted-stamping**, что и apply (`persistableLegalOtherFields`) |

Откат только через поддержанный CLI (не ручной SQL на prod):

Dry-run (read-only, без UPDATE):

```bash
node dist/cli/onec-v3-legal-other-fields-backfill.js \
  --dry-run --rollback-plan-hash <plan.planHash_из_apply>
```

Apply (требует target DB + plan hash):

```bash
node dist/cli/onec-v3-legal-other-fields-backfill.js \
  --apply --rollback-plan-hash <plan.planHash_из_apply> \
  --expected-plan-hash <тот_же_hash> \
  --confirm-target-db <targetDbFingerprint>
```

Guard: `UPDATE` только если текущий `other_fields` **байт-в-байт** равен `expected_post_other_fields` из снимка. Если после apply было ручное изменение — откат пропускает строку (`ROLLBACK_GUARD`).

Опциональный SQL backup перед apply (только test/synthetic):

```sql
CREATE TABLE IF NOT EXISTS backup_legal_other_fields_YYYYMMDD AS
SELECT guid_client, other_fields, last_source_sha256, last_imported_at
FROM onec_v3_legal_entities;
```

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
