# Runbook: замена клиентского состава 1С (tandoor-rf, этап 1)

**Назначение:** однократная явная процедура замены тестового состава **клиентов, торговых точек и справочника сотрудников ОПТ** актуальным комплектом файлов 1С.

**Не заменяет** регулярный импорт (`onec-clients-import`).

**Каталог и фотографии не изменяются.** Очищаются только **зависимые тестовые отметки дистрибуции** (`outlet_distribution_markers`, `outlet_distribution_marker_events`), привязанные к заменяемому клиентскому составу — это не импорт/изменение каталога.

**Следующие этапы** (каталог, фото) выполняются отдельно после приёмки этого этапа.

---

## 1. Комплект источников (bundle)

Каталог `--bundle-dir` должен содержать **ровно один снимок**, прочитанный до начала apply:

```
<bundle-dir>/
  all_clients.json
  all_employees.json
```

Требования clean reload (строже обычного импорта):
- каждая переданная ТТ имеет валидный `guid_store` и булево `closed`;
- roster: поля, приводимые к SQL (в т.ч. `date_of_assumption`), проходят проверку до очистки.

`all_employees.json` уже отфильтрован специалистом 1С по подразделению «Продажи ОПТ».

CLI фиксирует SHA256 каждого файла (ограниченное чтение, max 32 MiB) и вычисляет `bundleFingerprint` (`onec_rf_client_composition_reload_v1`). Между dry-run и apply файлы **не менять**.

---

## 2. Что очищается

| Область | Таблицы / действия |
|---------|-------------------|
| Локальные права и привязки | `access_grants` (client), `access_denials` (client), `delegation_clients`, `delegation_change_request_clients`, Bitrix card objects/cooldown, `outlet_distribution_marker_events` |
| Тестовые отметки дистрибуции (migration 030) | `outlet_distribution_markers` — только привязки к заменяемым клиентам/ТТ |
| Ревизии (если migration 031) | `client_review_records` |
| Клиенты и журналы | `onec_clients`, `onec_retail_outlets`, `onec_client_import_runs`, `onec_import_jobs`, quarantine/baseline journals |
| Справочник сотрудников | `onec_wholesale_employee_roster`, сброс `onec_wholesale_roster_state` |
| Связи user ↔ сотрудник | отзыв активных `user_onec_employee_links` для GUID вне нового roster |
| Exchange | сброс `onec_exchange_state` |

Очистка выполняется явным порядком DELETE без `TRUNCATE ... CASCADE`.

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
3. Убедиться, что migration `032` и более ранние client/catalog migrations применены.
4. Dry-run и apply **откажут**, если есть `pending/running` `onec_import_jobs` или running client import. Дождитесь завершения/истечения operator jobs перед clean reload.

### 4.2 Dry-run (обязателен)

```bash
npm run build
npm run onec-clean-reload:local -- --dry-run \
  --bundle-dir /secure/onec-bundle-2026-10-04
```

Сохранить из JSON-ответа:
- `plan.targetDbFingerprint`
- `plan.targetDb` (host/port/database — без пароля)
- `plan.bundleFingerprint`
- `plan.stats` (clients, open/closed TT, employees, outside-roster, unresolved holdings)
- `plan.schemaDependencies` и пустой `plan.blockers`

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

При `COMMIT_UNCERTAIN` не повторять apply вслепую — проверить фактическое состояние БД.

### 4.4 Проверка

- вход admin
- `GET /api/clients?view=all` — актуальный состав
- карточка клиента → вложенные ТТ (`closed`, `guid_store`)
- `GET /api/clients/wholesale-employees` — полный roster, включая сотрудников без клиентов
- каталог и фото **не изменились** (сравнить active version / product count / image assets до и после)

---

## 5. Защиты

- `--confirm-target-db` — от apply на чужой БД
- `--expected-bundle-fingerprint` — от apply с изменёнными файлами
- preflight schema (`MIGRATIONS_NOT_READY` без migration 032)
- advisory lock `902451004` + client import lock
- dry-run и apply: pending/running `onec_import_jobs` и running client import блокируют процедуру до очистки
- worker import job: после чтения FTP и **перед** apply повторно проверяет, что job всё ещё `running`; удалённый/superseded job не выполняет apply
- clean reload apply: advisory lock `902451004` + client import lock, повторная проверка jobs под locks непосредственно перед BEGIN
- purge + clients import + roster — **одна транзакция**; при ошибке до COMMIT прежний состав остаётся целым
- пустой roster и анонимные ТТ блокируют процедуру до очистки

---

## 6. Миграции

Требуется migration `032_onec_wholesale_employee_roster.sql` (таблицы `onec_wholesale_employee_roster`, `onec_wholesale_roster_state`).

Также нужны миграции клиентов (`024`–`030`) и каталога (`020`–`023`) — каталог не изменяется, но должен быть развёрнут.

Apply **не запускает** migrations автоматически.

---

## 7. Live-загрузка

Актуальные файлы 1С в среде разработки могут отсутствовать. В этом случае процедура проверена на синтетических данных в integration/browser тестах; production-import и deploy **не выполняются** этим runbook.
