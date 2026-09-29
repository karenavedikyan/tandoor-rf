# Контракт интеграции Битrix24 (R2.1)

**Этап:** R2.1 · серверный модуль чтения + диагностика  
**Дата:** 2026-09-29  
**Production-портал:** **не проверялся** в этом PR

## 1. Назначение и границы

- Битrix24 остаётся **источником задач**; ЛК не становится второй CRM.
- Этот PR добавляет **только** серверный модуль чтения и одноразовую CLI-диагностику.
- **Не реализовано:** UI «Моя работа», кэш задач, журнал синхронизации, запись в Битrix24, OAuth, чек-листы, вложения, комментарии, чаты, рекламации.
- **Не изменялись:** импорт 1С, расписание, клиентские данные, связи сотрудников 1С, права доступа.

## 2. Справочный материал старого ЛК

| Источник | Статус |
|----------|--------|
| `docs/bitrix24-poc.md` в старом репозитории | **не доступен** в `tandoor-rf`; разработка не блокируется |
| `apps/platform/server/bitrix24-*-execute.ts` | изучался как справочник; **не копировался** целиком |

**Переиспользовано по идее:** incoming webhook, чтение задач по `RESPONSIBLE_ID`, минимальный набор полей, отказ от универсального REST-прокси.

**Отвергнуто:** зависимость от `tandoor-platform`, localStorage, хардкод сотрудников, универсальный REST-прокси, fallback на владельца webhook, автосвязь задач с клиентом по ФИО/адресу/телефону.

## 3. Раздельные идентичности

| ID | Сущность | Взаимозаменяемость |
|----|----------|--------------------|
| `users.id` | пользователь ЛК | **не равен** ID сотрудника 1С или Bitrix24 |
| `user_onec_employee_links.guid_employee` | сотрудник 1С | подтверждается администратором; **не равен** Bitrix user ID |
| Bitrix `user.ID` | пользователь Bitrix24 | подтверждается отдельно; **не выводится** из ФИО |

Будущие **подтверждённые** соответствия (`lk_user_id` ↔ `onec_employee_guid` ↔ `bitrix_user_id`) — отдельная таблица/процесс в R2.2+, не в этом PR.

## 4. Подключение (incoming webhook)

| Переменная | Назначение |
|------------|------------|
| `BITRIX24_ENABLED` | `false` по умолчанию |
| `BITRIX24_WEBHOOK_URL` | `https://<portal>/rest/<user_id>/<webhook_token>/` — **только серверное окружение** |
| `BITRIX24_PORTAL_HOST` | опциональная фиксация портала; должна совпадать с URL |
| `BITRIX24_REQUEST_TIMEOUT_MS` | таймаут одного запроса |
| `BITRIX24_MAX_RESPONSE_BYTES` | предел размера ответа |
| `BITRIX24_MAX_PAGES` | предел страниц пагинации |
| `BITRIX24_MAX_TOTAL_DURATION_MS` | общий предел длительности чтения |

OAuth — **архитектурно отделён**, не реализован.

## 5. Разрешённые REST-методы

Только фиксированный whitelist в коде:

| Метод | Документация | Назначение в R2.1 |
|-------|--------------|-------------------|
| `user.get` | [user.get](https://apidocs.bitrix24.com/api-reference/user/user-get.html) | проверка существования выбранного Bitrix user ID |
| `tasks.task.list` | [tasks.task.list](https://apidocs.bitrix24.com/api-reference/tasks/tasks-task-list.html) | чтение задач **явно выбранного** `RESPONSIBLE_ID` |

Произвольный URL/метод **запрещён**. Redirect **не следуются**. TLS-проверка **не отключается**.

### Проверенные предположения (без live-портала)

- Webhook URL: `https://<portal>/rest/<user_id>/<token>/<method>`
- `tasks.task.list`: POST JSON, pagination через `start` (шаг 50), поля в `select`, фильтр `RESPONSIBLE_ID`
- `REAL_STATUS` / `STATUS`: числовые коды 2–6 — см. §6
- Ответ может содержать `error` при HTTP 200

**Не подтверждено без live-портала:** фактические scopes webhook, лимиты портала, полный набор полей конкретного портала.

## 6. Минимальная нормализация задачи

| Поле Bitrix | Поле модуля | Примечание |
|-------------|-------------|------------|
| `ID` | `taskId` | dedupe key: `portalHost:taskId` |
| `TITLE` | `title` | **не попадает** в CLI-отчёт диагностики |
| `REAL_STATUS` / `STATUS` | `statusRaw`, `statusLabel` | неизвестный код → `unknown`, без угадывания |
| `RESPONSIBLE_ID` | `responsibleId` | |
| `CREATED_BY` | `createdById` | |
| `DEADLINE` | `deadline` | сохраняется исходная строка с TZ |
| `CHANGED_DATE` | `changedAt` | |

### Коды `REAL_STATUS` (официальная документация)

| Код | `statusLabel` |
|-----|---------------|
| 2 | `waiting` |
| 3 | `in_progress` |
| 4 | `awaiting_control` |
| 5 | `completed` |
| 6 | `deferred` |
| иное | `unknown` |

Завершённые задачи (`completed`) **не отфильтровываются** — нужны для будущего обновления статусов.

Неполная выборка (`MAX_PAGES`, `MAX_DURATION`, duplicate cursor) → `complete: false`.

## 7. Будущая привязка задачи к объекту клиента (R2.2+, не реализовано)

- Связь только по **подтверждённому ID объекта** и **типу объекта** (клиент / юрлицо / ТТ — когда появятся в 1С).
- **`guid_client` не использовать** как универсальный ID всех уровней.
- **Запрещено:** автосвязь по ФИО, названию, адресу, телефону.
- Предлагаемый черновик формата (не записывается в Bitrix24 в R2.1):

```json
{
  "lkClientGuid": "uuid",
  "objectType": "client|legal_entity|outlet",
  "objectGuid": "uuid-or-confirmed-external-id",
  "bindingStatus": "confirmed|pending|unresolved"
}
```

## 8. Будущие права на содержимое задач

- Доступ к клиенту в ЛК **не означает** доступ ко всему содержимому задач Bitrix24.
- Перед показом задачи в UI R2.2+ сервер проверит: аудиторию задачи, объект клиента, роль, срок замещения.
- Технический webhook **не расширяет** права сотрудника в Bitrix24.

## 9. R2.2 — следующий шаг (не в этом PR)

1. Серверный кэш задач и журнал синхронизации
2. Подтверждённые соответствия сотрудников
3. Отзыв видимости и актуальность данных
4. UI «Моя работа» и блок задач в карточке клиента

## 10. Модуль в коде

| Путь | Назначение |
|------|------------|
| `src/bitrix24/config.ts` | env + webhook parse |
| `src/bitrix24/url-security.ts` | SSRF/DNS guards |
| `src/bitrix24/transport.ts` | injectable HTTP, retries, limits |
| `src/bitrix24/read-users.ts` | `user.get` |
| `src/bitrix24/read-tasks.ts` | `tasks.task.list` + pagination |
| `src/bitrix24/probe.ts` | CLI diagnostics |
| `src/cli/bitrix24-probe.ts` | operator entrypoint |
