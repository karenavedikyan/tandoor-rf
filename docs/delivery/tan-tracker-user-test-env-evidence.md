# TT56 user-test env — прогоны (sandbox)

Обновлено после `TT56-USER-TEST-ENV-FIXES-440042A-20261029` (остатки P1/P2).

## Команды

```bash
npm run typecheck && npm run build
node --import tsx --test test/unit/tan-tracker-user-test*.test.ts
TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/tandoor_rf_test \
  npm run test:integration:tan-tracker
set -a && source .env.tan-tracker-user-test.local && set +a
TT56_USER_TEST_SEED_DATABASE_URL="$DATABASE_URL" \
  node --import tsx --test test/integration/tan-tracker-user-test-seed-idempotency.test.ts \
  test/integration/tan-tracker-user-test-seed-legacy-upgrade.test.ts
# browser (после seed с тем же TT_USER_TEST_DEFAULT_PASSWORD, что в тесте):
TT_USER_TEST_DEFAULT_PASSWORD='Tt56UserTest!Local2026' node scripts/tan-tracker-user-test/seed.mjs
TT56_USER_TEST_PUBLIC_SMS_RELOAD=1 TT_USER_TEST_DEFAULT_PASSWORD='Tt56UserTest!Local2026' \
  node --import tsx --test test/browser/tan-tracker-user-test-public-sms-reload.browser.test.ts
```

## Исправления 440042a → текущий SHA

| Блокер | Статус | Проверка |
|--------|--------|----------|
| P1 legacy upgrade воскрешает удалённое вложение | PASS | `markLegacyDeletedFixtureAttachments` + a0fac71 worktree upgrade + simulated drop-provenance test |
| P2 перезапись пользовательского имени РОП | PASS | team upsert без `name_team_leader`; repair только `name_team_leader = EMP_ROP` GUID |

## Прогоны (sandbox)

| Проверка | Результат |
|----------|-----------|
| typecheck / build | PASS |
| unit startup/seed (11) | PASS |
| integration tan-tracker (27) | PASS |
| seed idempotency (2) | PASS |
| seed legacy upgrade (5: a0fac71 + 4) | PASS |
| browser SMS reload | PASS (после `prepareDatabase` + seed с `Tt56UserTest!Local2026`; иначе 401 из‑за другого hash после PG seed-тестов) |

### Legacy / repeat / fresh

| Сценарий | Результат |
|----------|-----------|
| a0fac71 seed → delete attach+file → custom leader + disabled B → current seed | PASS (attach/file absent, leader preserved, B disabled) |
| drop provenance + delete attach → current seed | PASS |
| custom leader `QA user-edited leader` → repeat seed | PASS |
| corrupted GUID leader → repeat seed | PASS → `ROP Lead` |
| fresh DB `tandoor_rf_tt56_legacy_fresh_test` | PASS (attachments + `ROP Lead`) |

## Ограничения

- Внешний URL не размещён; localhost не является пользовательским стендом.
- PG legacy/fresh sibling DB: нужен admin (`TEST_DATABASE_URL` или `TT56_USER_TEST_PG_ADMIN_URL`).
- Полный browser UAT tt56 не повторялся; UI не менялся.
