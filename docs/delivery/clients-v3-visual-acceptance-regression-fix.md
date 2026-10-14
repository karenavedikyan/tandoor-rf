# Clients v3 — регрессии multiselect и приёмка — SHA `7687a2d`

## Исправленные блокеры

1. **Return из карточки:** `typeGuids` / `categoryGuids` в `LIST_QUERY_KEYS` (`clients-logic.js`); нормализация multiselect в `loadList` / `loadOrchestrated`.
2. **Смена ответственного:** `resolveV3MultiFilter` + DOM-first при `!fromUrl`; явные `v3types: []` через legacy patch.
3. **Browser test:** ожидание selectedOptions вместо `options.length > 1`; сценарий multiselect return через UI.

## Тесты (изолированная БД, последовательно)

| Команда | PASS |
|---------|------|
| `npm run typecheck` | да |
| `npm run build` | да |
| `npm test` | 699 |
| `node --import tsx --test --test-concurrency=1 test/integration/clients-v3-api.test.ts test/integration/clients-assistant-delegation-presentation.test.ts` | 17 |
| `node --import tsx --test --test-concurrency=1 test/browser/clients-v3.browser.test.ts` | 10 |
| `node --import tsx --test --test-concurrency=1 test/browser/clients-v3-roles-entry.browser.test.ts test/browser/clients-v3-visual-acceptance.browser.test.ts` | 14 |

Дополнительно: `test/helpers/test-db.ts` — `pg_terminate_backend` перед reset (снятие `IMPORT_LOCKED` от зависших прогонов).

## Визуальная матрица (capture на итоговом SHA, см. `captures-<sha>/`)

| Роль | Desktop | Mobile | Каркас/IA | Фильтры multiselect | Return/card | Вердикт vs прототип |
|------|---------|--------|-----------|---------------------|-------------|---------------------|
| manager | снято | снято | PARTIAL (H1 OK) | PARTIAL | PASS (unit+browser) | FAIL pixel |
| assistant | снято | — | PARTIAL | N/A | NOT RUN card | PARTIAL |
| regional_manager | снято | снято | PARTIAL | PARTIAL | NOT RUN | FAIL |
| rop | снято | снято | PARTIAL | PARTIAL | NOT RUN | FAIL team cards |
| director | снято | снято | PARTIAL | PARTIAL | NOT RUN | FAIL |
| admin | снято | снято | PARTIAL | PARTIAL | field map PASS | FAIL row actions |

**Общий визуальный PASS:** нет (остаются row actions, field-builder INN/TOP, pixel parity team cards).

## Оставшиеся решения владельцу

- Перечень разрешённых **row quick actions** (контракт).

## Production

Не изменялся (только ветка PR, test DB).
