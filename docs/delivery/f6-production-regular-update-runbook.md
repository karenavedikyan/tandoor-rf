# F6 — production runbook: regular-update (Computer)

**Назначение:** одно **разрешённое** штатное обновление клиентов после merge F1–F5, с дозаполнением `extended_snapshot` и проверкой идемпотентности.  
**Не выполнять** из этого документа на агенте Cursor: импорт, apply, включение cron — только инструкция для оператора на Computer.

**Предусловия:** F5 на `main` (`feb4baa` или новее); G3 — отдельный поток, не смешивать.

---

## 1. Backup и окно

1. Снимок БД ЛК (pg_dump или штатный backup) **до** apply.
2. Убедиться, что нет **висящего** `onec_client_import_runs` в `running` (см. админ-диагностику / SQL read-only).
3. Проверить **расписание** nightly regular-update: **не** включать новое расписание в рамках F6 без отдельного решения владельца; если job уже в очереди — дождаться завершения или отмены по процедуре ops.

---

## 2. Read-only проверка источника (FTP / LC)

На Computer (не в репозитории агента):

```bash
# метаданные без вывода содержимого
stat /LC/clients/all_clients.json
sha256sum /LC/clients/all_clients.json
# roster
sha256sum /LC/clients/all_employees.json
```

Зафиксировать в журнале: **дата UTC**, **SHA-256**, **число записей** (из dry-run или `jq 'length'`), **не** публиковать PII.

Сверить с historical audit `b439063…` только как **референс формы полей**, не как доказательство идентичности файла.

---

## 3. Dry-run и подтверждения

1. Запустить **regular-update dry-run** штатной командой окружения (см. `docs/delivery/` и admin UI «Обновление из 1С»).
2. Сохранить **`verificationFingerprint`** из успешного dry-run.
3. Если политика extended требует **operator confirmation** на новый bundle SHA — выполнить подтверждение **один раз** на этот fingerprint (не на каждый повтор dry-run).
4. **Запрещено:** `--force`, подмена hash, baseline replacement без отдельного runbook.

---

## 4. Apply (один раз)

1. Apply с **`--expected-fingerprint`** строго из п.3.
2. Дождаться `SUCCESS` или явного `NO_CHANGES` (если данные уже совпали).
3. При `ERROR` / `REJECTED_BY_CHECKS` — **не** повторять apply вслепую; проверить rollback (snapshot не должен остаться частично записанным — см. integration F5/F6 rollback tests).

---

## 5. Пост-проверка (read-only)

| Проверка | Как |
|----------|-----|
| Заполненность F2–F5 | выборка клиентов: доля с `wholesaleExchange`, `counterparty`, `clientContract`, `clientCode` в `extended_snapshot` |
| F1 LPR | outlet rows: `currentRetailOutlets[].lpr` не обнулились после backfill |
| Scope API | manager видит только своих; admin/director — по матрице R13 |
| Идемпотентность | повтор dry-run + apply с тем же fingerprint → **`NO_CHANGES`**, без новой success apply |

---

## 6. UI smoke (1440 / 390)

На staging или prod **после** apply (ручной чек-лист):

- Список клиентов: колонки F2–F5, фильтры clients-only, сброс при `entity=outlets`.
- Карточка: секции «Основные сведения», «Контрагент», «Договор», ЛПР на ТТ.
- Preview-as-manager: read-only, без записи review.

Эталон: [прототип F6](https://www.perplexity.ai/computer/a/4f284ecc-6d26-4f4e-9d3d-36b2b7cf314c) — расхождения фиксировать в [f6-verification-report.md](./f6-verification-report.md), **не** объявлять полное соответствие без факта.

---

## 7. F6 не закрывает серию F

Production-сверка заполненности и scope **обязательна** для закрытия F6; справочники 0..N и неподтверждённые поля остаются вне scope.
