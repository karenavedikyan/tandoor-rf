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
| `TANBOT_TELEGRAM_LINK_TOKEN_PEPPER` | HMAC start-token (≥16), не в git |
| `TANBOT_TELEGRAM_LINK_TOKEN_TTL_MINUTES` | 5–60, default 15 |
| `TANBOT_TELEGRAM_BOT_USERNAME` | Deep link `@TANDOOR_IBOT` |
| `APP_ORIGIN` | Ссылки в сообщениях и /start без payload |

Read-only CLI `tanbot-telegram-probe` **не** расширен на sendMessage.

## Миграция

`server/migrations/055_tanbot_telegram_stage2.sql` — link attempts, accounts, update dedup, outbox, audit.  
Откат: DROP таблиц в обратном порядке (только на test/stage DB).

## Сценарий сотрудника

1. ЛК → «Мой профиль» → «Подключить Telegram» → deep link.
2. Telegram `/start <token>` → вернуться в ЛК → «Подтвердить привязку» (виден @username).
3. При назначении передачи (handoff commit) → outbox → Telegram текст + ссылка `/tan-tracker`.
4. Отключение: ЛК или `/stop` в Telegram.

## Операторский запуск (без auto webhook)

1. Read-only: `npm run build && node dist/cli/tanbot-telegram-probe.js` (getMe/getWebhookInfo).
2. Задать `TANBOT_TELEGRAM_WEBHOOK_SECRET` на сервере.
3. **Отдельное** подтверждение: `setWebhook` на URL `…/api/tanbot-telegram/webhook` с secret (не выполняется агентом).
4. Включить `TANBOT_TELEGRAM_WEBHOOK_ENABLED` и `TANBOT_TELEGRAM_DELIVERY_ENABLED`.
5. Тест с одним сотрудником.

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
