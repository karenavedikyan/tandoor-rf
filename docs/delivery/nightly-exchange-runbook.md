# Ночной обмен 1С (regular_update_bundle)

Подготовительный режим: по умолчанию **выключен**. Production-расписание и env не менять без согласования с операторами.

## Что делает

- В заданное **московское** время ставит в очередь одно задание `regular_update_bundle`.
- Обработка — тем же worker, что и кнопка «Обновить из 1С» (manifest, fingerprint, roster shrink, import lock, COMMIT_UNCERTAIN).
- Пропущенное окно **не догоняется** днём; повтор в том же календарном окне блокируется.
- Несколько экземпляров приложения координируются через advisory lock и `onec_exchange_state.nightly_exchange_last_window`.

## Переменные окружения

| Переменная | По умолчанию | Назначение |
|------------|--------------|------------|
| `ONEC_NIGHTLY_EXCHANGE_ENABLED` | `false` | Включить in-process тик (60 с) и CLI tick |
| `ONEC_NIGHTLY_EXCHANGE_TIME` | `02:30` | Начало окна, HH:MM **Europe/Moscow** (пример, не production) |
| `ONEC_NIGHTLY_EXCHANGE_WINDOW_MINUTES` | `60` | Длина окна в минутах |

FTP и БД — те же, что для regular update (`ONEC_FTP_*`, `DATABASE_URL`).

## Включение (после согласования)

1. Убедиться, что ручное обновление из 1С и regular update проходят на staging.
2. Выставить согласованное `ONEC_NIGHTLY_EXCHANGE_TIME` (MSK).
3. `ONEC_NIGHTLY_EXCHANGE_ENABLED=true` на нужных инстансах **или** внешний cron (см. ниже).
4. Перезапустить приложение; проверить журнал заданий и `GET /api/admin/clients/onec-update/status` — источник «Ночной обмен».

## Отключение

- `ONEC_NIGHTLY_EXCHANGE_ENABLED=false` (или удалить переменную) и перезапуск.
- Либо убрать cron-строку. Уже поставленные `pending`/`running` job не отменяются автоматически — дождаться завершения или разобрать оператором.

## Проверка

```bash
# один тик (disabled → {"status":"disabled"})
npm run onec-nightly-exchange-tick:local

# статус последнего job (admin API)
curl -s -b cookies.txt http://127.0.0.1:3000/api/admin/clients/onec-update/status | jq .

# SQL: источник job и trigger_source журнала
SELECT job_source, status, error_code, result->>'exportBatchId' FROM onec_import_jobs WHERE kind = 'regular_update_bundle' ORDER BY requested_at DESC LIMIT 5;
SELECT trigger_source, status, error_code FROM onec_client_import_runs ORDER BY started_at DESC NULLS LAST LIMIT 5;
```

## Внешний планировщик (опционально)

In-process тик можно не использовать: cron вызывает CLI раз в минуту **только в согласованном окне**.

Пример для Timeweb ( **не активировать в production без согласования** ):

```cron
# m h dom mon dow — каждую минуту с 02:30 до 03:29 MSK ≈ 23:30–00:29 UTC (зима/лето уточнять!)
# */1 23-0 * * * cd /app && ONEC_NIGHTLY_EXCHANGE_ENABLED=true ONEC_NIGHTLY_EXCHANGE_TIME=02:30 npm run onec-nightly-exchange-tick >> /var/log/onec-nightly.log 2>&1
```

При external cron достаточно `ONEC_NIGHTLY_EXCHANGE_ENABLED=true` на время вызова CLI; `startNightlyExchangeScheduler` в server можно оставить выключенным.

## Параметры для согласования с операторами

- Время окна MSK (`ONEC_NIGHTLY_EXCHANGE_TIME`, длина окна).
- In-process vs external cron vs оба (не рекомендуется).
- Политика при совпадении с ручным обновлением (сейчас: одно активное job, ночной tick помечает окно и не создаёт дубликат).
