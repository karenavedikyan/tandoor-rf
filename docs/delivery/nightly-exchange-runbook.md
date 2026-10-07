# Ночной обмен 1С (regular_update_bundle)

Подготовительный режим: по умолчанию **выключен**. Production-расписание и env не менять без согласования с операторами.

## Что делает

- В заданное **московское** время ставит в очередь одно задание `regular_update_bundle` с `nightly_window_key` и `nightly_window_deadline_at`.
- Worker и apply проверяют дедлайн окна; просроченное `pending` завершается без FTP/записей.
- При `ONEC_NIGHTLY_EXCHANGE_ENABLED=false` ожидающие nightly jobs не запускаются (startup drain / kick).
- Ручные `admin_manual` jobs **не** ограничены ночным окном.
- Окно может пересекать полночь MSK; ключ окна — календарная дата **начала** окна.

## Переменные окружения

| Переменная | По умолчанию | Назначение |
|------------|--------------|------------|
| `ONEC_NIGHTLY_EXCHANGE_ENABLED` | `false` | Включить in-process тик (60 с) и CLI tick |
| `ONEC_NIGHTLY_EXCHANGE_TIME` | — | **Обязательно** при enabled: HH:MM Europe/Moscow |
| `ONEC_NIGHTLY_EXCHANGE_WINDOW_MINUTES` | — | **Обязательно** при enabled: 1–180 |

При `enabled=false` время и длительность не читаются. При `enabled=true` неверное или пустое значение → ошибка конфигурации; **fallback на 02:30 нет**. Ошибка блокирует только nightly scheduler/CLI, не ЛК и не ручное обновление.

FTP и БД — те же, что для regular update (`ONEC_FTP_*`, `DATABASE_URL`).

Файлы: `/LC/clients/all_clients.json`, `/LC/clients/all_employees.json`.  
`export_bundle_manifest.json` **не обязателен** — nightly использует тот же путь, что ручная кнопка и CLI.  
Стабильное чтение не доказывает единый выпуск 1С; `sourceExportAt` остаётся null без manifest от 1С.

## Включение (после согласования)

1. Убедиться, что ручное обновление из 1С и regular update проходят на staging.
2. Задать **все три** переменные с согласованными значениями.
3. Перезапустить приложение **или** настроить внешний cron (см. ниже).
4. Проверить журнал и `GET /api/admin/clients/onec-update/status` — источник «Ночной обмен».

## Отключение

- `ONEC_NIGHTLY_EXCHANGE_ENABLED=false` и перезапуск.
- Pending nightly jobs будут завершены со статусом `NIGHTLY_SCHEDULE_DISABLED` при следующем drain/kick (running не прерывается).

## Проверка

```bash
npm run onec-nightly-exchange-tick:local
# disabled → {"status":"disabled"}
# invalid enabled config → {"status":"config_error",...}, exit code 2

curl -s -b cookies.txt http://127.0.0.1:3000/api/admin/clients/onec-update/status | jq .

SELECT job_source, status, error_code, nightly_window_key, nightly_window_deadline_at
FROM onec_import_jobs WHERE kind = 'regular_update_bundle' ORDER BY requested_at DESC LIMIT 5;
```

## Внешний планировщик (опционально)

Cron должен вызывать tick **только внутри согласованного MSK-окна**. Не использовать диапазон часов `23-0` — он некорректен в cron.

Пример ( **не активировать в production без согласования** ): отдельные строки на каждый час окна или `@hourly` с проверкой внутри CLI (tick сам вернёт `outside_window` вне окна):

```cron
# Каждую минуту с 02:30 до 03:29 MSK — задайте UTC-эквивалент для вашего сезона явно, без 23-0:
# */1 23  * * *  ... ONEC_NIGHTLY_EXCHANGE_ENABLED=true ONEC_NIGHTLY_EXCHANGE_TIME=02:30 ONEC_NIGHTLY_EXCHANGE_WINDOW_MINUTES=60 npm run onec-nightly-exchange-tick
# */1 0   * * *  ... (продолжение того же 60-минутного окна, если оно пересекает 03:00 UTC)
```

Проще: in-process scheduler на инстансе + `ONEC_NIGHTLY_EXCHANGE_ENABLED=true` и валидные TIME/WINDOW.

## Параметры для согласования

- Время и длина окна MSK (в т.ч. пересечение полуночи).
- In-process vs external cron.
- Политика при совпадении с ручным обновлением (одно активное job).
