# F4 — договор и соглашение (скалярные строки клиента)

**Дата (UTC):** 2026-10-08  
**Base:** `main` @ `80f5044` (F3 merged, PR #67)  
**Статус F4:** **реализован в подтверждённом объёме** — две строковых поля клиента из снимка 04.10.2026; **не** справочник договоров 0..N, **не** F5–F6.

## Источник

| Поле | JSON-ключ | Snapshot `extended_snapshot.clientContract` |
|------|-----------|---------------------------------------------|
| Основной договор | `Оптовик_ОсновнойДоговор` | `primaryContract` |
| Основное соглашение | `Оптовик_ОсновноеСоглашение` | `mainAgreement` |

SHA снимка: `b439063b1602743ab1df56ee6390ba9d3cc64dce7cdc24763c3d4d7176c74b74`. Fixture: `test/fixtures/onec-clients/recovered-exchange-structure.json`.

**Не в F4:** GUID договоров, массивы, номера/даты/статусы как отдельные поля, файлы для скачивания, связь с юрлицами.

## Контракт parser

- Только `string` as-is; omitted → merge; `null` / `""` — явная очистка поля.
- Иные типы → `INVALID_CLIENT_CONTRACT_EXCHANGE_FIELD` до apply.

## ЛК

Parser → snapshot → DTO → карточка («Договор и соглашение») → колонки → фильтры clients-only (contains + filled/empty; URL/reload/reset; сброс при `entity=outlets`).

## Backfill после публикации

При том же verification fingerprint: gate сравнивает roster + wholesale + counterparty + **clientContract** → один SUCCESS дозаполнения, повтор → `NO_CHANGES`. Сценарий **C**: omitted F4 → значения сохраняются; явный `""` очищает переданные поля; confirmation один раз на новый bundle.

## Статус наполнения данных

| Слой | Статус |
|------|--------|
| Реализовано в Draft | parser, snapshot, API, UI, gate, backfill A–D + C |
| Опубликовано (merge/deploy) | **нет** — Draft PR |
| Заполнено реальным обменом 1С | **нет** — синтетика / mock-browser |

F5–F6 и полноценный справочник договоров **не завершены**.
