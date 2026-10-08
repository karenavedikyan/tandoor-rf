# F5 — код клиента 1С (`Код`)

**Дата (UTC):** 2026-10-08  
**Base:** `main` @ `bd19338` (F4 merged, PR #68)  
**Статус F5:** **реализован в подтверждённом объёме** — одно строковое поле клиента из снимка 04.10.2026; закрывает колонку-заглушку `code1c` и сверку F1–F4 на пропуски; **не** завершает всю серию F и **не** F6.

## Источник

| Поле | JSON-ключ | Snapshot `extended_snapshot.clientCode` |
|------|-----------|----------------------------------------|
| Код 1С | `Код` | `code1c` (строка as-is, ведущие нули сохраняются) |

SHA снимка: `b439063b1602743ab1df56ee6390ba9d3cc64dce7cdc24763c3d4d7176c74b74`. Fixture: `test/fixtures/onec-clients/recovered-exchange-structure.json`.

**Не в F5:** генерация кода из GUID; ИНН/КПП/city/cashback; TOP-350/500; подмена `category` за `onecCategory`; маппинг A/B/C/D в ТОП.

## Контракт parser

- Только `string` as-is; omitted → merge; `null` / `""` — явная очистка только `code1c`.
- Иные типы → `INVALID_CLIENT_CODE_EXCHANGE_FIELD` до apply.

## ЛК

Parser → snapshot → list/card DTO → колонка `code1c` (`hasSource: true`) → фильтры clients-only: `onecCode1c` (exact), `onecCode1cContains`, `filled`/`empty`=`code1c`; URL/reload/reset; сброс при `entity=outlets`. Карточка: «Код 1С» в «Основные сведения и холдинг».

## Backfill после публикации

При том же verification fingerprint: gate сравнивает roster + wholesale + counterparty + clientContract + **clientCode** → один SUCCESS дозаполнения, повтор → `NO_CHANGES`. Другой fingerprint — полный apply со всеми guards.

## Матрица F1–F5 (компактная)

| JSON / область | Snapshot | List DTO | Карточка | Колонка | Фильтры | entity | Тесты |
|----------------|----------|----------|----------|---------|---------|--------|-------|
| **F1** ЛПР/бонусы (ТТ) | `currentRetailOutlets[].lpr` | outlet rows | ЛПР / бонусы | LPR cols | outlet scope | outlets + same-outlet EXISTS | F1 suite (main) |
| **F2** `Оптовик_Топ150` | `wholesaleExchange.top150` | `onecTop150` | ТОП-150 | `onecTop150` | exact + filled/empty | clients | F2 unit/integration/browser |
| **F2** `Оптовик_Категория…` | `wholesaleExchange.outletCategory` | `onecCategory` | Категория 1С | `onecCategory` | exact + filled/empty | clients | F2 (не A/B/C/D→ТОП) |
| **F3** контрагент ×4 | `counterparty.*` | `onecCounterparty`… | Контрагент | 4 cols | contains/exact + filled/empty | clients | F3 integration/browser |
| **F4** договор/соглашение | `clientContract.*` | `onecPrimaryContract`… | Договор | 2 cols | contains + filled/empty | clients | F4 integration/browser |
| **F5** `Код` | `clientCode.code1c` | `code1c` | Код 1С | `code1c` | exact/contains + filled/empty | clients | F5 unit/integration/browser |

Семантика: **не передано** (omitted / нет `fieldPresence`) vs **не заполнено** (передано `""` / label «Не заполнено») vs **`"0"`** (заполнено, не пусто).

## Остаток (не F5)

| Поле / UI | Статус |
|-----------|--------|
| `inn`, `kpp`, `city`, `cashback`, TOP-350/500 | **не подтверждены** в audit 04.10 — колонки `hasSource: false` |
| `category` (legacy UI) | **не** `onecCategory` — не подменять |
| Справочники юрлиц/договоров 0..N | F6+ |
| Prod backfill всех клиентов | F6 после merge F5 |

## Статус наполнения данных

| Слой | Статус |
|------|--------|
| Реализовано в Draft | parser, snapshot, API, UI, gate, backfill A–D + C, матрица F1–F5 |
| Опубликовано (merge/deploy) | **нет** — Draft PR |
| Заполнено реальным обменом 1С | **нет** — синтетика / mock-browser |

F6 и неподтверждённые поля **не завершены**. Соответствие визуальному прототипу Perplexity **не заявлялось** без отдельной сверки экранов.
