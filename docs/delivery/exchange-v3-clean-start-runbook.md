# Exchange v3 — clean start, первая загрузка и регулярное обновление

**Не выполнять destructive-действия на production без отдельного письменного разрешения владельца.**

Этот документ описывает порядок работ. **Выполнение шагов на production Cursor/агентом в PR не производится**, пока владелец явно не разрешит конкретный шаг.

---

## Локальная приёмка кода (PR #76, изолированные test DB)

**Выполнено** на кандидате `9c8479b` (не равно выпуску в production до merge и отдельного deploy-разрешения):

| Проверка | Результат |
|----------|-----------|
| `npm run typecheck` / `npm run build` | PASS |
| `npm test` | 679/679 |
| `npm run test:integration:v3-pr76` | 29/29 (9 файлов, последовательно) |
| `npm run test:browser -- test/browser/clients-v3.browser.test.ts` | 1/1 |

Команды — только на `*_test` PostgreSQL (см. `docs/delivery/acceptance-matrix.md`, раздел Exchange v3).

---

## Release gates (обязательны до первой production-загрузки)

| Gate | Статус по умолчанию | STOP, если |
|------|---------------------|------------|
| Merge PR #76 и deploy согласованного SHA | ⏸ не выполнено агентом | SHA на prod ≠ зафиксированному в протоколе |
| TLS + CA к **целевой** managed PostgreSQL под **ролью приложения** | **NOT RUN** до стенда | `sslmode=disable`, неверный CA, handshake fail |
| `pg_control_system()` / эквивалент fingerprint под **ролью приложения** | **NOT RUN** до стенда | dry-run/identity → `TARGET_DB_IDENTITY_UNAVAILABLE` |
| Подтверждение **одного логического комплекта** 1С (4 файла) | ⏸ оператор | Нет маркера завершения выгрузки / сомнение в согласованности |
| Бэкап + пробное восстановление в **изолированную** БД | ⏸ оператор | Восстановление не проверено |
| Окно обслуживания + остановка конкурирующих jobs | ⏸ оператор | Активные `onec_import_jobs` / workers / nightly |
| Dry-run без blockers + приёмка владельцем | ⏸ оператор | Любой blocker или несовпадение counts/fingerprint |
| Отдельное разрешение на **destructive apply** | ⏸ владелец | Apply без второго явного OK |
| Smoke после apply | ⏸ оператор | Любой критичный сценарий FAIL |
| Регular exchange / расписания / bootstrap Bitrix | ⏸ владелец | До явного включения после smoke |

Локальный PostgreSQL и superuser **не заменяют** gates TLS и production-роли.

---

## Разрешения (раздельно)

| Тип | Что покрывает | Шаги |
|-----|----------------|------|
| **Подключение read-only** | TLS identity, dry-run, observe recovery | 2, 6, recovery после 7 |
| **Deploy + миграции** | Выпуск SHA, `npm run migrate`, перезапуск приложения | 5 |
| **Destructive apply** | clean-start `--apply`, purge legacy, загрузка v3 | 7 |
| **Внешние действия Bitrix** | `bitrix24-sync --apply`, bootstrap меток, **выдача новой** клиентской метки в smoke | 8 (отдельно), 9 |

Без соответствующего разрешения шаг **STOP**. Read-only smoke (списки, карточки, права без записи в Bitrix) допустим после apply в рамках приёмки UI.

---

## Scope clean start (напоминание)

**Сохраняется:** пользователи, сессии, `user_onec_employee_links`, команды РОП, матрица доступа, каталог, Bitrix-задачи/настройки (не bootstrap).

**Удаляется:** legacy `onec_clients` / `onec_retail_outlets`, журналы import/quarantine/baseline/holding-v2, клиентские grants/delegations, активные метки Bitrix (коды → `bitrix24_label_codes_retired`), привязки задач (`binding_status = revoked`). Реализация: `src/onec-exchange-v3/clean-start-purge.ts`.

---

## Preflight и первая загрузка — пошаговый порядок

Для каждого шага: **PASS** = критерий готовности к следующему; **STOP** = не продолжать без устранения; **Разрешение** = кто должен явно разрешить.

### 1. Зафиксировать SHA приложения и комплект 1С (4 файла)

**Действия (оператор, без destructive SQL):**

1. Записать **git SHA** артеfactа, который будет выпущен (после merge — SHA деплоя, не локальный черновик).
2. Положить комплект в каталог на сервере/хосте CLI (не обязательно test fixtures):
   - `all_holding.json`
   - `all_clients.json`
   - `all_retail.json`
   - `all_employees.json`
3. Зафиксировать **контрольные суммы** и **ожидаемые количества** из бизнес-проверки выгрузки (холдинги, юрлица, ТТ, сотрудники):

```bash
cd <BUNDLE_DIR>
sha256sum all_holding.json all_clients.json all_retail.json all_employees.json
```

   Для **тестового** эталона PR #76 см. `test/unit/onec-exchange-v3-fixture-inventory.test.ts` (1 holding, 3 legal, 2 retail, 6 label objects) — **production-числа будут другими**.
4. Заполнить протокол (бумага/тикет): **deploy SHA**, четыре SHA256, ожидаемые counts, дата/маркер завершения выгрузки 1С, подпись ответственного.
5. Подтвердить у владельца/1С, что это **один завершённый** экспорт. **Двойное чтение** в CLI (см. `readStableV3Bundle`) фиксирует неизменность байтов между проходами, но **не доказывает** общую логическую версию всех файлов без маркера завершения выгрузки 1С.

**PASS:** SHA записан; 4 файла на месте; checksums и ожидаемые counts согласованы с владельцем.

**STOP:** расхождение файлов, неполный комплект, нет согласования «одна выгрузка».

**Разрешение:** владелец / ответственный за 1С — согласование комплекта.

---

### 2. TLS/CA и `pg_control_system` под ролью приложения (до миграций v3)

**Разрешение:** **подключение read-only** к production БД.

**Действия (credentials приложения на хосте CLI — не логировать, не выводить URL):**

1. Убедиться, что конфиг приложения использует штатную TLS-policy (`createPgPoolOptions`, без `sslmode=disable` в production).
2. От имени **той же роли**, что runtime (не superuser-замена), read-only identity через модуль `resolveTargetDbIdentityFromUrl` (one-off pool, те же CA/TLS):

```bash
npm run build
# DATABASE_URL уже задан в окружении приложения (секрет не печатать)
node dist/cli/onec-exchange-v3-target-db-identity.js
```

3. Сохранить `identity.fingerprint` и `targetDbLabel` в протокол выпуска.

**Не использовать** полный clean-start dry-run (шаг 6) на **исходной** БД до миграций: dry-run ожидает схему v3 и таблицы из `042_onec_exchange_v3.sql`.

**PASS:** exit 0; JSON `ok: true`; fingerprint и `systemIdentifier` прочитаны; TLS handshake успешен.

**STOP:** `TARGET_DB_IDENTITY_UNAVAILABLE` / timeout; отказ TLS; предложение «выдать GRANT / ослабить fingerprint / отключить TLS».

**NOT RUN:** если нет разрешённого стенда — **выпуск блокируется**.

---

### 3. Окно обслуживания и заморозка конкурирующих процессов

**Разрешение:** владелец — окно и остановка jobs.

**Действия:**

1. Согласовать окно с владельцем.
2. **Запретить создание новых jobs** до завершения apply и smoke:
   - admin UI «Обновить из 1С» (POST → `onec_import_jobs`);
   - CLI `onec-regular-update.js --apply`;
   - cron/tick: `onec-nightly-exchange-tick`, `onec-scheduled-exchange` (см. `docs/delivery/nightly-exchange-runbook.md`);
   - legacy operator import / clean-reload apply.
   `ONEC_NIGHTLY_EXCHANGE_ENABLED=false` **только** отключает in-process nightly scheduler после старта приложения; **не** отменяет все фоновые импорты (отдельные cron, workers, ручной admin apply).
3. **Дать `running` jobs корректно завершиться** (не убивать процесс на середине apply без процедуры).
4. **Остановить исполнителей:** процессы `onec-import-job-worker`, отдельные worker-инстансы на хостах (см. `docs/delivery/import-runbook.md`).
5. **Подтвердить пустую очередь** SQL-диагностикой: нет `onec_import_jobs` в `pending`/`running` (см. `docs/delivery/f6-production-regular-update-runbook.md`).
6. На время **бэкапа (шаг 4), миграций и apply (шаг 5–7)** заморозить **изменяющие** операции приложения и конкурирующие **Bitrix sync с записью** (`bitrix24-sync --apply`, bootstrap меток — см. `docs/delivery/bitrix24-runbook.md`). Если автоматический Bitrix cron на стенде **не описан** — **STOP** и согласовать с владельцем ручное отключение; read-only smoke (UI/API без записи) — отдельно после apply.
7. **Перед первым `start` / deploy нового SHA (шаг 5):** повторно проверить очередь `onec_import_jobs`. Иначе `startServer` → `drainPendingImportJobs()` может **сразу исполнить** pending regular-update job из backlog.

**Порядок включения обратно** (только после шага 9): smoke OK → regular exchange dry-run/apply → workers → (отдельные разрешения) nightly/cron и Bitrix bootstrap.

**PASS:** нет `pending`/`running` import jobs; новые jobs не создаются; Bitrix write-path заморожен или явно согласован.

**STOP:** backlog jobs перед стартом сервера; активные workers; неизвестный Bitrix cron без плана STOP.

---

### 4. Резервная копия и проверка восстановления

**Действия (оператор БД, вне приложения):**

1. Полный бэкап целевой БД **до** миграций v3/clean-start (метод — по политике хостинга).
2. Восстановить копию в **изолированную** БД; smoke-read (подключение, ключевые таблицы).
3. Записать **SHA приложения до деплоя** и совместимость: после destructive apply откат **только кодом** недостаточен (см. шаг 10).

**PASS:** бэкап создан; restore в изолированную БД проверен.

**STOP:** нет проверенного бэкапа.

**Разрешение:** владелец — go на работу с production БД.

---

### 5. Deploy SHA и миграции (без импорта)

**Разрешение:** **deploy + миграции** (отдельно от destructive apply).

**Действия:**

1. Выпустить на окружение **проверенный SHA** (сборка: `npm run build`; артеfacts включают `dist/cli/onec-exchange-v3-clean-start.js`, `onec-exchange-v3-target-db-identity.js`, `onec-exchange-v3-clean-start-observe.js`).
2. Ещё раз убедиться: очередь import jobs пуста (шаг 3.7).
3. Применить **все pending** миграции проверяемого SHA (обязательны как минимум):

   - `server/migrations/042_onec_exchange_v3.sql` — схема v3;
   - `server/migrations/043_onec_v3_clean_start_state.sql` — маркеры clean-start.

```bash
# DATABASE_URL в окружении; credentials не логировать
npm run migrate
```

(локально с `.env`: `npm run migrate:local` — только если так принято на стенде).

4. **PASS-проверка схемы** (read-only SQL, без секретов):

```sql
SELECT filename FROM schema_migrations
 WHERE filename IN ('042_onec_exchange_v3.sql', '043_onec_v3_clean_start_state.sql');

SELECT column_name FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'onec_v3_exchange_state'
   AND column_name IN ('legacy_clean_start_completed_at', 'legacy_clean_start_bundle_fingerprint');
```

   Должны быть **обе** строки в `schema_migrations` и **оба** столбца. Наличие только `042` **недостаточно**.

5. Запустить приложение на новом SHA только после п.2–4. **Не** запускать clean-start apply, regular update apply, purge, Bitrix bootstrap.

**PASS:** `npm run migrate` успешен; все pending миграции SHA применены; 042+043 в `schema_migrations`; legacy clean-start columns существуют; SHA на сервере = протоколу.

**STOP:** ошибка миграции; отсутствует 043 или столбцы маркеров; SHA ≠ протоколу; pending jobs при старте.

---

### 6. Dry-run clean-start на целевой БД

**Разрешение:** разрешение на **подключение** к production БД (read-only по сути dry-run).

**Подготовка:** `npm run build` на выпущенном SHA; каталог комплекта `<BUNDLE_DIR>`.

```bash
node dist/cli/onec-exchange-v3-clean-start.js \
  --i-understand \
  --bundle-dir=<BUNDLE_DIR>
```

(без `--apply` — режим dry-run по умолчанию; one-off TLS + timeouts).

**Проверить в JSON:**

- `report.targetDb.fingerprint` — сохранить для apply;
- `report.bundleFingerprint`, `report.fileSha256`;
- `report.blockers` — **должен быть пуст**;
- `report.wouldRemove` / `report.wouldLoad` / `report.preserved` — сверить с ожиданиями владельца (counts).

**PASS:** exit code 0; blockers пуст; fingerprints и counts приняты владельцем.

**STOP:** любой blocker; несогласованные counts; невозможность прочитать identity.

**Дальше:** **остановиться**. Destructive apply — только после **отдельного** разрешения (шаг 7).

---

### 7. Clean-start apply (один раз)

**Разрешение:** отдельное **разрешение владельца на destructive apply**.

```bash
node dist/cli/onec-exchange-v3-clean-start.js \
  --i-understand \
  --apply \
  --bundle-dir=<BUNDLE_DIR> \
  --confirm-target-db-fingerprint=<из dry-run> \
  --confirm-bundle-fingerprint=<из dry-run>
```

Повтор после успешного clean-start — только с `--force-clean-start` (и снова dry-run + разрешение).

**COMMIT_UNCERTAIN / transport — recovery (read-only, без повторного apply):**

- **Не** повторять purge/import; **не** вызывать `--force-clean-start` автоматически.
- Новое TLS-соединение, модуль `observeCleanStartState`:

```bash
node dist/cli/onec-exchange-v3-clean-start-observe.js
```

- Сверить с протоколом dry-run:
  - `observed.targetDb.fingerprint` = `--confirm-target-db-fingerprint`;
  - `legacyCleanStartBundleFingerprint` = `--confirm-bundle-fingerprint` (если clean-start завершён);
  - `legacyCleanStartCompletedAt` — ожидаемое значение после успеха;
  - counts `v3HoldingsCount` / `v3LegalCount` / `v3RetailCount` / `v3EmployeeRosterCount` — согласованы с dry-run `wouldLoad`.
- Если наблюдение **неоднозначно** (`ok: false`, несовпадение fingerprint/counts, null там где ожидался маркер) — **STOP**, эскалация владельцу; ручной разбор, без автоматического повтора apply.

**PASS:** exit 0; JSON `ok: true`; legacy domain очищен; v3 tables загружены; маркеры в `onec_v3_exchange_state`.

**STOP:** `TARGET_DB_MISMATCH`, `COMMIT_UNCERTAIN` без подтверждённого recovery, повторный apply без `--force-clean-start` после успеха.

---

### 8. Smoke (ручной, в UI и API)

**Разрешение:** приёмка smoke; **отдельное разрешение Bitrix** — если шаг создаёт метку / вызывает внешний API (`bitrix24-sync --apply`, выдача новой клиентской метки).

**PASS (минимальный чек-лист, read-only где возможно):**

- Список v3: холдинги, юрлица, ТТ; **orphan retail** без холдинга (если есть в комплекте).
- Карточки, переходы list → detail → nested return.
- Права: manager / ROP / admin (scope, 404 чужих).
- Пользователи и `user_onec_employee_links` на месте.
- Bitrix: факт отзыва старых клиентских меток (read-only проверка); **новая** выдача метки — только с **разрешением на внешние действия Bitrix**, не часть обязательного read-only smoke.

**STOP:** потеря пользователей/каталога; некорректный scope; критичные регрессии UI.

**Разрешение:** владелец принимает smoke; Bitrix write — отдельно.

---

### 9. Регular exchange и workers (после smoke)

**Разрешение:** владелец — включение regular update и workers.

1. **Не** включать nightly/cron до отдельного решения (`docs/delivery/nightly-exchange-runbook.md`).
2. Regular update (FTP, двойное чтение 4 файлов):

```bash
node dist/cli/onec-regular-update.js --dry-run
# после приёмки dry-run и того же bundle fingerprint:
node dist/cli/onec-regular-update.js --apply --expected-fingerprint <fingerprint>
```

(или admin UI worker — тот же `runRegularUpdate`.)

3. Bootstrap Bitrix / массовые операции с метками — **отдельный явно разрешённый** шаг, не часть clean-start.

**PASS:** regular dry-run без сюрпризов; apply по fingerprint; workers не дублируют jobs.

---

### 10. Rollback

**До destructive apply (шаг 7):**

- Откат приложения на **прежний SHA** + БД из бэкапа (шаг 4) — достаточен, если после бэкапа **не было** записей, которые нужно сохранить.

**После бэкапа, но до apply (шаг 4–6):**

- Любые записи в БД (миграции 042/043, служебные строки, случайные jobs) **не исчезнут** при restore «молча». Restore на точку бэкапа **откатывает** и миграции v3 на старой схеме — согласовать с откатом кода.

**После successful clean-start apply:**

- Откат **только кода** **недостаточен**: удалены legacy clients, grants, Bitrix bindings/метки.
- Требуется **восстановление БД из бэкапа** (шаг 4) на согласованное время + план по Bitrix (retired codes, повторная привязка задач, коммуникация с пользователями) + учёт изменений после момента бэкапа.
- Повторный clean-start на «исправленной» БД без restore — **новое** destructive действие; только с dry-run + разрешением.

**PASS (план):** документирован RTO/RPO; ответственный за restore и Bitrix; бэкап до шага 7 сохранён; перечень изменений после бэкапа зафиксирован.

---

## Техническая справка (identity, TLS, recovery)

- Fingerprint БД: `sha256(pg|system_identifier|current_database())` на **фактическом** соединении apply (до lock/purge).
- Dry-run: `runExchangeV3CleanStartDryRun` — one-off pool, `statement_timeout` + `query_timeout` (`target-db-identity.ts`).
- `TargetDbIdentityError.discardConnection`: client transport → уничтожить соединение; server `statement_timeout` — иное.
- После client/transport timeout: `release(true)`; без RESET/ROLLBACK/advisory unlock на испорченной сессии.

### Release gates в CI (PR)

| Проверка | Статус |
|----------|--------|
| TLS + CA к managed PostgreSQL | **NOT RUN** |
| `pg_control_system` под production-ролью | **NOT RUN** |

---

## Test DB (кратко, для разработки)

1. Бэкап test DB.
2. `npm run migrate` на test `DATABASE_URL`.
3. Dry-run / apply с `test/fixtures/onec-exchange-v3` — команды как выше с `--bundle-dir=test/fixtures/onec-exchange-v3`.

Стабильность комплекта: двойное чтение **не** заменяет согласование одной логической выгрузки 1С.
