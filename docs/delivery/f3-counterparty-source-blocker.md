# F3 — контрагент и реквизиты (скалярные строки клиента)

**Дата (UTC):** 2026-10-08  
**Base:** `main` @ `1c7ed9d` (F2 merged, PR #66)  
**Статус F3:** **реализован в подтверждённом объёме** — четыре строковых поля клиента из снимка 04.10.2026; **не** справочник юрлиц, **не** F4–F6.

## Источник

| Поле | JSON-ключ | Snapshot `extended_snapshot.counterparty` |
|------|-----------|----------------------------------------|
| Контрагент | `Контрагент` | `counterparty` |
| Полное наименование | `НаименованиеПолное` | `fullName` |
| Тип (юр/физ) | `ЮрФизЛицо` | `legalEntityType` |
| ОГРН | `Оптовик_ОГРН` | `ogrn` (строка, ведущие нули сохраняются) |

SHA снимка: `b439063b1602743ab1df56ee6390ba9d3cc64dce7cdc24763c3d4d7176c74b74`. Fixture: `test/fixtures/onec-clients/recovered-exchange-structure.json`.

**Не в F3:** `Код` (F5), `Оптовик_ОсновнойДоговор` / `Оптовик_ОсновноеСоглашение` (F4), массивы юрлиц, ИНН/КПП/счета.

## ЛК

- Parser → snapshot → DTO → карточка («Контрагент и реквизиты») → колонки → фильтры (только `entity=clients`).
- Фильтры: contains по контрагенту/полному наименованию; exact тип и ОГРН; filled/empty; URL/reload/reset; при `entity=outlets` сбрасываются (как F2).

## Backfill после публикации

При том же verification fingerprint и operator confirmation на bundle: gate сравнивает merged `counterparty` vs persisted (вместе с roster/wholesale) → один SUCCESS дозаполнения, повтор → `NO_CHANGES`. Другой fingerprint — полный apply и guards (без partial shortcut).
