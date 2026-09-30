# Runbook: подключение и отключение Bitrix24 (R2.1)

**Этап:** R2.1 · диагностика и серверный модуль  
**Production:** **не включать** без отдельного согласования

## 1. Что делает этот этап

- Проверяет конфигурацию incoming webhook **локально** (без сети).
- По явному запросу оператора читает **ограниченную** выборку задач **конкретного** Bitrix user ID.
- **Не сохраняет** задачи в БД, **не меняет** права, **не запускается** из web-сервера, login, health/readiness или cron.

## 2. Что нужно от администратора Bitrix24

1. Создать **incoming webhook** с scopes для [user.get](https://apidocs.bitrix24.com/api-reference/user/user-get.html) (`user` / `user_brief`) и [tasks.task.list](https://apidocs.bitrix24.com/api-reference/tasks/tasks-task-list.html) (`task`).
2. Зафиксировать **Bitrix user ID** сотрудника, для которого выполняется диагностика (не ID владельца webhook по умолчанию).
3. Передать webhook URL **только** через защищённое хранилище секретов или серверное окружение Timeweb — **не** в Git, PR, чат или `.env` в репозитории.

## 3. Переменные окружения

См. `.env.example`. Минимум для live-диагностики:

```bash
BITRIX24_ENABLED=true
BITRIX24_WEBHOOK_URL=https://<portal>.bitrix24.ru/rest/<user_id>/<webhook_token>/
# опционально:
# BITRIX24_PORTAL_HOST=<portal>.bitrix24.ru
```

## 4. Локальная разработка (файл `.env`)

```bash
npm run build
npm run bitrix24-probe:local
```

Live-диагностика локально:

```bash
npm run bitrix24-probe:local -- --live --bitrix-user-id <BITRIX_USER_ID>
```

Команды `*:local` читают `.env` через `--env-file`. Это **не** универсальная production-команда.

## 5. Серверное окружение Timeweb (env уже задан платформой)

```bash
npm run build
node dist/cli/bitrix24-probe.js
node dist/cli/bitrix24-probe.js --live --bitrix-user-id <BITRIX_USER_ID>
```

**Блокер:** интерактивная SSH/консоль на текущем размещении TW для операторского запуска **не подтверждена** этим PR. Фактически доступный способ one-off job / console уточняется у платформенного оператора. HTTP-endpoint или автозапуск при старте приложения **не добавляются** как обход.

## 6. Отчёт CLI

Содержит: `checkedAt` (ISO UTC), `portalId`, список проверок, число задач, полноту выборки, коды ошибок, недоступные возможности.

**Не содержит:** тексты задач, ФИО, email, телефоны, webhook token, произвольные `error_description` портала.

## 7. Отключение

1. Установить `BITRIX24_ENABLED=false` или удалить `BITRIX24_WEBHOOK_URL` из env.
2. При компрометации webhook — **отозвать** webhook в Bitrix24 и выпустить новый.
3. Перезапуск приложения **не обязателен** для отключения CLI; web-приложение не использует Bitrix24 в R2.1.

## 8. Интерпретация статусов

| Статус | Действие |
|--------|----------|
| `DISABLED` | Интеграция выключена — штатно для dev/test |
| `LOCAL_OK` | Конфигурация валидна; live-проверка не запускалась |
| `SUCCESS` | Live-выборка задач получена полностью в пределах лимитов |
| `PARTIAL` | Выборка обрезана лимитами — не считать полной синхронизацией |
| `AUTH_FAILED` / `FORBIDDEN` | Проверить webhook, scopes, user ID |
| `INVALID_USER` | Указанный Bitrix user ID не найден |
| `RATE_LIMITED` | Повторить позже; проверить лимиты портала |

## 9. Что runbook не делает

- Не включает production-синхронизацию задач
- Не создаёт соответствия сотрудников
- Не привязывает задачи к клиентам
- Не меняет импорт 1С и расписание

**Проверка на реальном портале не выполнена** в рамках CI и автотестов этого PR.
