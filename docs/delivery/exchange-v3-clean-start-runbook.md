# Exchange v3 — clean start и регулярное обновление (test / инструкция prod)

**Не выполнять на production без отдельного подтверждения владельца.**

## Что сохраняется при clean start

- Пользователи, сессии, `user_onec_employee_links`
- Команды РОП, матрица доступа (структура)
- Каталог, фото, Bitrix24 **исходные задачи** и настройки портала
- FTP и секреты окружения

## Что удаляется (явный scope)

- Legacy `onec_clients`, `onec_retail_outlets`, журналы import/quarantine/baseline/holding-v2
- Клиентские `access_grants`, delegations, `bitrix24_client_card_objects`
- Активные метки Bitrix24 (коды переносятся в `bitrix24_label_codes_retired`; **счётчики последовательностей не сбрасываются**)
- Привязки задач Bitrix24 к старым объектам (`binding_status = revoked`)

Реализация: `src/onec-exchange-v3/clean-start-purge.ts`

## Порядок (test DB)

1. Бэкап БД.
2. Миграции до `042_onec_exchange_v3.sql`.
3. Dry-run clean-start (только SELECT, без DELETE; **one-off** TLS-соединение с `statement_timeout` и клиентским `query_timeout`, не shared pool):  
   `node dist/cli/onec-exchange-v3-clean-start.js --i-understand --dry-run --bundle-dir test/fixtures/onec-exchange-v3`  
   (локально после `npm run build`; в dev допустим `node --import tsx src/cli/onec-exchange-v3-clean-start.ts …`)  
   Сохранить `targetDb.fingerprint` (cluster `system_identifier` + `current_database()`, **не** host/IP из URL) и `bundleFingerprint` из JSON.
4. Apply clean-start (одна транзакция: lock → purge legacy → revoke Bitrix → load v3):  
   `node dist/cli/onec-exchange-v3-clean-start.js --i-understand --apply --bundle-dir test/fixtures/onec-exchange-v3 --confirm-target-db-fingerprint=<sha> --confirm-bundle-fingerprint=<sha>`  
   Повтор после успешного перехода только с `--force-clean-start`.
5. Регулярное обновление (без clean-start):  
   `node --import tsx src/cli/onec-regular-update.ts --dry-run` (или admin worker) — комплект v3 со **стабильным двойным чтением** четырёх файлов (два полных прохода по всем файлам, общий deadline).
6. Проверка: `onec_v3_*` таблицы, пользователи и каталог на месте; UI `/clients` переключается на v3 при `exchangeV3Active` (API `/api/clients/v3/list`, `/api/clients/v3/detail`, composition).

## Стабильность комплекта (ограничение)

Двойное чтение фиксирует, что **каждый из четырёх файлов не менялся между двумя полными проходами** в пределах deadline. Это **не** доказывает, что все файлы принадлежат одной логической версии выгрузки 1С, если в FTP нет маркера завершения выгрузки. При `COMMIT_UNCERTAIN` после clean-start **не** повторять purge автоматически — проверить `legacy_clean_start_completed_at`, `legacy_clean_start_bundle_fingerprint`, **fingerprint наблюдаемой БД** и counts v3 **новым TLS-подключением** (`observeCleanStartState`). Успешное recovery (`recoveredAfterCommitUncertainty: true`) только если `observed.targetDb.fingerprint` совпал с подтверждённым; `legacyRemoved` / `bitrixLabelsRevoked` — сохранённые значения транзакции или `null`, не вымышленные нули.

## Регулярное обновление

- Кнопка админа / worker → `runRegularUpdate` (только v3, 4 файла).
- Расписание и nightly **выключены** до решения владельца.
- Повтор apply с тем же fingerprint → без дублей (состояние в `onec_v3_exchange_state`).

## Идентичность БД и preflight роли

- Fingerprint: `sha256(pg|system_identifier|current_database())` с **фактического** соединения apply (до lock/purge), не только из URL.
- Dry-run (`runExchangeV3CleanStartDryRun`), identity и recovery используют one-off pool с той же TLS-policy, серверным `statement_timeout` и клиентским `query_timeout` (см. `ONE_OFF_*_TIMEOUT_MS` в `target-db-identity.ts`). После транспортного/query timeout one-off соединение не возвращается в пул; на shared pool apply — `client.release(true)`.
- Роль приложения должна иметь право читать `pg_control_system()` (или эквивалент для managed PostgreSQL). При отказе — **TARGET_DB_MISMATCH** до изменения данных; автоматических GRANT или ослабления проверки нет.
- **Preflight под production-ролью:** выполнить dry-run CLI от имени той же роли, что и приложение (не локальный superuser `postgres` вместо managed-роли).

### Release gates (вне локального CI)

| Проверка | Статус в PR |
|----------|-------------|
| TLS + CA к managed PostgreSQL | **NOT RUN** (нет разрешённого TLS-стенда в агенте) |
| `pg_control_system` под production-ролью | **NOT RUN** (локальный PostgreSQL часто разрешает функцию обычным ролям; это не замена managed preflight) |

Не считать production готовым только по локальным тестам.

## Production (только инструкция)

Согласованное окно, остановка конкурирующих jobs, бэкап, проверка комплекта, миграции, clean start + apply, smoke сайта. Cursor **не** выполняет эти шаги в PR.
