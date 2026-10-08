# F6 — production runbook: regular-update (Computer)

**Назначение:** одно **разрешённое** штатное обновление клиентов после merge F1–F5, с дозаполнением `extended_snapshot` и проверкой идемпотентности.  
**Не выполнять** из этого документа на агенте Cursor: импорт, apply, включение cron — только инструкция для оператора на Computer.

**Предусловия:** F5 на `main` (`feb4baa` или новее); G3 — отдельный поток, не смешивать.

---

## 1. Backup, окно и очередь

1. Снимок БД ЛК (pg_dump или штатный backup) **до** apply.
2. **Остановиться**, если активна очередь обмена (read-only SQL / админ-диагностика):
   - `onec_import_jobs` со статусом `pending` или `running` (в т.ч. `regular_update_bundle`, nightly, ручные job);
   - `onec_client_import_runs` со статусом `running`.
3. При активной очереди **не** запускать apply и **не** отменять задачи автоматически — дождаться завершения или явной ops-процедуры отмены.
4. Проверить **расписание** nightly regular-update: **не** включать новое расписание в рамках F6 без отдельного решения владельца.

---

## 2. Read-only проверка **свежего источника** (FTP / LC)

Пути вида `/LC/clients/all_clients.json` — это **базовый путь на FTP** (`ONEC_FTP_BASE_PATH`, обычно `/LC`), а **не** гарантированный локальный путь на диске Computer.

На Computer:

1. Получить файлы **штатным read-only способом** (тот же механизм, что использует regular-update: FTP-клиент окружения, admin probe «Обновление из 1С», или локальная копия после скачивания worker'ом). Зафиксировать **фактический локальный путь** скачанного файла.
2. На этой копии (без вывода PII в публичные каналы):

```bash
stat /path/to/local/all_clients.json
sha256sum /path/to/local/all_clients.json
sha256sum /path/to/local/all_employees.json
```

3. Зафиксировать в журнале: **дата UTC**, **SHA-256**, **число записей** (из dry-run или `jq 'length'` на локальной копии).

**Historical audit** (`test/fixtures/onec-clients/recovered-exchange-structure.json`, SHA `b439063…`) — только **референс формы полей** и статистика прошлого снимка; **не** доказательство идентичности текущего FTP-файла и **не** замена п.2.

---

## 3. Dry-run и подтверждения

1. Запустить **regular-update dry-run** штатной командой окружения (см. `docs/delivery/import-runbook.md` и admin UI «Обновление из 1С»).
2. Сохранить **`verificationFingerprint`** из успешного dry-run.
3. Если политика extended требует **operator confirmation** на новый bundle SHA — выполнить подтверждение **один раз** на этот fingerprint (не на каждый повтор dry-run).
4. **Запрещено:** `--force`, подмена hash, baseline replacement без отдельного runbook.

---

## 4. Apply (один раз, согласованный объём)

1. Apply с **`--expected-fingerprint`** строго из п.3 — **один** production apply в рамках согласованного окна F6.
2. Дождаться `SUCCESS` или явного `NO_CHANGES` (если данные уже совпали).
3. При `ERROR` / `REJECTED_BY_CHECKS` — **не** повторять apply вслепую; проверить rollback (snapshot не должен остаться частично записанным — см. integration F5/F6 rollback tests).

---

## 5. Пост-проверка: **состояние production БД** (read-only)

Отделить от п.2 (свежий FTP) и от historical audit:

| Проверка | Как |
|----------|-----|
| F2–F5 по полям | Агрегаты **по каждому полю** F2–F5 в `extended_snapshot` для клиентов, попавших в **тот же подтверждённый bundle**, что и apply: filled / empty / omitted / clear — по правилам F2–F5 (не одна бинарная «есть блок»). Сверить с ожиданиями dry-run diff для этого fingerprint. |
| F1 LPR | Outlet rows: `currentRetailOutlets[].lpr` не обнулились после backfill; bonus `"0"` сохраняется как значение. |
| Scope API | manager — только назначенные ТТ; admin/director — по матрице R13. |
| Идемпотентность | **Локально** (test-БД): повтор apply с тем же fingerprint → `NO_CHANGES`. **В production:** повторный apply **запрещён** без отдельного явного разрешения и нового согласованного объёма (второй apply — не «автоматическая пост-проверка»). |

---

## 6. UI smoke (1440 / 390)

На staging или prod **после** apply (ручной чек-лист):

- Список клиентов: колонки F2–F5, фильтры clients-only, сброс при `entity=outlets`.
- Карточка: раскрытые значения F2–F5, ЛПР на доступной ТТ.
- Preview-as-manager: read-only, без записи review.

**Эталон:** [прототип F6](https://www.perplexity.ai/computer/a/4f284ecc-6d26-4f4e-9d3d-36b2b7cf314c) — **недоступность прототипа** для автоматической сверки остаётся открытым пунктом; расхождения фиксировать в [f6-verification-report.md](./f6-verification-report.md) только по **подтверждённым** фактам, не по предположениям.

---

## 7. F6 не закрывает серию F

Production-сверка заполненности и scope **обязательна** для закрытия F6; справочники 0..N и неподтверждённые поля остаются вне scope.
