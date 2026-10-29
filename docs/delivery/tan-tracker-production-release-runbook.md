# Tan-Tracker + Tanbot production release (operator)

Кодовая ветка: `cursor/tan-tracker-production-release-20261029`. **Не применять миграции к живой БД из Cursor** — только оператор после backup.

## Diff относительно production `main`

- Tan-Tracker tt56 (bootstrap, mutations, public flows, **completed badge fix**).
- Tanbot Telegram stage2 + MAX stage1 (webhook inbox, outbox worker CLI, канонический код приёма).
- **Durable attachments:** `TT_ATTACHMENTS_BACKEND=postgres` + миграция `059_tt_attachment_blobs.sql`.
- npm audit: `body-parser@1.20.9`, `qs@6.16.2` (0 high/moderate в `npm audit --omit=dev` после fix).

## Pending migrations (порядок)

Уже на production до Tan-Tracker: `001`–`051` (проверить фактический `schema_migrations` на стенде).

Новые для этого релиза (additive):

| # | Файл |
|---|------|
| 052 | `052_tan_tracker.sql` |
| 053 | `053_tan_tracker_handoff_attempts.sql` |
| 054 | `054_tan_tracker_staged_attachments.sql` |
| 055 | `055_tanbot_telegram_stage2.sql` |
| 056 | `056_tanbot_telegram_webhook_inbox.sql` |
| 057 | `057_tanbot_max_stage1.sql` |
| 058 | `058_tanbot_webhook_reply_extra.sql` |
| **059** | **`059_tt_attachment_blobs.sql`** |

Старый runtime на `main` после migrate-only шага **не должен** падать: новые таблицы не используются до деплоя кода с Tan-Tracker.

## Rollout (оператор)

1. **Backup** PostgreSQL (полный snapshot / pg_dump).
2. **Migrate:** `npm run migrate` (или App Platform job) на staging, затем production.
3. **Deploy** артеfact с новой ветки/SHA.
4. **Readonly smoke:** `/health`, login LK, Tan-Tracker bootstrap, список передач (без создания клиентских данных).
5. **Rollback plan:** откат deploy на предыдущий SHA; таблицы 052–059 остаются (additive). Файлы в `tt_attachment_blobs` не мешают старому коду. При полном откате схемы — только отдельное решение оператора (не автоматизировано).

## Новые / обязательные переменные окружения

Существующие ключи **не перезаписывать**. Значения `hidden-by-api-key-policy` из API **не** подставлять в DATABASE_URL или секреты. Добавлять только новые ключи вручную в UI, пока не подтверждена аддитивная семантика API.

### Tan-Tracker / attachments

| Переменная | Secret | Default | Когда нужна |
|------------|--------|---------|-------------|
| `TT_ATTACHMENTS_BACKEND` | no | `postgres` в production | **Обязательно** `postgres` на App Platform. |
| `TT_OTP_PEPPER` | **yes** | нет | Handoff/SMS hashing в production (≥16 символов). |
| `TT_ATTACHMENTS_ALLOW_EPHEMERAL_FS` | no | off | Только отладка; не для lk.tandoor.ru. |

### Telegram-only rollout (MAX выключен)

**Порядок:** migrate → deploy → readonly smoke → `getMe` / `getWebhookInfo` (read-only) → при необходимости `setWebhook` (без `drop_pending_updates`) → включить флаги по таблице снизу → проверить in-process worker на **единственном** web-экземпляре.

| Переменная | Secret | Default | Порядок / требование |
|------------|--------|---------|----------------------|
| `TANBOT_TELEGRAM_ENABLED` | no | off | **1.** Master switch. |
| `TANBOT_TELEGRAM_BOT_TOKEN` | **yes** | — | **2.** При enabled. |
| `TANBOT_TELEGRAM_LINK_TOKEN_PEPPER` | **yes** | — | **3.** ≥16 символов при enabled (`stage2-config`). |
| `APP_ORIGIN` | no | — | Уже на стенде; нужен для deep-link привязки. |
| `TANBOT_TELEGRAM_EXPECTED_USERNAME` | no | `TANDOOR_IBOT` | Username sanity check. |
| `TANBOT_TELEGRAM_BOT_USERNAME` | no | = expected | Опционально override отображения. |
| `TANBOT_TELEGRAM_LINK_TOKEN_TTL_MINUTES` | no | `15` | 5–60. |
| `TANBOT_TELEGRAM_WEBHOOK_ENABLED` | no | off | **4.** После согласования URL. |
| `TANBOT_TELEGRAM_WEBHOOK_SECRET` | **yes** | — | ≥16 символов при webhook enabled. |
| `TANBOT_TELEGRAM_DELIVERY_ENABLED` | no | off | **5.** Исходящая доставка outbox/webhook-reply. |
| `TANBOT_TELEGRAM_OUTBOX_WORKER_ENABLED` | no | off | **6.** In-process worker (один dyno) или CLI worker. |
| `TANBOT_TELEGRAM_OUTBOX_INTERVAL_MS` | no | `15000` | Tick in-process worker. |
| `TANBOT_HANDOFF_CODE_PILOT_ENABLED` | no | off | **7.** Канонический код в боте; только после opt-in привязки пользователя в LK, не legacy/test SMS. |
| `TANBOT_TELEGRAM_REQUEST_TIMEOUT_MS` | no | `15000` | 1000–60000. |
| `TANBOT_TELEGRAM_MAX_RESPONSE_BYTES` | no | `65536` | 4096–262144. |

Webhook URL (production): `https://lk.tandoor.ru/api/tanbot-telegram/webhook` (secret token в заголовке/path по текущей реализации router).

**MAX (сейчас off):** не задавать / явно `false`: `TANBOT_MAX_ENABLED`, `TANBOT_MAX_*`, webhook, delivery, outbox worker.

**Runtime:** после listen запускаются **две независимые** цепочки — 1C/Bitrix (`runOneCBackgroundIntegrationStartup`) и Tanbot (`runTanbotBackgroundIntegrationStartup`). Сбой или зависание 1C **не блокирует** старт Telegram outbox worker.

**Webhook hygiene (оператор):** перед `setWebhook` — `getMe`, `getWebhookInfo`; не заменять чужой активный webhook без отдельного согласования; не использовать `drop_pending_updates`; без массовых сообщений.

### Запрещено / fail-closed

- `TT_USER_TEST_ENV=true` на production (guard сохранён).
- `TT_PHONE_VERIFICATION_PROVIDER=test` на production.
- `NODE_ENV=production` + `TT_ATTACHMENTS_BACKEND=filesystem` без явного `TT_ATTACHMENTS_ALLOW_EPHEMERAL_FS=true` (attachments guard).

## Durable attachments — ограничения

- Лимиты API не изменены: 10 MB/файл, 10 файлов/передача, 50 MB суммарно на передачу.
- Прикрепление и delete сериализуются по строке `tt_transfers` (`FOR UPDATE`): holder/completed и count/bytes проверяются в той же транзакции, что и link/delete.
- Байты в `BYTEA`: рост ≈ сумма загруженных файлов минус явные delete. **Мониторинг:** `pg_database_size`, `pg_total_relation_size('tt_attachment_blobs')`, периодический отчёт; при необходимости — политика retention для `tt_staged_attachments` с `consumed_at` и orphan blobs (оператор, не в этом релизе).
- Учебный стенд: `TT_ATTACHMENTS_DIR` + backend `filesystem` (default при `TT_USER_TEST_ENV` / `NODE_ENV=test`).

## Проверки Cursor (sandbox, follow-up SHA)

| Команда | Результат |
|---------|-----------|
| `npm run typecheck` | см. отчёт SHA |
| `npm run build` | см. отчёт SHA |
| `npm test` | см. отчёт SHA |
| `npm audit --omit=dev` | см. отчёт SHA |
| `test/integration/tan-tracker-attachment-delete-postgres.test.ts` | metadata+blob delete, rollback, ACL, subprocess read |
| `test/integration/tan-tracker-attachment-add-concurrency.test.ts` | concurrent add vs completed, file/byte limits, staged rollback |
| `npm run verify:production-omit-dev-startup` | isolated `npm ci --omit=dev` + `node dist/server.js` health (runtime deps, incl. `undici`) |
| `test/unit/server-background-integrations.test.ts` | independent 1C/Tanbot chains |
| Browser UI на lk.tandoor.ru | NOT_RUN |

## Не выполнялось из Cursor

Merge, deploy, DNS, webhook registration, реальные SMS/Telegram/MAX сообщения, migrate на production, изменение существующих production env.
