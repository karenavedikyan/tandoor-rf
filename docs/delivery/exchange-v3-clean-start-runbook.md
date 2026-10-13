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
3. Зафиксировать **контрольные суммы** (например `sha256sum` по каждому файлу) и **ожидаемые количества** из бизнес-проверки выгрузки (холдинги, юрлица, ТТ, сотрудники). Для **тестового** эталона PR #76 см. `test/unit/onec-exchange-v3-fixture-inventory.test.ts` (1 holding, 3 legal, 2 retail, 6 label objects) — **production-числа будут другими**.
4. Подтвердить у владельца/1С, что это **один завершённый** экспорт. **Двойное чтение** в CLI (см. `readStableV3Bundle`) фиксирует неизменность байтов между проходами, но **не доказывает** общую логическую версию всех файлов без маркера завершения выгрузки 1С.

**PASS:** SHA записан; 4 файла на месте; checksums и ожидаемые counts согласованы с владельцем.

**STOP:** расхождение файлов, неполный комплект, нет согласования «одна выгрузка».

**Разрешение:** владелец / ответственный за 1С — согласование комплекта.

---

### 2. TLS/CA и `pg_control_system` под ролью приложения

**Действия (только в разрешённой среде, credentials приложения — не публиковать):**

1. Убедиться, что `DATABASE_URL` приложения использует штатную TLS-policy (`createPgPoolOptions`, без `sslmode=disable` в production).
2. От имени **той же роли**, что runtime (не замена на локальный superuser):
   - выполнить dry-run clean-start (шаг 6) **или** отдельный read-only вызов identity;
   - убедиться, что fingerprint БД читается без `TARGET_DB_IDENTITY_UNAVAILABLE`.

**PASS:** успешный dry-run identity; TLS handshake с верным CA.

**STOP:** любой отказ TLS; отказ `pg_control_system`; предложение «выдать GRANT / ослабить fingerprint / отключить TLS».

**Разрешение:** владелец инфраструктуры + подтверждение на production-подключение.

**NOT RUN:** если нет разрешённого стенда — **выпуск блокируется** (gate выше).

---

### 3. Окно обслуживания и заморозка конкурирующих процессов

**Действия:**

1. Согласовать окно с владельцем.
2. **Остановить / не запускать** до завершения apply и smoke:
   - admin/worker задания `onec_import_jobs` (pending/running);
   - ручные и scheduled **regular update** / legacy import;
   - nightly exchange (`ONEC_NIGHTLY_EXCHANGE_ENABLED=false`, см. `docs/delivery/nightly-exchange-runbook.md`);
   - прочие workers, ставящие jobs в `onec_import_jobs`.
3. Зафиксировать **порядок включения обратно** (только после шага 9): сначала smoke OK → затем regular exchange → затем (отдельно) nightly/cron.

**PASS:** нет активных конкурирующих jobs; расписания отключены или не создают новых jobs.

**STOP:** `onec_import_jobs` в `pending`/`running` при dry-run/apply (dry-run сообщит blocker).

**Разрешение:** владелец — окно и остановка jobs.

---

### 4. Резервная копия и проверка восстановления

**Действия (оператор БД, вне приложения):**

1. Полный бэкап целевой БД **до** миграций v3/clean-start (метод — по политике хостинга).
2. Восстановить копию в **изолированную** БД; smoke-read (подключение, ключевые таблицы).
3. Записать **SHA приложения до деплоя** и совместимость: после destructive apply откат **только кодом** недостаточен (см. шаг 10).

**PASS:** бэкап создан; restore в изолированную БД проверен.

**STOP:** нет проверенного бэkaпа.

**Разрешение:** владелец — go на работу с production БД.

---

### 5. Deploy SHA и миграции (без импорта)

**Разрешение:** отдельное **разрешение на выпуск** (deploy).

**Действия:**

1. Выпустить на окружение **проверенный SHA** (сборка: `npm run build` на CI или эквивалент; артеfacts включают `dist/cli/onec-exchange-v3-clean-start.js`).
2. Применить миграции (в т.ч. `server/migrations/042_onec_exchange_v3.sql` и все pending до неё):

```bash
# DATABASE_URL — production, credentials не логировать
npm run migrate
```

(локально с `.env`: `npm run migrate:local` — только если так принято на стенде).

3. **Не** запускать clean-start apply, regular update apply, purge, Bitrix bootstrap.

**PASS:** `npm run migrate` успешен; pending migrations включая `042_*` применены; приложение стартует на новом SHA.

**STOP:** ошибка миграции; SHA на сервере ≠ протоколу.

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

**COMMIT_UNCERTAIN / transport:**

- **Не** повторять purge/import автоматически.
- Новое TLS-соединение: `legacy_clean_start_*`, fingerprint наблюдаемой БД, counts v3 (`observeCleanStartState` / recovery в коде).
- Успех recovery только при совпадении `observed.targetDb.fingerprint` с подтверждённым.

**PASS:** exit 0; JSON `ok: true`; legacy domain очищен; v3 tables загружены; маркеры в `onec_v3_exchange_state`.

**STOP:** `TARGET_DB_MISMATCH`, `COMMIT_UNCERTAIN` без подтверждённого recovery, повторный apply без `--force-clean-start` после успеха.

---

### 8. Smoke (ручной, в UI и API)

**PASS (минимальный чек-лист):**

- Список v3: холдинги, юрлица, ТТ; **orphan retail** без холдинга (если есть в комплекте).
- Карточки, переходы list → detail → nested return.
- Права: manager / ROP / admin (scope, 404 чужих).
- Пользователи и `user_onec_employee_links` на месте.
- Bitrix: старые клиентские метки отозваны; **новая** выдача метки по сценарию v3 (см. integration bitrix-labels) — **без** массового bootstrap без разрешения.

**STOP:** потеря пользователей/каталога; некорректный scope; критичные регрессии UI.

**Разрешение:** владелец принимает smoke.

---

### 9. Регular exchange и workers (после smoke)

**Разрешение:** владелец — включение regular update и workers.

1. **Не** включать nightly/cron до отдельного решения (`docs/delivery/nightly-exchange-runbook.md`).
2. Regular update (FTP, двойное чтение 4 файлов):

```bash
node dist/cli/onec-regular-update.js --dry-run
# после приёмки dry-run и того же bundle fingerprint:
node dist/cli/onec-regular-update.js --apply --expected-fingerprint=<fingerprint>
```

(или admin UI worker — тот же `runRegularUpdate`.)

3. Bootstrap Bitrix / массовые операции с метками — **отдельный явно разрешённый** шаг, не часть clean-start.

**PASS:** regular dry-run без сюрпризов; apply по fingerprint; workers не дублируют jobs.

---

### 10. Rollback

**До destructive apply (шаг 7):**

- Откат приложения на **прежний SHA** + БД из бэkaпа (шаг 4) — достаточен.

**После successful clean-start apply:**

- Откат **только кода** **недостаточен**: удалены legacy clients, grants, Bitrix bindings/метки.
- Требуется **восстановление БД из бэkaпа** (шаг 4) на согласованное время + план по Bitrix (retired codes, повторная привязка задач, коммуникация с пользователями).
- Повторный clean-start на «исправленной» БД без restore — **новое** destructive действие; только с dry-run + разрешением.

**PASS (план):** документирован RTO/RPO; ответственный за restore и Bitrix; бэкап до шага 7 сохранён.

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
