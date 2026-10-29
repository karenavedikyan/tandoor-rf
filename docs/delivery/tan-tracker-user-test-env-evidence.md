# TT56 user-test env — прогоны (sandbox)

Обновлено после `TT56-USER-TEST-ENV-FIXES-A0FAC71-20261029`.

## Команды

```bash
npm run typecheck && npm run build
node --import tsx --test test/unit/tan-tracker-user-test*.test.ts
TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/tandoor_rf_test npm run test:integration:tan-tracker
TT56_USER_TEST_SEED_DATABASE_URL='postgresql://…/tandoor_rf_tt56_user_test' \
  node --import tsx --test test/integration/tan-tracker-user-test-seed-idempotency.test.ts
TT56_USER_TEST_PUBLIC_SMS_RELOAD=1 node --env-file=.env.tan-tracker-user-test.local --import tsx --test test/browser/tan-tracker-user-test-public-sms-reload.browser.test.ts
```

## Исправления a0fac71 → текущий SHA

| Блокер | Статус | Проверка |
|--------|--------|----------|
| P1 прямой `startServer()` обход fail-closed | PASS | `assertTanTrackerUserTestStartup` при `TT_USER_TEST_ENV=true`; unit startServer + runtime |
| P1 seed реактивирует disabled / воскрешает вложение | PASS | PG test: status disabled, attachment count 0, password preserved |
| P2 `name_team_leader` = GUID | PASS | SQL fix + repair UPDATE; PG assert `ROP Lead` |

## Прогоны (sandbox, этот commit)

| Проверка | Результат |
|----------|-----------|
| `npm run typecheck` | PASS |
| `npm run build` | PASS |
| unit `tan-tracker-user-test*` | 10 PASS |
| integration tan-tracker | 20 PASS |
| seed idempotency (2 cases) | 2 PASS |
| browser SMS reload | NOT_RUN (без изменений UI) |

## URL

Только localhost (`npm run tt56-user-test:start`). Внешний стенд — отдельный операторский шаг.
