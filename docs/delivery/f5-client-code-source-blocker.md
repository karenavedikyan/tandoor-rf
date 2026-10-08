# F5 — код клиента 1С (`Код`)

**Дата (UTC):** 2026-10-08  
**Base:** `main` @ `bd19338` (F4 merged, PR #68)  
**Draft PR:** #69  
**Статус F5:** **реализован в подтверждённом объёме** — одно строковое поле клиента из снимка 04.10.2026; **не** завершает всю серию F и **не** F6.

## Источник F5

| JSON-путь | Snapshot | Тип |
|-----------|----------|-----|
| `Код` | `extended_snapshot.clientCode.code1c` + `fieldPresence.code1c` | string as-is |

SHA снимка: `b439063b1602743ab1df56ee6390ba9d3cc64dce7cdc24763c3d4d7176c74b74`. Fixture: `test/fixtures/onec-clients/recovered-exchange-structure.json`.

## Контракт `code1c` (F5)

| Семантика | JSON | Snapshot после merge | List DTO | Карточка | SQL `filled`/`empty` |
|-----------|------|----------------------|----------|----------|----------------------|
| **Не передано** | ключ omitted | блок/`fieldPresence.code1c` = false (или блок отсутствует) | поле `code1c` **отсутствует** | `clientCode` = null | **не** попадает ни в filled, ни в empty |
| **Явно пусто** | `null` или `""` | `fieldPresence.code1c` = true, значение null/"" | `hasSource: true`, label «Не заполнено», value null | то же | `empty=code1c` |
| **Значение** | string (в т.ч. `"0"`, ведущие нули) | as-is | `hasSource: true`, label = строка | «Код 1С» | `filled=code1c`, `onecCode1c`, `onecCode1cContains` |

Parser: только `string`; иные типы → `INVALID_CLIENT_CODE_EXCHANGE_FIELD` до apply. Код **не** генерируется из GUID.

**Важно (не только F5):** для **F1 (ЛПР)** при отсутствии `fieldPresence` действует **legacy fallback** — непустые скаляры и маркеры DOB могут считаться переданными; это **не** правило для `clientCode` (только явный `fieldPresence.code1c`).

## Покрытие по полям F1–F5 (проверка цепочки)

Колонки: `public/clients-logic.js`. Карточка: `public/client-card-prototype.js`. List/card DTO: `src/clients/dto.ts`, `extended-dto.ts`.

### F1 — ЛПР и бонусы (уровень ТТ)

| JSON-путь | Snapshot | DTO (list/card) | Карточка | Колонка | Фильтр / entity | Тест |
|-----------|----------|-----------------|----------|---------|-----------------|------|
| `retail_outlets[].LPR_information.name` | `currentRetailOutlets[].lpr` + presence | `lpr.name` | Контакт ЛПР | `lprName` | contains + filled/empty; **outlets** | F1 на `main` |
| `…post` | да | `lpr.post` | да | `lprPost` | `lprPost*` | F1 |
| `…phone` | да | `lpr.phone` | да | `lprPhone` | `lprPhone*` | F1 |
| `…email` | да | `lpr.email` | да | `lprEmail` | `lprEmail*` | F1 |
| `…date_of_birth` | sentinel/empty | `lpr.dateOfBirth` | да | `lprDateOfBirth` | date + filled/empty | F1 |
| `…bonus` | string (`"0"` = значение) | `lpr.bonus` | Бонусные условия | `lprBonus` | `lprBonus*` | F1 |
| `…conditions_bonus` | string | `lpr.conditionsBonus` | да | `lprConditionsBonus` | `lprConditionsBonus*` | F1 |

### F2 — ТОП-150 и категория 1С (клиент)

| JSON-путь | Snapshot | List DTO | Карточка | Колонка | Фильтр / entity | Тест |
|-----------|----------|----------|----------|---------|-----------------|------|
| `Оптовик_Топ150` | `wholesaleExchange.top150` | `onecTop150` | ТОП-150 (1С) | `onecTop150` | exact + filled/empty; **clients** | `onec-f2-*`, `clients-f2-*`, browser F2 |
| `Оптовик_КатегорияТорговойТочкиТандор` | `wholesaleExchange.outletCategory` | `onecCategory` | Категория 1С | `onecCategory` | exact + filled/empty; **clients** | то же (A/B/C/D **≠** TOP) |

### F3 — контрагент (клиент)

| JSON-путь | Snapshot | List DTO | Карточка | Колонка | Фильтр / entity | Тест |
|-----------|----------|----------|----------|---------|-----------------|------|
| `Контрагент` | `counterparty.counterparty` | `onecCounterparty` | Контрагент | `onecCounterparty` | contains + filled/empty | `clients-f3-*`, browser F3 |
| `НаименованиеПолное` | `counterparty.fullName` | `onecFullName` | Полное наименование | `onecFullName` | contains + filled/empty | F3 |
| `ЮрФизЛицо` | `counterparty.legalEntityType` | `onecLegalEntityType` | Тип | `onecLegalEntityType` | exact + filled/empty | F3 |
| `Оптовик_ОГРН` | `counterparty.ogrn` | `onecOgrn` | ОГРН | `onecOgrn` | exact + filled/empty | F3 |

### F4 — договор и соглашение (клиент)

| JSON-путь | Snapshot | List DTO | Карточка | Колонка | Фильтр / entity | Тест |
|-----------|----------|----------|----------|---------|-----------------|------|
| `Оптовик_ОсновнойДоговор` | `clientContract.primaryContract` | `onecPrimaryContract` | Основной договор (1С) | `onecPrimaryContract` | contains + filled/empty | `clients-f4-*`, browser F4 |
| `Оптовик_ОсновноеСоглашение` | `clientContract.mainAgreement` | `onecMainAgreement` | Основное соглашение (1С) | `onecMainAgreement` | contains + filled/empty | F4 |

### F5 — код клиента

| JSON-путь | Snapshot | List DTO | Карточка | Колонка | Фильтр / entity | Тест |
|-----------|----------|----------|----------|---------|-----------------|------|
| `Код` | `clientCode.code1c` | `code1c` | Код 1С | `code1c` | `onecCode1c`, `onecCode1cContains`, filled/empty=`code1c`; **clients** | `onec-clients-client-code-exchange-fields.test.ts`, `clients-f5-code-fields.test.ts`, `onec-f5-client-code-upgrade-backfill.test.ts`, `clients-f5-code-filters.browser.test.ts` |

## Обмен / backfill (F5)

Gate при том же verification fingerprint: roster + wholesale + counterparty + clientContract + **clientCode**. После backfill **A**, omitted **Код**, явной очистки `""` / `null` — повтор **того же bundle** → `NO_CHANGES` без новой успешной apply-записи; confirmation на повтор **не** создаётся. Rollback **D** — см. integration test (без переписывания pipeline).

## F6 (scope, не автоматические справочники)

**F6** = согласованное **дозаполнение и сверка реальных данных** в prod/test после merge F2–F5 (extended gate, backfill, без force/substitution hash). **Не** означает автоматическую реализацию справочников юрлиц/договоров **0..N** — для них нужны подтверждённые ключи/GUID в JSON (§1.4 карты полей).

## Неподтверждённые поля (контракт не выдумывается)

| UI / ожидание | Источник в audit 04.10 | Статус |
|---------------|------------------------|--------|
| `inn`, `kpp` | отдельных ключей **нет** | колонка `inn` `hasSource: false` |
| `city` | отдельного ключа **нет** (адрес — одна строка) | `hasSource: false` |
| `cashback` (client/outlet) | в extended audit **нет** | `hasSource: false` |
| TOP-350 / TOP-500 | ключи **не** подтверждены | колонка `category` `hasSource: false`; **≠** `onecCategory` |
| Справочник юрлиц 0..N | массив **не** найден | вне F5 |
| Справочник договоров 0..N | массив **не** найден | вне F5 |

## Прототип UI

Соответствие [Perplexity-прототипу](https://www.perplexity.ai/computer/a/tandoor-rf-vizualnyi-prototip-TyhOzG0mT06dPTayt88xTA) **не проверялось** в PR #69 (нет фактического side-by-side в этой сессии). Это **открытый** пункт; подтверждённые проверки **кода 1С** (API, SQL, mock-browser) от него **не** зависят.

## Статус наполнения данных

| Слой | Статус |
|------|--------|
| Draft PR #69 | parser, snapshot, API, UI, gate, backfill A–D + C, per-field matrix |
| Merge/deploy | **нет** |
| Реальный обмен 1С | **нет** — синтетика / mock-browser |

Серия F **не** закрыта.
