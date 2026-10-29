# Tan-Tracker TT56 — изолированная пользовательская тест-среда

Идентификатор: `TT56-ISOLATED-USER-TEST-ENV-20261029`  
Ветка: `cursor/tan-tracker-test-env-20261029`  
База реализации: `cursor/tan-tracker-lk-tt56-20261028` @ `ee83a81`.

## Назначение

Отдельный стенд с **реальным** backend + PostgreSQL для ручного UAT. Не production, не Timeweb, не Tanbot.  
Постоянная метка в UI: «ТЕСТОВАЯ СРЕДА. Не использовать для реальных передач» (флаг `TT_USER_TEST_ENV` + БД `tandoor_rf_tt56_user_test`).

## Доступность URL

| Режим | Описание |
|--------|-----------|
| **Локально (проверено в sandbox)** | `http://127.0.0.1:3456` после `npm run tt56-user-test:start` на машине оператора |
| **URL для тестировщиков из интернета** | **Не развёрнуто** — нужен отдельный хостинг с ограничением доступа (VPN/basic auth/reverse proxy). Платные ресурсы не создавались. |

## Переменные окружения (без значений секретов)

Скопировать `.env.tan-tracker-user-test.example` → `.env.tan-tracker-user-test.local` (gitignored).

| Переменная | Назначение |
|------------|------------|
| `PORT`, `APP_ORIGIN` | Порт и origin приложения |
| `NODE_ENV` | `development` (не `production`) |
| `PGSSLMODE`, `TRUSTED_PROXIES` | Локальный PG |
| `TT_USER_TEST_ENV` | `true` — включает режим стенда |
| `DATABASE_URL` | Только `…/tandoor_rf_tt56_user_test` |
| `TT_ATTACHMENTS_DIR` | `var/tt56-user-test/attachments` |
| `TT_USER_TEST_OTP_DIR` | `var/tt56-user-test/otp` |
| `TT_PHONE_VERIFICATION_PROVIDER` | `test` (без реальных SMS) |
| `TT_OTP_PEPPER` | Секрет для HMAC OTP (≥16 символов) |
| `TT_USER_TEST_DEFAULT_PASSWORD` | Только в shell при **seed** (≥12 символов), не в git |
| `TT56_USER_TEST_DB_PASSWORD` | Только при **init-db** |
| `TT_USER_TEST_RESET_CONFIRM` | `yes` — только для **reset** |
| `ONEC_FTP_ENABLED`, `BITRIX24_ENABLED`, `TANBOT_TELEGRAM_ENABLED` | `false` |

Guards: `assertTanTrackerUserTestDatabaseUrl` в seed/start/reset; test SMS в production запрещён (`phone-verification.ts`).

## Команды

```bash
# 1) Зависимости
npm ci

# 2) БД (один раз на хосте)
export TT56_USER_TEST_DB_PASSWORD='…'   # оператор, не в git
npm run tt56-user-test:init-db

# 3) Локальный env-файл (без секретов в репозитории)
cp .env.tan-tracker-user-test.example .env.tan-tracker-user-test.local
# отредактировать DATABASE_URL (пароль БД), TT_OTP_PEPPER

# 4) Seed (идемпотентные пользователи/клиенты; миграции)
export TT_USER_TEST_DEFAULT_PASSWORD='…'   # ≥12 символов, только runtime
npm run tt56-user-test:seed

# 5) Запуск
npm run tt56-user-test:start
# → http://127.0.0.1:3456/tan-tracker

# 6) Остановка: Ctrl+C в терминале с сервером

# 7) Защищённый полный сброс схемы (только эта БД)
TT_USER_TEST_RESET_CONFIRM=yes npm run tt56-user-test:reset
export TT_USER_TEST_DEFAULT_PASSWORD='…'
npm run tt56-user-test:seed
```

## Тестовые роли (синтетика)

После seed см. `var/tt56-user-test/operator-credentials.json` (email + role, **без пароля**).

| Email | Роль |
|-------|------|
| `tt56-admin@tt56-user-test.local` | admin |
| `tt56-director@tt56-user-test.local` | director |
| `tt56-rop@tt56-user-test.local` | regional_manager (команда + клиент Alpha) |
| `tt56-employee-a@tt56-user-test.local` | manager (клиент Alpha) |
| `tt56-employee-b@tt56-user-test.local` | manager (клиент Beta) |

Пароль: значение `TT_USER_TEST_DEFAULT_PASSWORD` при seed. Выдавать тестировщикам через закрытый канал, не через git/README.

Внешний посредник и конечный получатель создаются **в сценарии передачи** (публичные маршруты `/tan-tracker/recipient`), не как пользователи ЛК.

## Test SMS (без реальной отправки)

1. В UI пройти шаг «Отправить код» на публичном маршруте.
2. Код пишется в `var/tt56-user-test/otp/<transferId>_<partyId>.json` (mode 600).
3. Оператор:

```bash
npm run tt56-user-test:peek-sms
# или с id:
node --env-file=.env.tan-tracker-user-test.local scripts/tan-tracker-user-test/peek-sms-code.mjs <transferId> <partyId>
```

Универсальный код в боевом пути не публикуется; этап подтверждения в UI обязателen.

## Чек-лист владельца (кратко)

1. Войти как **employee A** → `/tan-tracker` → баннер «ТЕСТОВАЯ СРЕДА».
2. Создать передачу с 2+ файлами → номер/квитанция → F5 — тот же номер, без дубля в списке.
3. Передать **employee B** (QR/код) → ответственный меняется после подтверждения B.
4. Передать **внешнему** → final: detail после QR, send-to-final, reload ссылки.
5. «Передать другому» промежуточному → без 401 на корпоративную базу.
6. Director / ROP: видимость только своих клиентов/команды.
7. Публичный QR сотрудника в incognito: без proof нет «номер подтверждён».

## Автоматические прогоны (агент)

См. таблицу в PR / отчёте агента: `npm run test:integration:tan-tracker`, unit `tan-tracker-user-test-env`, опционально `TT56_USER_TEST_BROWSER_SMOKE=1 npm run tt56-user-test:browser-smoke` после seed.

## Ограничения

- Не готово к боевой работе; не merge в production deploy.
- localhost в Cursor ≠ доступ тестировщику снаружи.
- Test SMS ≠ доставка SMS; desktop Chromium ≠ камера телефона.
- Tanbot / MAX / 1С / Bitrix / cron отключены флагами env.
