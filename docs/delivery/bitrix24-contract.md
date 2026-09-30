# Контракт интеграции Bitrix24 (R2.1 + R2.2)

**Этап:** R2.1 (чтение) + R2.2 (метки и локальный кэш задач)  
**Дата:** 2026-09-30  
**Production-портал:** **не проверялся** в этом PR

## 1. Назначение и границы

- Битrix24 остаётся **источником задач**; ЛК не становится второй CRM.
- R2.1: серверный модуль чтения и CLI-диагностика.
- R2.2: реестр меток, парсер описания, локальный кэш задач, ручная CLI-синхронизация, блок «Работа» в карточке клиента.
- **Не реализовано:** запись в Bitrix24, OAuth, чек-листы, вложения, комментарии, чаты, рекламации, фоновая/расписание синхронизация, production-публикация кэша.
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
| `user_onec_employee_links.employee_id` | сотрудник 1С | подтверждается администратором; **не равен** Bitrix user ID |
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

**Scopes по официальной документации (требуют подтверждения на портале):**

| Метод | Минимальный scope webhook |
|-------|-------------------------|
| `user.get` | `user`, `user_basic` или `user_brief` |
| `tasks.task.list` | `task` |

**Не подтверждено без live-портала:** фактические scopes конкретного webhook, лимиты портала, полный набор полей.

### Транспорт и SSRF (R2.1)

- Разрешается только `https://<portal>/rest/...` на **стандартном порту 443**.
- Перед запросом разрешаются **все** A/AAAA; при любом private/service адресе запрос отклоняется.
- Соединение выполняется на **проверенный pinned IP** с сохранением TLS SNI/hostname; повторный DNS lookup при connect не используется.
- Redirect не следуются.
- Политика IP: loopback, unspecified, private, link-local, unique-local, multicast, reserved, CGNAT и IPv4-mapped формы блокируются через `ipaddr.js` с нормализацией эквивалентных IPv6 записей.

## 6. Минимальная нормализация задачи

| Поле Bitrix | Поле модуля | Примечание |
|-------------|-------------|------------|
| `ID` | `taskId` | **обязательно**; dedupe key: `portalHost:taskId` |
| `TITLE` | `title` | **обязательно** (непустая строка); **не попадает** в CLI-отчёт диагностики |
| `REAL_STATUS` / `STATUS` | `statusRaw`, `statusLabel` | **хотя бы одно поле с допустимым типом** (`string`/`number`); `REAL_STATUS`/`realStatus` приоритетнее `STATUS`/`status`; `null` в приоритетном поле → fallback; boolean/object/array → запись отклоняется; повреждённый `REAL_STATUS` не маскируется валидным `STATUS`; неизвестный код → `unknown` |
| `RESPONSIBLE_ID` | `responsibleId` | **обязательно** |
| `CREATED_BY` | `createdById` | **обязательно** |
| `DEADLINE` | `deadline` | **опционально**; сохраняется исходная строка с TZ, если указана |
| `CHANGED_DATE` | `changedAt` | **обязательно**; ISO `YYYY-MM-DDTHH:mm:ss` с TZ (`Z` или `±HH:MM`, часы 00–14, минуты 00–59) или без TZ; невозможные даты и смещения вроде `+99:99` отклоняются |
| `DESCRIPTION` | `description` | **опционально**; используется R2.2 для извлечения метки; не попадает в UI карточки |

Запись без обязательных полей отклоняется (`rejectedTaskCount++`), не нормализуется пустыми значениями. `fields_checked` в probe означает проверку обязательных полей на **реальных** валидных строках выборки.

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

### Правила полноты выборки

| Условие | `complete` | Примечание |
|---------|------------|------------|
| Все страницы прочитаны, `next` отсутствует, нет truncation | `true` | успех **ограниченной** выборки сотрудника, не всего портала |
| `MAX_PAGES`, `MAX_DURATION`, duplicate/invalid cursor | `false` | `truncatedReason` обязателен |
| Пустая страница при `next` | `false` | `EMPTY_PAGE_WITH_NEXT` |
| Невалидная структура `result/tasks` | ошибка | не трактуется как пустой список |
| Часть записей отклонена валидатором | `false` | `rejectedTaskCount` > 0; probe → `PARTIAL` |
| `total` не совпадает с фактическим числом записей | `false` | `TOTAL_MISMATCH` |

Успешное чтение выбранного сотрудника **не означает** полноту данных всего портала Bitrix24.

## 7. Метки клиентов (R2.2)

Полный регламент: `docs/delivery/bitrix24-labels-regulation.md`.

| Тип | Формат | Пример |
|-----|--------|--------|
| Холдинг | `#LK_H_NNNNNN` | `#LK_H_000123` |
| Юрлицо | `#LK_J_NNNNNN` | `#LK_J_000456` |
| Торговая точка | `#LK_T_NNNNNN` | `#LK_T_000789` |

- Метку выдаёт сервер ЛК; GET **не создаёт** метки.
- Связь только по **подтверждённому ID объекта** и типу; `guid_client` **не** универсальный ID всех уровней.
- **Запрещено:** автосвязь по ФИО, названию, адресу, телефону.
- Метка читается **только** из `DESCRIPTION`; HTML/BBCode не исполняются.

### Таблицы (migration `010`)

| Таблица | Назначение |
|---------|------------|
| `bitrix24_label_sequences` | конкурентно-безопасная выдача кодов |
| `bitrix24_confirmed_objects` | подтверждённые объекты 1С |
| `bitrix24_object_labels` | реестр меток |
| `bitrix24_employee_portal_links` | связь user ЛК ↔ Bitrix user ID |
| `bitrix24_task_cache` | минимальный кэш задач |
| `bitrix24_task_bindings` | привязка task → объект |
| `bitrix24_sync_journal` | журнал ручных синхронизаций |

## 8. Права на содержимое задач (R2.2)

- Доступ к клиенту в ЛК **не означает** доступ ко всему содержимому задач Bitrix24.
- Перед показом: объект ЛК, связь сотрудника с порталом, аудитория задачи, TTL доступа.
- Технический webhook **не расширяет** права сотрудника.
- Кэш по умолчанию **не опубликован** (`BITRIX24_CACHE_PUBLISH_ENABLED=false`).

### Переменные R2.2

| Переменная | По умолчанию | Назначение |
|------------|--------------|------------|
| `BITRIX24_CACHE_PUBLISH_ENABLED` | `false` | публикация кэша в UI |
| `BITRIX24_CACHE_ACCESS_TTL_MS` | `0` | TTL подтверждения доступа |
| `BITRIX24_PILOT_TASK_IDS` | пусто | whitelist task ID для пилота |
| `BITRIX24_PORTAL_PUBLIC_URL` | пусто | база ссылки «Открыть в Bitrix24» |

## 9. API карточки клиента (R2.2)

| Метод | Путь | CSRF |
|-------|------|------|
| GET | `/api/clients/:guid/bitrix24/label` | — |
| POST | `/api/clients/:guid/bitrix24/label` | да |
| GET | `/api/clients/:guid/bitrix24/tasks` | — |

## 10. Модуль в коде

| Путь | Назначение |
|------|------------|
| `src/bitrix24/config.ts` | env + webhook parse |
| `src/bitrix24/url-security.ts` | SSRF/DNS guards |
| `src/bitrix24/transport.ts` | injectable HTTP, retries, limits |
| `src/bitrix24/read-users.ts` | `user.get` |
| `src/bitrix24/read-tasks.ts` | `tasks.task.list` + pagination |
| `src/bitrix24/probe.ts` | CLI diagnostics |
| `src/bitrix24/labels/*` | format, parser, registry, issuance |
| `src/bitrix24/tasks/*` | cache, bindings, access |
| `src/bitrix24/sync/run-sync.ts` | dry-run/apply sync |
| `src/clients/bitrix24-handlers.ts` | API handlers |
| `src/cli/bitrix24-probe.ts` | operator entrypoint |
| `src/cli/bitrix24-sync.ts` | manual sync entrypoint |
| `public/client-bitrix24.js` | блок «Работа» в карточке |
