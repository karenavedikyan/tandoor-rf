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

Существующие ключи **не перезаписывать**. Секреты задаёт только оператор в App Platform UI.

| Переменная | Обязательность | Назначение |
|------------|----------------|------------|
| `TT_ATTACHMENTS_BACKEND` | **production:** `postgres` | Хранение байт вложений в БД (переживает redeploy без volume). |
| `TT_OTP_PEPPER` | **production:** обязателен для SMS/handoff | Секрет ≥16 символов; **без default в коде**. |
| `TANBOT_TELEGRAM_ENABLED` | opt-in (`false` default) | Включение Telegram-бота. |
| `TANBOT_TELEGRAM_BOT_TOKEN` | при enabled | Токен бота (secret). |
| `TANBOT_TELEGRAM_WEBHOOK_SECRET` | при webhook | Secret path/header. |
| `TANBOT_TELEGRAM_OUTBOX_WORKER_ENABLED` | opt-in | In-process outbox tick на web dyno **или** отдельный worker job. |
| `TANBOT_MAX_ENABLED` | opt-in | MAX бот. |
| `TANBOT_MAX_BOT_TOKEN` | при enabled | Токен MAX (secret). |
| `TANBOT_MAX_OUTBOX_WORKER_ENABLED` | opt-in | Аналогично Telegram. |

Рекомендуется для App Platform: **отдельный scheduled/worker component** `node dist/cli/tanbot-telegram-outbox-worker.js --once` (и MAX аналог) с интервалом 1–2 мин, чтобы retry не терялись при рестарте web-процесса. In-process worker — допустим, если включён ровно один экземпляр.

### Запрещено / fail-closed

- `TT_USER_TEST_ENV=true` на production (guard сохранён).
- `TT_PHONE_VERIFICATION_PROVIDER=test` на production.
- `NODE_ENV=production` + `TT_ATTACHMENTS_BACKEND=filesystem` без явного `TT_ATTACHMENTS_ALLOW_EPHEMERAL_FS=true` (attachments guard).

## Durable attachments — ограничения

- Лимиты API не изменены: 10 MB/файл, 10 файлов/передача, 50 MB суммарно на передачу.
- Байты в `BYTEA`: рост ≈ сумма загруженных файлов минус явные delete. **Мониторинг:** `pg_database_size`, `pg_total_relation_size('tt_attachment_blobs')`, периодический отчёт; при необходимости — политика retention для `tt_staged_attachments` с `consumed_at` и orphan blobs (оператор, не в этом релизе).
- Учебный стенд: `TT_ATTACHMENTS_DIR` + backend `filesystem` (default при `TT_USER_TEST_ENV` / `NODE_ENV=test`).

## Проверки Cursor (sandbox)

| Команда | Результат |
|---------|-----------|
| `npm run typecheck` | PASS |
| `npm run build` | PASS |
| `npm test` | PASS (969 unit) |
| `test/integration/tan-tracker-durable-attachments.test.ts` | PASS |
| `test/integration/tan-tracker*.test.ts` + `tanbot-handoff-code-pilot.test.ts` | PASS |
| Browser UI на lk.tandoor.ru | NOT_RUN |

## Не выполнялось из Cursor

Merge, deploy, DNS, webhook registration, реальные SMS/Telegram/MAX сообщения, migrate на production, изменение существующих production env.
