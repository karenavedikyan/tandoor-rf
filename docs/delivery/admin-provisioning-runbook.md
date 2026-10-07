# Выдача учётной записи администратора (подготовительный режим)

**Production-доступ не создавать в рамках подготовительного PR.** Ниже — процедура для согласованной выдачи после деплоя инструментов.

## Кандидат (пример)

| Поле | Значение |
|------|----------|
| ФИО | Артём Зайченко |
| Email / логин | `a.zaychenko@tandoors.ru` |
| Должность | программист 1С |
| Роль ЛК | `admin` (интерфейс администратора) |

Привязку к сотруднику 1С **не выполнять автоматически** по ФИО или email. Связь `user_onec_employee_links` оформляется отдельно через «Доступ» с явным `employee_id` и основанием.

## 1. Проверка существующего аккаунта

```bash
npm run grant-admin-access:local -- inspect --email a.zaychenko@tandoors.ru
```

Интерпретация JSON:

- `exists: false` — можно создавать новую учётную запись.
- `exists: true`, `role: admin`, `provisionState: delivered` — **остановиться**, дубликат не создавать.
- `exists: true`, `provisionState: pending_delivery` — незавершённая выдача; повтор `grant` безопасно продолжит доставку пароля.
- `exists: true`, другая роль — только `--assign-admin-role` (пароль **не** меняется).
- `employeeLinks` не пустой — проверить, что привязка корректна; CLI **не создаёт** новых связей.

## 2. Персональный аудит

Просмотреть `personalAudit` из вывода `inspect` и журнал «Доступ → Аудит» в ЛК.

Выдача допустима только после явного подтверждения просмотра (флаг `--confirm-audit-reviewed`).

## 3. Создание admin (новый пользователь)

Перед `grant` CLI проверяет канал доставки (TTY или путь к файлу). Файл создаётся **эксклюзивно** (`O_EXCL`, mode `0600`); существующий файл и symlink не принимаются.

До подтверждения доставки учётная запись создаётся со статусом `disabled` — войти нельзя. После успешной записи пароля CLI активирует аккаунт и пишет `user.provision_delivery_confirmed`.

Если подтверждение COMMIT потеряно — **не полагаться на ROLLBACK** и не проверять только наличие email. CLI сверяет **`provision_operation_id`** в `user.provision_operation_committed`. При неизвестном исходе — fail-closed (пароль не выдаётся, аккаунт не активируется). Повторный `grant` при `pending_delivery` продолжает **актуальную** операцию; замещённые (`user.provision_operation_superseded` / `resumed_operation_id`) не восстанавливаются.

Если доставка не удалась — аккаунт остаётся `disabled`, в аудит пишется `user.provision_incomplete` (без удаления пользователя).

```bash
npm run grant-admin-access:local -- grant \
  --email a.zaychenko@tandoors.ru \
  --full-name "Артём Зайченко" \
  --actor-user-id "<UUID активного admin>" \
  --basis "Согласование … (дата, документ, инициатор HR/ИБ)" \
  --confirm-audit-reviewed \
  --password-delivery file:/secure/path/zaychenko-temp-password.txt
```

- Временный пароль записывается **только** в указанный файл (`0600`) или на интерактивный TTY.
- **Не** помещать пароль в PR, отчёты, тикеты, логи приложения.
- Передать получателю по защищённому каналу; файл удалить после передачи.

В журнал `access_audit_log` попадают записи `user.create`, `user.password_set` с `actor_user_id` инициатора и текстом `basis`.

## 4. Назначение admin существующему пользователю

Если `inspect` показал существующую учётную запись с другой ролью:

```bash
npm run grant-admin-access:local -- grant \
  --email a.zaychenko@tandoors.ru \
  --full-name "Артём Зайченко" \
  --actor-user-id "<UUID>" \
  --basis "…" \
  --confirm-audit-reviewed \
  --assign-admin-role
```

Пароль не изменяется. Аудит: `user.role_assign`.

## 5. Смена временного пароля

После первого входа UI перенаправляет на `/change-password`. Новый пароль не может совпадать с текущим. Смена пароля, снятие `password_must_change`, отзыв остальных сессий и запись аудита выполняются **атомарно**; при ошибке аудита транзакция откатывается.

До смены пароля API (кроме `/api/auth/me`, `/api/profile/self`, `/api/profile/change-password`, logout) возвращает `403 PASSWORD_CHANGE_REQUIRED`.

Аудит: `user.password_change`.

## 5.1 Аудит действий сотрудника

В «Доступ → Аудит действий сотрудника» (фильтр по userId и дате):

- **Изменения учётной записи** — события, где сотрудник является субъектом (`entity_type=user`).
- **Действия сотрудника** — события, где он `actor_user_id` (права, импорт 1С, дистрибуция, ревизии клиентов и т.д.).

Ревизии клиентов берутся из `client_review_history` (`changed_by_user_id`, GUID клиента, `change_type`, before/after). Экспорт/выгрузки в ЛК **не реализованы** — отдельного журнала нет.

Матрица покрытия отображается в UI; `--confirm-audit-reviewed` **не** означает полный аудит всех подсистем. Preview фиксирует admin как исполнителя.

## 6. Проверка

```sql
SELECT email, role, status, password_must_change FROM users WHERE email = 'a.zaychenko@tandoors.ru';

SELECT action, basis, created_at
FROM access_audit_log
WHERE entity_type = 'user'
  AND entity_id = (SELECT id FROM users WHERE email = 'a.zaychenko@tandoors.ru')
ORDER BY created_at;
```

Убедиться, что записей в `user_onec_employee_links` нет, если привязка ещё не согласована.
