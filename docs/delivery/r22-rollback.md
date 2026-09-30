# Rollback: R2.2 метки клиентов и кэш задач Bitrix24

**Migration:** `010_bitrix24_client_labels.sql`

## 1. Отключение без миграции (рекомендуется для пилота)

1. `BITRIX24_CACHE_PUBLISH_ENABLED=false`
2. `BITRIX24_CACHE_ACCESS_TTL_MS=0`
3. Не запускать `bitrix24-sync --apply`
4. UI карточки покажет «Синхронизация задач ещё не опубликована» / пустой список

Метки в реестре остаются; повторная выдача для того же объекта вернёт существующий код.

## 2. Откат миграции (только test/staging)

```sql
DROP TABLE IF EXISTS bitrix24_sync_journal;
DROP TABLE IF EXISTS bitrix24_task_bindings;
DROP TABLE IF EXISTS bitrix24_task_cache;
DROP TABLE IF EXISTS bitrix24_employee_portal_links;
DROP TABLE IF EXISTS bitrix24_object_labels;
DROP TABLE IF EXISTS bitrix24_confirmed_objects;
DROP TABLE IF EXISTS bitrix24_label_sequences;
DROP TYPE IF EXISTS bitrix24_object_type;
```

**Production:** выполнять только по согласованному окну. Данные реестра меток и кэша будут **безвозвратно удалены**.

## 3. Откат кода

- Удалить маршруты `/api/clients/:guid/bitrix24/*` из `src/clients/router.ts`
- Убрать блок «Работа» Bitrix24 из `public/client-card-prototype.js`
- Откатить env-переменные R2.2 в `.env.example`

## 4. Проверка после отката

- `npm run typecheck && npm test && npm run test:integration`
- GET `/api/clients/:guid/bitrix24/label` → 404 (маршрут отсутствует)
- Карточка клиента: вкладка «Работа» без блока меток
