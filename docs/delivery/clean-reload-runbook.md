# Runbook: замена клиентского состава 1С (tandoor-rf, этап 1)

**Назначение:** однократная явная процедура замены тестового состава **клиентов, торговых точек и справочника сотрудников ОПТ** актуальным комплектом файлов 1С.

**Не заменяет** регулярный импорт (`onec-clients-import`) и **не** затрагивает каталог, фотографии и дистрибуцию.

**Следующие этапы** (каталог, фото) выполняются отдельно после приёмки этого этапа.

---

## 1. Комплект источников (bundle)

Каталог `--bundle-dir` должен содержать **ровно один снимок**, прочитанный до начала apply:

```
<bundle-dir>/
  all_clients.json
  all_employees.json
```

`all_employees.json` уже отфильтрован специалистом 1С по подразделению «Продажи ОПТ».

CLI фиксирует SHA256 каждого файла и вычисляет `bundleFingerprint` (`onec_rf_client_composition_reload_v1`). Между dry-run и apply файлы **не менять**.

---

## 2. Что очищается

| Область | Таблицы / действия |
|---------|-------------------|
| Локальные права и привязки | `access_grants` (client), `access_denials` (client), `delegation_clients`, `delegation_change_request_clients`, Bitrix card objects/cooldown, `outlet_distribution_marker_events` |
| Дистрибуция (если migration 030) | `outlet_distribution_markers` |
| Ревизии (если migration 031) | `client_review_records` |
| Клиенты и журналы | `onec_clients`, `onec_retail_outlets` (CASCADE), `onec_client_import_runs`, `onec_import_jobs`, quarantine/baseline journals |
| Справочник сотрудников | `onec_wholesale_employee_roster`, сброс `onec_wholesale_roster_state` |
| Связи user ↔ сотрудник | отзыв активных `user_onec_employee_links` для GUID вне нового roster |
| Exchange | сброс `onec_exchange_state` |

## 3. Что сохраняется

- `users`, `sessions`, пароль и вход администратора
- **каталог целиком:** `onec_catalog_*`, `onec_catalog_image_*`, `onec_catalog_state`
- команды, delegations (кроме `delegation_clients`), Bitrix24 задачи/журналы
- схема БD, миграции, настройки и секреты
- проверенные `user_onec_employee_links` для GUID, присутствующих в новом roster

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
- `plan.stats` (clients, open/closed TT, employees, outside-roster, unresolved holdings)

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

### 4.4 Проверка

- вход admin
- `GET /api/clients?view=all` — актуальный состав
- карточка клиента → вложенные ТТ (`closed`, `guid_store`)
- `GET /api/clients/wholesale-employees` — полный roster, включая сотрудников без клиентов
- каталог и фото **не изменились** (сравнить active version / product count до и после)

---

## 5. Защиты

- `--confirm-target-db` — от apply на чужой БД
- `--expected-bundle-fingerprint` — от apply с изменёнными файлами
- advisory lock `902451004` + client import lock
- pending `onec_import_jobs` помечаются superseded
- purge + clients import + roster — **одна транзакция** на одном `PoolClient`; при ошибке до COMMIT прежний состав остаётся целым
- пустой roster блокирует процедуру до очистки
- обычный импорт не ослаблен; `cleanReloadApply` доступен только этой процедуре

---

## 6. Миграции

Требуется migration `032_onec_wholesale_employee_roster.sql` (таблицы `onec_wholesale_employee_roster`, `onec_wholesale_roster_state`).

Также нужны миграции клиентов (`024`–`030`) и каталога (`020`–`023`) — каталог не изменяется, но должен быть развёрнут.

---

## 7. Live-загрузка

Актуальные файлы 1С в среде разработки могут отсутствовать. В этом случае процедура проверена на синтетических данных в integration/browser тестах; production-import и deploy **не выполняются** этим runbook.
