# TT56 user-test env — прогоны (sandbox)

SHA: см. ветку `cursor/tan-tracker-test-env-20261029` (после push).  
База реализации: `ee83a81`. Эталон UI: `7f28457`.

## Команды проверки

```bash
npm run typecheck
npm run build
TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/tandoor_rf_test npm run test:integration:tan-tracker
node --import tsx --test test/unit/tan-tracker-user-test-env.test.ts
# после seed + .env.tan-tracker-user-test.local:
TT56_USER_TEST_BROWSER_SMOKE=1 TT_USER_TEST_DEFAULT_PASSWORD='…' npm run tt56-user-test:browser-smoke
curl login + GET /api/tan-tracker/bootstrap → userTestEnvironmentBanner
```

## Локальный стенд (Cursor sandbox)

| Шаг | Результат |
|-----|-----------|
| init-db `tandoor_rf_tt56_user_test` | PASS |
| seed (миграции + роли + 2 клиента) | PASS (после fix upsert users) |
| start :3456 | PASS |
| bootstrap banner API | PASS |
| browser smoke banner + registry | PASS (после fix `tt-shell-meta--empty`) |

## Сценарии UAT (10)

| # | Сценарий | Статус | Комментарий |
|---|----------|--------|-------------|
| 1 | A создаёт передачу, reload без дубля | NOT_RUN | API FILES-01 в integration; полный UI+DB вручную |
| 2 | A → B QR/код, ответственный после confirm | NOT_RUN | linked-bootstrap public QR test покрывает API |
| 3 | A → external → final relay | PASS (API) | RELAY-01 integration |
| 4 | Передать другому промежуточному | NOT_RUN | нужен ручной/browser прогон |
| 5 | Reload proof/capability | PARTIAL | CODE-01 + phone guards integration |
| 6 | Public QR сотрудника без ложного proof | NOT_RUN | ручной incognito |
| 7 | Public holder files | PASS (API) | public-attachments integration |
| 8 | Director/ROP scope | PASS (API) | bootstrap scope + SCOPE-01 |
| 9 | Legacy/complete audit | NOT_RUN | ручной + DB audit |
| 10 | 375/390 + 1440 themes | NOT_RUN | browser smoke только 1440 light |

## Ограничения

- URL для внешних тестировщиков не развёрнут (только localhost).
- Полная приёмка diff ee83a81 vs tt56 не заявлена закрытой.
- Test SMS через файлы в `var/tt56-user-test/otp/`, не реальная SMS.
