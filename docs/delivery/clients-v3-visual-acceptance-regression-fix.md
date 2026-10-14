# Clients v3 — multiselect `[]`, browser matrix, приёмка

## SHA и объём

- **Итоговый SHA:** `13b8fd2` (ветка `cursor/clients-v3-prototype-ui-9e11`, PR #77).
- **Предыдущие опорные:** `7687a2d` (multiselect return/persistence), `ec00c76` (captures/docs).

## Закрытый дефект: приоритет пустых массивов

**Симптом:** при `v3types: []` / `v3categories: []` в legacy/sync оставались одиночные `v3type`/`v3category`, URL и API уходили с `typeGuid`/`categoryGuid`.

**Правило (единое):**

- Собственное свойство массива (`v3types` / `v3categories`) — финальное значение, включая `[]`.
- При `[]` alias (`v3type` / `v3category`) пустой; fallback к legacy single только если массива **нет** как own property.
- Пустой DOM multiselect **не** перекрывает непустой URL (ответственный/teams до sync options).
- Смена сущности (`v3entity`) **сбрасывает** type/category (несовместимые guid между сущностями).

**Код:** `listFilterTokens`, `syncV3FilterAliases`, `appendTypeCategoryParams`, `legacyStateToV3`, `writeState`, `loadList`, `loadOrchestrated`, `resolveV3MultiFilter`, chips/`mergeListStateForUserAction`.

**Unit:** `test/unit/clients-v3-multiselect-normalization.test.ts` — `[]` без ручного обнуления alias, `[]` со stale alias, legacy single без массива, URL/API/return query.

## Browser: multiselect-сценарии

`test/browser/clients-v3.browser.test.ts` (11 PASS):

- Dual multiselect (t1+t2, c1+c2) в DOM, URL и API.
- Менеджер A→B (teams, force-safe click compact UI).
- Менеджер → regional → hardware → all + card → return.
- Back / Forward / Reload с ожиданием list/options sync.
- Снятие одного chip и последнего type chip.
- `runViewportFlow`: без restorative `page.goto` после legal←retail; правило сброса фильтров на entity switch + повторный выбор t1 для card-flow.

## Тесты (изолированная БД, последовательно)

| Команда | PASS |
|---------|------|
| `npm run typecheck` | да |
| `npm run build` | да |
| `npm test` | 704 |
| `node --import tsx --test --test-concurrency=1 test/integration/clients-v3-api.test.ts test/integration/clients-assistant-delegation-presentation.test.ts` | 17 |
| `node --import tsx --test --test-concurrency=1 test/browser/clients-v3.browser.test.ts` | 11 |
| `node --import tsx --test --test-concurrency=1 test/browser/clients-v3-roles-entry.browser.test.ts test/browser/clients-v3-visual-acceptance.browser.test.ts` | 14 |

**Итого browser:** 25.

## Визуальная матрица

Captures: прогон `clients-v3-visual-acceptance.browser.test.ts` на итоговом SHA (roles-entry + visual-acceptance PASS).

| Роль | Desktop | Mobile | Фильтры multiselect | Return/card | Вердикт vs прототип |
|------|---------|--------|---------------------|-------------|---------------------|
| manager | capture | capture | PASS (browser+unit) | PASS | PARTIAL pixel |
| assistant | capture | — | N/A | PARTIAL | PARTIAL |
| regional_manager | capture | capture | PARTIAL | NOT RUN deep | FAIL pixel |
| rop | capture | capture | PARTIAL | NOT RUN deep | FAIL team cards |
| director | capture | capture | PARTIAL | NOT RUN deep | FAIL pixel |
| admin | capture | capture | PASS field map | PARTIAL | FAIL row actions |

**Общий визуальный PASS:** **нет** — без контракта row quick actions и pixel parity team cards/field-builder.

## Блокеры владельца

- Контракт **row quick actions** в таблице списка.

## Production

Не изменялся (ветка PR, `TEST_DATABASE_URL` only).
