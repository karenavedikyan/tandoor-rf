# План исправления: блокировка regular-update из‑за holding links (draft)

**Контекст:** read-only validation файла SHA `a957ab33…` (08.10.2026, Timeweb console) — `ok=false`, 1056 issues, коды только `HOLDING_SELF_REFERENCE`, `HOLDING_CYCLE`, `HOLDING_TARGET_NOT_HOLDING_CARD`. F2–F5 в файле **присутствуют** и типы корректны.

**Не путать** с отказом 13:41 MSK (SHA не сохранён). **Не реализовывать** в production pipeline до отдельного решения.

---

## Запрещённые «быстрые» меры

- Автообнуление `guid_holding` при самоссылке.
- Автоустановка `holding=true` по эвристике «422 корня».
- Отключение `detectHoldingCycles` / `validateHoldingTargets` / политики `tolerant`.
- Apply / backfill «чтобы проверить» без прохождения validation.

---

## Вариант A — исправление источника (1С / выгрузка)

**Когда выбирать:** если владелец данных подтверждает, что самоссылка `guid_holding = guid_client` **не** является штатным обозначением корня холдинга (см. контракт в основном отчёте §3).

**Минимальные шаги:**

1. Для 422 (и связанных) записей: либо `holding=true` на карточке-корне с **пустым** или корректным `guid_holding`, либо `guid_holding=""` для корневых юрлиц, либо ссылка на **отдельную** карточку с `holding=true`.
2. Устранить кольца (Computer: часть `HOLDING_CYCLE` — потомки самоссылочных корней; проверить цепочки вроде 14→2355, 25→2660 после нормализации корней).
3. Повтор read-only: `diagnose-clients-file-validation.ts` → `firstReadWouldPass: true`.
4. Отдельно: сверка **2742** записей файла vs **3088** строк БД по GUID (shrink guards) — не смешивать с holding-fix.

---

## Вариант B — адаптация parser (только при доказанном контракте)

**Когда выбирать:** только если **письменное** согласование с 1С/бизнесом: «`guid_holding` равен `guid_client` при `holding` omitted/false = корень группы».

**Текущее свидетельство в репозитории:** такого контракта **нет** (см. `clients-field-contract.md` §3.2, `import-runbook.md` — самоссылки **всегда** блокирующие ошибки; live audit 03.10.2026 — 471 unknown + 1 `HOLDING_TARGET_NOT_HOLDING_CARD`, не 422 self-roots).

**Если контракт будет подтверждён**, минимальная адаптация (отдельный PR, не этот):

1. Явное правило в `detectHoldingCycles`: самоссылка при `holding !== true` трактуется как **корень** (не issue), с `holdingLinkState` «root_self» или аналог — **без** автоматического `holding=true` в snapshot.
2. Обход цепочки: при walk не считать возврат к такому корню `HOLDING_CYCLE` для потомков (осторожно — только для доказанного паттерна).
3. Regression-тесты на синтетике + обезличенный excerpt из SHA `a957ab33…` (без публикации PII).
4. F6 backfill / regular-update apply — только после green validation на полном файле + roster bundle.

---

## Observability (параллельно, низкий риск)

Сохранять в `onec_import_jobs.result` при `VALIDATION_FAILED`: `issueCodes`, sample `{ code, field, index, outletIndex }`, SHA256 bytes — без значений полей (отдельный PR).

---

## Решение 1С / бизнес (блокер)

Требуется **явный** выбор владельца данных (не технический default в этом PR):

| # | Путь | Когда |
|---|------|--------|
| **1** | **Исправить выгрузку** (вариант A) | 422 self-ref без `holding` — **ошибка 1С**, не корень по контракту ЛК |
| **2** | **Новый письменный контракт** + затем parser (вариант B) | 1С подтверждает: self-ref без `holding` = штатный корень группы |
| **3** | **Parser normalization** без изменения 1С | **Только** после п.2; отдельный PR; без авто-`holding=true` и без отключения cycle/self-ref checks |

До выбора: **не** apply, **не** ослабление validation, **не** «исправление» 422 эвристиками в ЛК.

---

## Рекомендация по умолчанию (диагностика 08.10.2026)

При отсутствии подтверждённого контракта самоссылки-как-корня — **вариант A** (источник) + повтор validation. Parser не менять.

---

## Проверка после исправления (read-only)

```bash
# на Computer / Timeweb console — без apply
export AUDIT_CLIENTS_PATH=/path/to/all_clients.json
node --import tsx scripts/diagnose-clients-file-validation.ts
# ожидание: ok=true, firstReadWouldPass=true
```
