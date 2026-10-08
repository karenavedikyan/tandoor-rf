# F6 — матрица приёмки F1–F5 (цепочка данных)

**Base:** `main` @ `feb4baa` (F5 / PR #69)  
**Источник JSON (исторический, не текущая FTP):** audit **04.10.2026**, SHA `b439063…`, [recovered-exchange-structure.json](../../test/fixtures/onec-clients/recovered-exchange-structure.json).  
**Правило F1:** legacy fallback для ЛПР без `fieldPresence` — см. [remaining-exchange-fields-map.md §7](./remaining-exchange-fields-map.md).

Легенда API: list = `GET /api/clients`, card = `GET /api/clients/:guid`.  
Колонки/фильтры: `public/clients-logic.js`, `field-filter-registry.ts`.

---

## F1 — ЛПР и бонусы (торговая точка)

| JSON-путь | Snapshot | API list (entity=outlets) | API card | Карточка UI | Колонка | Фильтр | Тест |
|-----------|----------|---------------------------|----------|-------------|---------|--------|------|
| `retail_outlets[].LPR_information.name` | `currentRetailOutlets[].lpr.name` + presence | `lpr.name` | `extended.retailOutlets[].lpr.name` | Контакт ЛПР | `lprName` | `lprNameContains`, filled/empty | F1 suite; `clients-f1-lpr-filters.browser.test.ts` |
| `…post` | `lpr.post` | `lpr.post` | card | да | `lprPost` | `lprPostContains`, filled/empty | F1 |
| `…phone` | `lpr.phone` | `lpr.phone` | card | да | `lprPhone` | `lprPhoneContains`, filled/empty | F1 |
| `…email` | `lpr.email` | `lpr.email` | card | да | `lprEmail` | `lprEmailContains`, filled/empty | F1 |
| `…date_of_birth` | sentinel / empty semantics | `lpr.dateOfBirth` | card | да | `lprDateOfBirth` | ISO range, filled/empty | F1 |
| `…bonus` | string; `"0"` = значение | `lpr.bonus` | card | Бонусные условия | `lprBonus` | contains, filled/empty | F1 |
| `…conditions_bonus` | string | `lpr.conditionsBonus` | card | да | `lprConditionsBonus` | contains, filled/empty | F1 |

---

## F2 — ТОП-150 и категория 1С (клиент)

| JSON-путь | Snapshot | API list (entity=clients) | API card | Карточка UI | Колонка | Фильтр | Тест |
|-----------|----------|---------------------------|----------|-------------|---------|--------|------|
| `Оптовик_Топ150` | `wholesaleExchange.top150` | `onecTop150` | `extended.wholesaleExchange.top150` | ТОП-150 (1С) | `onecTop150` | `onecTop150`, filled/empty | `onec-f2-*`, `clients-f2-*`, browser F2 |
| `Оптовик_КатегорияТорговойТочкиТандор` | `wholesaleExchange.outletCategory` | `onecCategory` | `extended.wholesaleExchange.outletCategory` | Категория 1С | `onecCategory` | `onecCategory`, filled/empty | F2 (не A/B/C/D→TOP) |

---

## F3 — контрагент (клиент)

| JSON-путь | Snapshot | API list | API card | Карточка UI | Колонка | Фильтр | Тест |
|-----------|----------|----------|----------|-------------|---------|--------|------|
| `Контрагент` | `counterparty.counterparty` | `onecCounterparty` | `extended.counterparty.counterparty` | Контрагент | `onecCounterparty` | contains, filled/empty | F3 integration/browser |
| `НаименованиеПолное` | `counterparty.fullName` | `onecFullName` | card | Полное наименование | `onecFullName` | contains, filled/empty | F3 |
| `ЮрФизЛицо` | `counterparty.legalEntityType` | `onecLegalEntityType` | card | Тип | `onecLegalEntityType` | exact, filled/empty | F3 |
| `Оптовик_ОГРН` | `counterparty.ogrn` (string) | `onecOgrn` | card | ОГРН | `onecOgrn` | exact, filled/empty | F3 |

---

## F4 — договор и соглашение (клиент)

| JSON-путь | Snapshot | API list | API card | Карточка UI | Колонка | Фильтр | Тест |
|-----------|----------|----------|----------|-------------|---------|--------|------|
| `Оптовик_ОсновнойДоговор` | `clientContract.primaryContract` | `onecPrimaryContract` | `extended.clientContract.primaryContract` | Основной договор (1С) | `onecPrimaryContract` | contains, filled/empty | F4 |
| `Оптовик_ОсновноеСоглашение` | `clientContract.mainAgreement` | `onecMainAgreement` | card | Основное соглашение (1С) | `onecMainAgreement` | contains, filled/empty | F4 |

---

## F5 — код клиента

| JSON-pуть | Snapshot | API list | API card | Карточка UI | Колонка | Фильтр | Тест |
|-----------|----------|----------|----------|-------------|---------|--------|------|
| `Код` | `clientCode.code1c` + `fieldPresence.code1c` | `code1c` | `extended.clientCode.code1c` | Код 1С | `code1c` | `onecCode1c`, `onecCode1cContains`, filled/empty=`code1c` | F5 unit/integration/browser |

**Семантика F5 filled/empty:** no-source (нет блока / `fieldPresence` false) ≠ explicit `null`/`""` («Не заполнено»); `"0"` и ведущие нули — filled.

---

## F6 — сквозная проверка (test DB)

| Сценарий | Ожидание | Тест |
|----------|----------|------|
| Старый snapshot без F2–F5, LPR на месте | один SUCCESS backfill F2–F5, LPR сохранён | `onec-f6-combined-f2-f5-backfill.test.ts` |
| Повтор того же bundle | `NO_CHANGES`, без новой success apply | F6 + F2–F5 backfill suites |
| omitted / `""` / rollback | по контракту F3–F5 | F6 combined + F5 C/D |

---

## Неподтверждённые (матрица **не** заполняется)

| UI / ожидание | Статус источника |
|---------------|------------------|
| `inn`, `kpp`, `city`, `cashback` | ключи **не** подтверждены в audit 04.10 |
| TOP-350/500, legacy `category` | **не** подтверждены; **≠** `onecCategory` |
| Справочники юрлиц/договоров 0..N | массивы **не** найдены в audit 04.10 |
