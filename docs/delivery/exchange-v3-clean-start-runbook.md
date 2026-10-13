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
3. Dry-run комплекта:  
   `node --import tsx src/cli/onec-regular-update.ts --mode dry-run --bundle-dir test/fixtures/onec-exchange-v3`
4. Clean start (отдельная процедура, **не** при старте приложения): транзакция purge + apply с тем же fingerprint.
5. Проверка: `onec_v3_*` таблицы, пользователи и каталог на месте.

## Регулярное обновление

- Кнопка админа / worker → `runRegularUpdate` (только v3, 4 файла).
- Расписание и nightly **выключены** до решения владельца.
- Повтор apply с тем же fingerprint → без дублей (состояние в `onec_v3_exchange_state`).

## Production (только инструкция)

Согласованное окно, остановка конкурирующих jobs, бэкап, проверка комплекта, миграции, clean start + apply, smoke сайта. Cursor **не** выполняет эти шаги в PR.
