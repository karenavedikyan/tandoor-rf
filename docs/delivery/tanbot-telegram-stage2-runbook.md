# Tanbot Telegram — stage2 (привязка + уведомления)

Задание: `TANBOT-TELEGRAM-STAGE2-20261029`  
Ветка: `cursor/tanbot-telegram-stage2-20261029`  
База: `cursor/tanbot-telegram-server-stage1-20261029` @ `adb8404`.

## Флаги (default off, кроме master enable)

| Env | Назначение |
|-----|------------|
| `TANBOT_TELEGRAM_ENABLED` | Master switch (как stage1) |
| `TANBOT_TELEGRAM_WEBHOOK_ENABLED` | Приём POST `/api/tanbot-telegram/webhook` |
| `TANBOT_TELEGRAM_WEBHOOK_SECRET` | Header `X-Telegram-Bot-Api-Secret-Token` (≥16) |
| `TANBOT_TELEGRAM_DELIVERY_ENABLED` | `sendMessage` (outbox + ответы webhook) |
| `TANBOT_TELEGRAM_OUTBOX_WORKER_ENABLED` | In-process outbox tick loop (**default off**) |
| `TANBOT_TELEGRAM_OUTBOX_INTERVAL_MS` | Интервал worker (≥5000 ms, default 15000) |
| `TANBOT_TELEGRAM_LINK_TOKEN_PEPPER` | HMAC start-token (≥16), не в git |
| `TANBOT_TELEGRAM_LINK_TOKEN_TTL_MINUTES` | 5–60, default 15 |
| `TANBOT_TELEGRAM_BOT_USERNAME` | Deep link `@TANDOOR_IBOT` |
| `APP_ORIGIN` | Ссылки в сообщениях и /start без payload |

Read-only CLI `tanbot-telegram-probe` **не** расширен на sendMessage.

## Миграция

`server/migrations/055_tanbot_telegram_stage2.sql` — link attempts, accounts, update dedup, outbox, audit.  
`056_tanbot_telegram_webhook_inbox.sql` — durable reply / retry state для webhook.  
Откат: DROP таблиц в обратном порядке (только на test/stage DB).

## Сценарий сотрудника

1. ЛК → «Мой профиль» → «Подключить Telegram» (согласие на коды/уведомления в подсказке) → deep link.
2. В Telegram нажать **Start** по персональной ссылке — привязка и уведомления завершаются **в боте**, без кнопки подтверждения в профиле. Вернуться в ЛК: статус обновится по focus/visibility.
3. Если popup заблокирован — скопировать персональную ссылку из профиля (не запрашивать новую при каждом возврате на страницу).
4. При назначении передачи (handoff commit) → outbox → Telegram текст + ссылка `/tan-tracker`.
5. Отключение: ЛК или `/stop` в Telegram.

## Операторский запуск (без auto webhook)

1. Read-only: `npm run build && node dist/cli/tanbot-telegram-probe.js` (getMe/getWebhookInfo).
2. Задать `TANBOT_TELEGRAM_WEBHOOK_SECRET` на сервере.
3. **Отдельное** подтверждение: `setWebhook` на URL `…/api/tanbot-telegram/webhook` с secret (не выполняется агентом).
4. Включить `TANBOT_TELEGRAM_WEBHOOK_ENABLED`, `TANBOT_TELEGRAM_DELIVERY_ENABLED`, при необходимости `TANBOT_TELEGRAM_OUTBOX_WORKER_ENABLED=true` (или cron `npm run tanbot-telegram-outbox-worker:local`).
5. Тест с одним сотрудником.

Однократная обработка outbox без HTTP-сервера: `npm run build && npm run tanbot-telegram-outbox-worker:local` (требует `DATABASE_URL`, delivery flag).

## Проверки Cursor

```bash
npm run typecheck && npm run build
node --import tsx --test test/unit/tanbot-telegram-update-parse.test.ts
TEST_DATABASE_URL=…/tandoor_rf_test node --import tsx --test test/integration/tanbot-telegram-stage2.test.ts
TANBOT_STAGE2_BROWSER_SMOKE=1 node --import tsx --test test/browser/tanbot-telegram-profile-link.browser.test.ts
```

## NOT_RUN / ограничения

- Live Telegram, real bot token, setWebhook на production — **NOT_RUN**.
- Exactly-once доставка Telegram не гарантируется при сетевом таймауте после sendMessage.
- MAX канал не реализован; outbox `channel` зарезервирован под расширение.
