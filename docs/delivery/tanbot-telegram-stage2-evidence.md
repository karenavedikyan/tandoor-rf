# Tanbot Telegram stage2 — evidence (fixes a1ad38f)

Ветка: `cursor/tanbot-telegram-stage2-20261029` (см. актуальный SHA в push).

## Исправленные блокеры

| Блокер | Решение |
|--------|---------|
| Нет штатного outbox worker | `TANBOT_TELEGRAM_OUTBOX_WORKER_ENABLED` + loop в `startServer`, CLI `npm run tanbot-telegram-outbox-worker` (`--once`) |
| Гонка confirm / смена владельца | advisory lock + `ON CONFLICT … WHERE user_id = EXCLUDED.user_id`, пустой RETURNING → 409 |
| Dedup до commit / потеря update | inbox columns migration 056, business+dedup в одной транзакции, status failed→retry |
| Потеря ответа webhook | reply persisted, `reply_delivered_at`, resend on duplicate update |
| Delivery disabled user | `canDeliverAssignmentNotification` (status, holder, handoff version) |
| Link start при master off | 503 на `/link/start` |
| Возврат из Telegram без reload | `focus`/`visibilitychange` → refresh в `profile.js` |
| Auto notifications on confirm | checkbox `#tanbot-confirm-notifications`, default off |
| Unit probe public bundle | проверка секретов по паттернам, не по DOM id |

## Прогоны (sandbox)

| Команда | Результат |
|---------|-----------|
| `npm run typecheck` | PASS |
| `npm run build` | PASS |
| `test/unit/tanbot-telegram*.test.ts` | 39 PASS |
| `tanbot-telegram-stage2.test.ts` + controls | 10 PASS |
| `test/integration/tan-tracker*.test.ts` | 20 PASS |
| Browser smoke | NOT_RUN (опционально `TANBOT_STAGE2_BROWSER_SMOKE=1`) |

## Ограничения

- @TANDOOR_IBOT не подключён; live Telegram NOT_RUN.
- При network timeout после sendMessage исход доставки неопределён (at-least-once / retry outbox).
