# Tanbot stage2 — прогоны (sandbox)

## Команды

```bash
npm run typecheck   # exit 0
npm run build       # exit 0
node --import tsx --test test/unit/tanbot-telegram-update-parse.test.ts  # 2/2
node --import tsx --test test/unit/tanbot-telegram-security.test.ts test/unit/tanbot-telegram-transport.test.ts  # 19/19
TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/tandoor_rf_test \
  node --import tsx --test test/integration/tanbot-telegram-stage2.test.ts  # 5/5
TANBOT_STAGE2_BROWSER_SMOKE=1 TEST_DATABASE_URL=… \
  node --import tsx --test test/browser/tanbot-telegram-profile-link.browser.test.ts  # 1/1
```

## Матрица требований

| Требование | Статус |
|------------|--------|
| LK link start/confirm/disconnect UI | PASS (browser + integration) |
| Start token hash, TTL, one-time | PASS (integration) |
| Webhook secret / forged secret | PASS |
| Duplicate update_id | PASS (dedup) |
| Group chat update | PASS (unit parse) |
| Outbox on handoff commit + idempotent send | PASS |
| Delivery disabled flags | PASS (default off in tests) |
| Preview write block on link routes | PASS (blockPreviewWrites) |
| Live Telegram / setWebhook | NOT_RUN |
| 429/403/timeout retry matrix | PARTIAL (outbox worker logic, no live 429) |
