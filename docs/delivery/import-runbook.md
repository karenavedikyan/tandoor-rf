# Runbook: регулярное обновление клиентов из 1С

**Этап:** R1.5  
**Назначение:** безопасное регулярное обновление snapshot `/LC/clients/all_clients.json` без изменения учётных записей, связей сотрудников с 1С и прав команд.

---

## 1. Принципы безопасности

- Источник — **только** согласованный plain FTP `gw.toopatch.ru`, базовый путь `/LC`, файл `clients/all_clients.json`.
- Секреты — только в env TW; не в Git, не в SQL-заданиях, не в HTTP.
- **Dry-run по умолчанию.** Apply требует `--expected-sha256` (CLI) или `expected_sha256` в задании БД.
- Apply **не удаляет** отсутствующих клиентов; уменьшение числа записей блокируется (`RECORD_COUNT_DECREASED`).
- Параллельный apply — advisory lock (`IMPORT_LOCKED` / `STALE_RUNNING_IMPORT`).
- Ночная синхронизация **не заменяет** отзыв доступа при увольнении — см. [access-rules.md](./access-rules.md).

---

## 2. Два способа запуска

### A. TW Cloud Cron → CLI (рекомендуется для расписания)

1. One-off или cron-задача на TW вызывает контейнер/окружение приложения.
2. **Шаг 1 — dry-run** (без записи в БД):
   ```bash
   node dist/cli/onec-clients-import.js --dry-run
   ```
3. Оператор сохраняет `sha256` из JSON-отчёта.
4. **Шаг 2 — apply** (только после review):
   ```bash
   node dist/cli/onec-clients-import.js --apply --expected-sha256 <64-char-hex>
   ```
5. Проверка журнала:
   ```sql
   SELECT id, started_at, finished_at, status, mode, source_record_count, error_code
   FROM onec_client_import_runs
   ORDER BY started_at DESC
   LIMIT 5;
   ```

### B. Operator DB job → worker (разовое согласованное apply)

1. Применить миграцию `006_onec_import_jobs.sql` (только по согласованному плану деплоя).
2. Оператор БД вставляет **одну** запись с `expires_at` ≤ 2 часов от `requested_at`:

   **Dry-run:**
   ```sql
   INSERT INTO onec_import_jobs (mode, expires_at)
   VALUES ('dry_run', NOW() + INTERVAL '1 hour');
   ```

   **Apply** (после успешного dry-run и согласования):
   ```sql
   INSERT INTO onec_import_jobs (mode, expected_sha256, expires_at)
   VALUES ('apply', '<64-char-sha256-from-dry-run>', NOW() + INTERVAL '1 hour');
   ```

3. Запуск worker **один из**:
   - перезапуск приложения (startup hook), или
   - `npm run onec-import-job-worker` / TW cron на эту команду.

4. Результат — только из БД (`onec_import_jobs.result`, `import_run_id`). HTTP-доступа к таблице нет.

---

## 3. Рекомендуемое расписание (до ответов 1С по E2)

| Параметр | Рекомендация |
|----------|--------------|
| Частота | 1× в сутки после окна выгрузки 1С (уточнить у 1С-специалиста) |
| Порядок | dry-run → review → apply с тем же SHA |
| Мониторинг | `onec_client_import_runs`, admin UI «Статус синхронизации», алерт при `failed` / `running` > 30 мин |

**Открыто (1С):** E1 snapshot vs delta, E2 метка времени файла, E3 архив FTP — см. [exchange-rules.md](./exchange-rules.md), [onec-specialist-questions.md](./onec-specialist-questions.md).

---

## 4. Коды ошибок и действия

| Код / статус | Значение | Действие оператора |
|--------------|----------|-------------------|
| `SUCCESS` | Файл принят | Проверить counts в журнале / UI |
| `VALIDATION_FAILED` | Ошибки в записях | Эскалация 1С; apply не выполнять |
| `HASH_MISMATCH` | Файл изменился между dry-run и apply | Повторить dry-run, новый SHA |
| `RECORD_COUNT_DECREASED` | Меньше записей, чем в БД | Согласовать с 1С; не форсировать apply |
| `IMPORT_LOCKED` | Другой apply в процессе | Подождать или разобрать параллельный запуск |
| `STALE_RUNNING_IMPORT` | Зависший `running` в журнале | SQL-разбор; не запускать apply до закрытия |
| `FTP_ERROR` / `TIMEOUT` | FTP недоступен | Проверить TW egress, учётные данные, сеть |
| `IMPORT_JOB_FAILED` | Worker: конфиг / внутренняя ошибка | Проверить env FTP, логи worker |

---

## 5. Откат

1. **Откат кода** — предыдущий коммит; данные БД не меняются автоматически.
2. **Откат данных** — только из backup PostgreSQL или согласованного SQL-плана.
3. CLI **не восстанавливает** и **не удаляет** клиентов автоматически.

---

## 6. Что runbook не делает

- Не создаёт и не меняет `users`, `user_onec_employee_links`, `access_grants`, `rop_team_members`.
- Не включает production-расписание сам по себе — cron/TW настраивает оператор после приёмки PR.
- Не закрывает пилот — см. [pilot-checklist.md](./pilot-checklist.md).
