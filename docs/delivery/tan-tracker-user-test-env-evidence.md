# TT56 user-test env — прогоны (sandbox)

Обновлено после `TT56-USER-TEST-ENV-FIXES-DEAF6DF-20261029`.

## Команды

```bash
npm run typecheck && npm run build
node --import tsx --test test/unit/tan-tracker-user-test-env.test.ts test/unit/tan-tracker-user-test-runtime.test.ts
TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/tandoor_rf_test npm run test:integration:tan-tracker
TT56_USER_TEST_SEED_DATABASE_URL='postgresql://…/tandoor_rf_tt56_user_test' \
  node --import tsx --test test/integration/tan-tracker-user-test-seed-idempotency.test.ts
TT56_USER_TEST_BROWSER_SMOKE=1 TT_USER_TEST_DEFAULT_PASSWORD='…' npm run tt56-user-test:browser-smoke
TT56_USER_TEST_PUBLIC_SMS_RELOAD=1 node --env-file=.env.tan-tracker-user-test.local --import tsx --test test/browser/tan-tracker-user-test-public-sms-reload.browser.test.ts
```

## Исправленные блокеры (deaf6df → текущий SHA)

| Блокер | Статус | Проверка |
|--------|--------|----------|
| SMS proof терялся после reload (recipient) | PASS | browser `tan-tracker-user-test-public-sms-reload` + `writeUrl`/`readUrl tt_pts` |
| Пустой bootstrap после seed | PASS | seed fixtures; employee A bootstrap orders≥4, contacts≥4 |
| Seed не идемпотентен (roster/team/GUID) | PASS | integration seed idempotency; 2× seed → roster=3, teams=1 |
| Наследование ONEC_NIGHTLY из shell | PASS | `env -i` start + `assertTanTrackerUserTestRuntimeIsolation`; unit runtime test |
| Баннер только в private LK | PASS | public recipient/holder/receipt API + UI `userTestBannerBlock` |

## Сценарии UAT (кратко)

| # | Сценарий | Статус |
|---|----------|--------|
| 1 | Seed 2× + сохранность user transfer | PASS (integration) |
| 2 | A создаёт передачу + файлы + reload | NOT_RUN (full browser) |
| 3 | A→B handoff UI | NOT_RUN |
| 4 | External relay chain | NOT_RUN (fixture TT56-S-RELAY-01 seeded) |
| 5 | SMS verify → reload до code | PASS (browser) |
| 6–10 | Holder files, roles 390/1440, restart | NOT_RUN |

## URL

По-прежнему **только localhost** (`npm run tt56-user-test:start`). Внешнее размещение — отдельный операторский шаг.
