# Дозагрузка `other_fields` и продаж (инструкция, без auto-run)

Цель: после merge PR с полным сохранением `other` применить обмен на **тестовой** БД, затем — по отдельному разрешению владельца — на production.

## Затрагиваемые таблицы

- `onec_v3_legal_entities.other_fields` (JSONB, все ключи `other`)
- `onec_v3_sales_lines` (продажи, отдельный файл `sale.json`)

## Предусловия

1. Backup: `pg_dump --format=custom --table=onec_v3_legal_entities --table=onec_v3_sales_lines …`
2. Зафиксировать `last_source_sha256` / fingerprint текущего успешного clients apply.
3. Убедиться, что версия кода содержит `pickSupportedOtherFields` без усечения ключей.

## Тестовый прогон (обязательно)

```bash
export DATABASE_URL="$TEST_DATABASE_URL"
npm run build
node dist/cli/onec-regular-update.js --dry-run …   # или exchange-v3 apply с fixtures
# Сравнить COUNT записей с непустым jsonb_object_keys(other_fields)
psql "$TEST_DATABASE_URL" -c "SELECT COUNT(*) FROM onec_v3_legal_entities WHERE other_fields ? 'Оптовик_КонтактноеЛицо';"
```

Повторный apply **того же** файла с тем же SHA не должен пропускать backfill: при необходимости использовать явный режим re-apply полей (см. `onec-exchange-v3` apply markers) — **не отключать** idempotency глобально.

## Production (только по разрешению)

1. Окно обслуживания + backup.
2. `onec-exchange-v3` apply clients с тем же fingerprint, что на staging, либо полный regular update по регламенту.
3. Отдельный apply `sale.json` (4415 строк в снимке) — sales apply не входит в clients apply.
4. Контрольные запросы:

```sql
SELECT COUNT(*) FROM onec_v3_legal_entities WHERE other_fields ? 'Оптовик_СтатусКлиента';
SELECT COUNT(*) FROM onec_v3_sales_lines;
```

5. Rollback: восстановить dump таблиц, не трогать unrelated migrations.

## Ограничения

- Не менять назначения клиентов, роли, grants.
- Не использовать `ГруппаДоступа` для выдачи прав в ЛК.
- Отрицательные `income` / `quantity` в sales не нормализовать.
