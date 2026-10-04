# Runbook: clean reload актуальной базы 1С (tandoor-rf)

**Назначение:** однократная явная процедура «чистый старт» для контура РФ в разработке: удалить старый тестовый состав клиентов/каталога в явно определённой области и загрузить зафиксированный комплект файлов 1С.

**Не заменяет** регулярный импорт (`onec-clients-import`, `onec-catalog-import`) и **не** архивирует старые клиенты (в отличие от `onec-wholesale-baseline-replace`).

---

## 1. Комплект источников (bundle)

Каталог `--bundle-dir` должен содержать **ровно один снимок**, прочитанный до начала apply:

```
<bundle-dir>/
  all_clients.json
  all_employees.json
  catalog/groups/data.xml
  catalog/section/data.xml
  catalog/storage/data.xml
  catalog/types_prices/data.xml
  catalog/products/data.xml
  catalog/prices/data.xml
  catalog/stock/data.xml
  catalog/stock_expected/data.xml
```

Фотографии — через существующий `onec-catalog-image-sync` из настроенного `CATALOG_IMAGE_SOURCE_DIR` (или FTP pilot CLI), **после** успешного catalog import.

CLI фиксирует SHA256 каждого файла и вычисляет `bundleFingerprint`. Между dry-run и apply файлы **не менять**.

---

## 2. Что очищается

| Область | Таблицы / действия |
|---------|-------------------|
| Клиенты и журналы | `onec_clients`, `onec_retail_outlets` (CASCADE), `onec_client_import_runs`, `onec_import_jobs`, quarantine/baseline journals |
| Ревизии | `client_review_records`, `client_review_history` (CASCADE) |
| Каталог | все `onec_catalog_*` версии + staging/quarantine; сброс `onec_catalog_state` |
| Фото-кэш каталога | `onec_catalog_image_*` |
| Дистрибуция (если migration 030 применена) | `outlet_distribution_markers`, events |
| Локальные права на удалённые GUID | `access_grants` (client), `access_denials` (client), `delegation_clients`, `bitrix24_client_card_objects` (client), cooldown |
| Exchange | сброс `onec_exchange_state` |

## 3. Что сохраняется

- `users`, `sessions`, пароль администратора
- команды, delegations (кроме `delegation_clients`), Bitrix24 задачи/журналы
- схема БД и учёт миграций
- файлы вне области очистки

---

## 4. Команды оператора

### 4.1 Подготовка

1. Резервная копия PostgreSQL контура РФ.
2. Скопировать актуальный комплект 1С в локальный каталог (не коммитить в Git).
3. Убедиться, что нет `pending/running` operator jobs и scheduled apply.

### 4.2 Dry-run (обязателен)

```bash
npm run build
npm run onec-clean-reload:local -- --dry-run \
  --bundle-dir /secure/onec-bundle-2026-10-04
```

Сохранить из JSON-ответа:
- `plan.targetDbFingerprint`
- `plan.bundleFingerprint`
- counts (clients, employees, products)

### 4.3 Apply

```bash
npm run onec-clean-reload:local -- --apply \
  --bundle-dir /secure/onec-bundle-2026-10-04 \
  --expected-bundle-fingerprint <plan.bundleFingerprint> \
  --confirm-target-db <plan.targetDbFingerprint> \
  --confirm-extended-contract \
  --operator-reference "TW-ticket-12345"
```

Опции:
- `--holding-link-policy=tolerant|strict` (default: tolerant)
- `--catalog-profile=full|distribution` (default: full)
- `--skip-image-sync` — если фото отдельным шагом
- `--skip-catalog` — только клиенты (не для полного старта)

### 4.4 Image sync (если не выполнен в apply)

```bash
npm run onec-catalog-image-sync:local -- --apply
```

### 4.5 Проверка

- вход admin
- `/api/clients?view=all` — актуальный состав
- карточка клиента → ТТ (`closed`, `guid_store`)
- каталог → товар → фото

---

## 5. Защиты

- `--confirm-target-db` — от apply на чужой БД
- `--expected-bundle-fingerprint` — от apply с изменёнными файлами
- advisory lock `902451004` + проверка client/catalog import locks
- pending `onec_import_jobs` помечаются superseded
- purge + clients import — одна транзакция; при ошибке до COMMIT данные не меняются
- catalog import после COMMIT clients; при сбое каталога клиенты уже загружены — восстановление из backup

---

## 6. Миграции

Дополнительных миграций **не требуется**. Нужны уже применённые миграции клиентов (`024`–`031`) и каталога (`020`–`023`), включая `030` дистрибуции если модуль развёрнут.
