# Sprint 3 — карта полей обмена → экран → фильтр

**Ветка:** `cursor/sprint3-exchange-fields-filters-9e11` · **base:** `main` (после PR #56/#57)  
**См. также:** [sprint2-field-map.md](./sprint2-field-map.md)

## Уровни доказательства

| Метка | Значение |
|-------|----------|
| **синтетика** | fixtures + unit/integration |
| **код** | parser → snapshot/DB → DTO → UI |
| **снимок** | read-only `npm run audit:exchange-fields` |
| **не проверено live** | TOP-150/350/500, юрлица, code1c, INN, city, cashback (колонки-заглушки) |

Live-источник (`AUDIT_CLIENTS_PATH`) в среде агента не настроен — поля ниже подтверждены по fixtures и контракту extended/synthetic.

---

## Legacy commercial (client level)

| Поле JSON | Уровень | Тип | GUID-связь | Карточка | Список clients | Фильтр | UI |
|-----------|---------|-----|------------|----------|----------------|--------|-----|
| `Discount` | client | string \| null | — | Discount (read-only) | discountProgram | `filled`/`empty=discountProgram` | label |
| `DiscountAmount` | client | number \| null | — | DiscountAmount | discountAmount | `filled`/`empty=discountAmount` | label; `0` = значение |
| `Markups[]` | client | `{ Name, Percentage }[]` | — | Markups (read-only) | — | `filled`/`empty=markups` | список без интерпретации единиц |

**Путь snapshot:** `extended_snapshot.commercial.*` · **parser:** `src/onec-clients/commercial-fields.ts`

---

## Retail outlets — bonus (Sprint 3)

| Поле JSON | Уровень | Тип | Карточка | Список outlets | Фильтр clients | Фильтр outlets |
|-----------|---------|-----|----------|----------------|----------------|----------------|
| `retail_outlets[].additional_information.bonus_tandoor_club` | outlet | string | Bonus Tandoor Club | bonusTandoorClub | `filled`/`empty=bonusTandoorClub` (scoped EXISTS) | same |

**Представление:** `hasSource` из `fieldPresence.bonusTandoorClub`; «Не передано» / «Не заполнено» / значение; `"0"` — значение, не пусто.

---

## Восемь фильтров ответственных (завершено)

Multi-select GUID (OR внутри поля), режимы «Все» / «Назначен» / «Не назначен» / «Не передано», взаимоисключение mode ↔ GUID, AND между полями, URL/reload/reset. Client vs outlet params разделены (см. sprint2-field-map).

---

## Не подтверждено live (явно)

| Поле / тема | Статус |
|-------------|--------|
| TOP-150 / TOP-350 / TOP-500 | не наблюдалось в fixtures |
| Юрлица / реквизиты | не наблюдалось |
| `code1c`, `inn`, `city` | колонки `hasSource: false` |
| `cashback` (client/outlet) | колонки `hasSource: false` |
| `guid_team` / `name_team` | вне scope Sprint 3 |

---

## Закрытые поля (без ослабления access)

| Блок | Ограничение |
|------|-------------|
| LPR (`LPR_information.*`) | `sensitiveFieldsWithheld`; фильтр `empty=lprName` → 400 |
| DOB, bonus LPR | не в DTO |
| Raw JSON | не показывается |

Preview использует права целевого сотрудника (без изменений Sprint 3).

---

## Краткая таблица «поле → источник → экран → фильтр»

| Поле | Источник JSON | Экран | Фильтр |
|------|---------------|-------|--------|
| Discount | `Discount` | карточка / список clients | `filled`/`empty=discountProgram` |
| DiscountAmount | `DiscountAmount` | карточка / список clients | `filled`/`empty=discountAmount` |
| Markups | `Markups[]` | карточка (details) | `filled`/`empty=markups` |
| Bonus Tandoor Club | `additional_information.bonus_tandoor_club` | карточка ТТ / список outlets | `filled`/`empty=bonusTandoorClub` |
| 8× ответственные | managers.* / client extended | combobox + mode | `*Manager`, `missing*`, `*Mode` |
