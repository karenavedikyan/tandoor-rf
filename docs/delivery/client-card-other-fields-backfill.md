# Дозагрузка `other_fields` (исполняемый план, без auto-run)

Цель: после merge PR заполнить `onec_v3_legal_entities.other_fields` всеми ключами `other` из уже применённого clients SHA, **без** полного regular-update и без затрагивания назначений/адресов.

## Таблицы

| Таблица | Поле | Назначение |
|---------|------|------------|
| `onec_v3_legal_entities` | `other_fields` JSONB | все ключи `all_clients.json.other` |
| `onec_v3_legal_sales_lines` | строки продаж | отдельный apply `sale.json` |
| `onec_v3_legal_sales_import_state` | метаданные apply | `id=1`, `source_sha256`, `row_count` |

## 1. Backup (только `other_fields`)

```bash
export DATABASE_URL="$TEST_OR_PROD_URL"
pg_dump --format=custom --table=onec_v3_legal_entities --file=backup-legal-other-$(date +%Y%m%d).dump "$DATABASE_URL"
```

Для точечного отката поля (не всей таблицы):

```sql
CREATE TABLE IF NOT EXISTS backup_legal_other_fields_YYYYMMDD AS
SELECT guid_client, other_fields, last_source_sha256, last_imported_at
FROM onec_v3_legal_entities;
```

## 2. Dry-run на test DB

```bash
npm run build
export DATABASE_URL="$TEST_DATABASE_URL"
node dist/cli/onec-regular-update.js --dry-run \
  --clients-file /path/to/all_clients.json \
  --holdings-file /path/to/all_holding.json \
  --retail-file /path/to/all_retail.json \
  --employees-file /path/to/all_employees.json
```

Зафиксировать `verificationFingerprint` из вывода.

## 3. Apply clients с тем же fingerprint (test)

```bash
node dist/cli/onec-regular-update.js --apply --expected-fingerprint="<fingerprint>" \
  --clients-file /path/to/all_clients.json \
  --holdings-file /path/to/all_holding.json \
  --retail-file /path/to/all_retail.json \
  --employees-file /path/to/all_employees.json
```

Если apply отклонён из-за совпадения SHA с уже применённым снимком — использовать **узкий** SQL backfill из staging-таблицы (только `other_fields`), сверяя `guid_client` и `last_source_sha256`:

```sql
UPDATE onec_v3_legal_entities le
SET other_fields = staging.other_fields
FROM staging_legal_other staging
WHERE le.guid_client = staging.guid_client
  AND le.last_source_sha256 = staging.last_source_sha256;
```

`staging_legal_other` формируется отдельным одноразовым скриптом parse JSON → COPY (добавить при внедрении узкого инструмента; в этом PR — только контракт).

## 4. Контроль

```sql
SELECT COUNT(*) FROM onec_v3_legal_entities WHERE other_fields ? 'Оптовик_КонтактноеЛицо';
SELECT COUNT(*) FROM onec_v3_legal_entities WHERE other_fields ? 'Оптовик_СтатусКлиента';
```

Сравнить с ожидаемыми агрегатами снимка (без выгрузки PII).

## 5. Продажи (отдельное разрешение)

```bash
# отдельный контур onec-sales apply — не clients regular-update
node dist/cli/onec-v3-legal-sales-import.js --help
```

Проверка:

```sql
SELECT row_count, imported_at FROM onec_v3_legal_sales_import_state WHERE id = 1;
SELECT COUNT(*) FROM onec_v3_legal_sales_lines;
```

## Rollback

```sql
UPDATE onec_v3_legal_entities le
SET other_fields = b.other_fields
FROM backup_legal_other_fields_YYYYMMDD b
WHERE le.guid_client = b.guid_client;
```

## Запреты

- Не запускать на production без отдельного разрешения владельца.
- Не использовать полный regular-update как «узкий backfill», если он затрагивает roster/назначения вне `other_fields`.
