# Список lktandoor: пробелы прототипа vs текущий контракт v3

Краткий список для владельца и 1С-специалista. Базовые карты полей: [sprint3-field-map.md](./sprint3-field-map.md), [clients-list-stage2-1c-gaps-addendum.md](./clients-list-stage2-1c-gaps-addendum.md).

## Нет в источнике / нужен обмен 1С

| Элемент UI прототипа | Статус |
|----------------------|--------|
| ИНН в быстрых фильтрах | Нет поля в allowlist SQL фильтров списка v3 → см. [f3-counterparty-source-blocker.md](./f3-counterparty-source-blocker.md) |
| Договор в быстрых фильтрах | Нет поля в allowlist → см. [f4-contract-source-blocker.md](./f4-contract-source-blocker.md) |
| Город клиента (юрлица) | Только структурированный `LEGAL_CITY_SQL`; при пустой выгрузке dropdown «Город» пустой |
| Отдельная метка «ТОП-150» как в legacy v2 | В v3 списке — категория/тип через GUID (`categoryGuid` / `typeGuid`), не отдельное поле «ТОП» из v2 |

## Данные есть, но API списка не фильтрует / не агрегирует

| Элемент | Статус |
|---------|--------|
| Сквозной фильтр «юрлицо + все ТТ холдинга» одним правилом | Не поддерживается (`clientName` для ТТ — только название холдинга, см. `unavailableNote` в `/v3/filter-fields`) |
| Итог «N из M» при активных фильтрах | `M` берётся из `scope-summary` (территория без пользовательских фильтров); при фильтрах «из M» остаётся база территории, не «до фильтра» |
| Холдинги / ТТ без холдинга | Доступны как вторичные реестры; не в основной паре «Клиенты / ТТ» |

## Осознанно без изменения backend в этом PR

- Контракт `filters` JSON (AND, до 12 правил) и allowlist `list-field-rules.ts` не расширялись.
- ACL, territory params, `legal_grouped` grouping и URL/query compatibility сохранены.
