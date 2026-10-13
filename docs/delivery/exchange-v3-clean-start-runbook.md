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
3. Dry-run clean-start (только SELECT, без DELETE):  
   `node --import tsx src/cli/onec-exchange-v3-clean-start.ts --i-understand --dry-run --bundle-dir test/fixtures/onec-exchange-v3`  
   Сохранить `targetDb.fingerprint` и `bundleFingerprint` из JSON.
4. Apply clean-start (одна транзакция: lock → purge legacy → revoke Bitrix → load v3):  
   `node --import tsx src/cli/onec-exchange-v3-clean-start.ts --i-understand --apply --bundle-dir test/fixtures/onec-exchange-v3 --confirm-target-db-fingerprint=<sha> --confirm-bundle-fingerprint=<sha>`  
   Повтор после успешного перехода только с `--force-clean-start`.
5. Регулярное обновление (без clean-start):  
   `node --import tsx src/cli/onec-regular-update.ts --dry-run` (или admin worker) — комплект v3 со **стабильным двойным чтением** четырёх файлов (два полных прохода по всем файлам, общий deadline).
6. Проверка: `onec_v3_*` таблицы, пользователи и каталог на месте.

## Стабильность комплекта (ограничение)

Двойное чтение фиксирует, что **каждый из четырёх файлов не менялся между двумя полными проходами** в пределах deadline. Это **не** доказывает, что все файлы принадлежат одной логической версии выгрузки 1С, если в FTP нет маркера завершения выгрузки. При `COMMIT_UNCERTAIN` после clean-start **не** повторять purge автоматически — проверить `legacy_clean_start_completed_at`, `legacy_clean_start_bundle_fingerprint` и counts v3 **новым подключением** (`observeCleanStartState` / CLI dry-run fingerprint).

## Регулярное обновление

- Кнопка админа / worker → `runRegularUpdate` (только v3, 4 файла).
- Расписание и nightly **выключены** до решения владельца.
- Повтор apply с тем же fingerprint → без дублей (состояние в `onec_v3_exchange_state`).

## Production (только инструкция)

Согласованное окно, остановка конкурирующих jobs, бэкап, проверка комплекта, миграции, clean start + apply, smoke сайта. Cursor **не** выполняет эти шаги в PR.
