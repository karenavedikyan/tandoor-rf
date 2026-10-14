# Clients v3 — приёмка PR #77 (ролевой раздел «Клиенты»)

## Итоговый SHA

**Код и тесты:** `e1aaa15` (база приёмки `6124702`: гонка `loadList`, оркестрация switcher, счётчики команд, visual/manifest, `responsibleGuid` в legacy URL).

## Изменения приложения (этот блок)

1. **Гонка v3 `loadList`:** поколение запроса (`v3ListLoadGeneration`); устаревшие ответы `options`/`list` не меняют DOM, чипы, счётчики, пагинацию и ошибки. Unit: `test/unit/clients-v3-load-list-race.test.ts` (управляемые promises, обратный порядок ответов).
2. **Оркестрация teams + ответственный:** `loadOrchestrated` вызывает `loadTeamsContext` → `renderTeamsPanel` (полоска `data-testid="clients-team-member-switcher"`) → `loadList`. Legacy URL: `responsibleGuid` в `readStateFromSearch`, `hasResponsibleSelection` через `v3ResponsibleFromLegacyState`.
3. **Счётчики команды v3:** `getV3OrgStructureOverview` — `managerCount` / `regionalCount` / `teamMemberCount` из `listV3RopResponsibles` (дедуп по сотруднику); при отсутствии roster/портфеля не выдаём «ложный» состав из нулей без данных.
4. **Browser multiselect:** `waitForV3ListUiSettled` перед `assertMultiselectSets` (DOM + URL после завершения UI, не только HTTP).
5. **Visual capture:** desktop/mobile отдельные клики по таблице/карточкам; баннер assistant по `[data-testid="clients-delegation-banner"]:not(.clients-hidden)`; `manifest.json` с `runStatus` `complete` | `partial`, `plannedCaptureCount`, `missingCount`, статус `captured` | `missing` по файлу.

## Команды и результаты (изолированная `TEST_DATABASE_URL`, DB последовательно)

| Команда | PASS |
|---------|------|
| `npm run typecheck` | да |
| `npm run build` | да |
| `npm test` | **706** unit (+2 race) |
| `node --import tsx --test --test-concurrency=1 test/integration/clients-v3-api.test.ts test/integration/clients-v3-teams.test.ts` | **7** |
| `node --import tsx --test --test-concurrency=1 test/browser/clients-v3.browser.test.ts` | **12** |
| `node --import tsx --test --test-concurrency=1 test/browser/clients-v3-roles-entry.browser.test.ts` | **6** |
| `node --import tsx --test --test-concurrency=1 test/browser/clients-v3-visual-acceptance.browser.test.ts` | **9** (captures + manifest; `CLIENTS_V3_VISUAL_DIR` при необходимости) |

**Multiselect (browser):** сценарий «multiselect filters persist…» — **3/3** повтора после `waitForV3ListUiSettled`.

**Browser функциональный итог:** 12 + 6 = **18** (без pixel-сравнения с прототипом).

## Проверки по задаче

| Область | Результат |
|---------|-----------|
| Гонка options/list | unit PASS; stale options не восстанавливает типы при очищенном URL |
| Switcher + orchestration | browser: direct URL + reload + A→B; видимый switcher для admin/director layout |
| Счётчики ROP | integration: `managerCount >= 1`, согласовано с responsibles на fixtures |
| Visual manifest | `runStatus: complete` при 28/28 файлах в прогоне на SHA |

## Визуальная матрица (по manifest `captures-<sha>/manifest.json`)

| Роль | Desktop | Mobile | Dark | Сценарии в manifest |
|------|---------|--------|------|---------------------|
| manager | entry, filters, card, return | entry, filters, card, return | entry | entry-list, filters-chips, card-detail, return-list |
| assistant | entry, delegation | entry, delegation | entry | entry-list, delegation-banner |
| regional | entry | entry | entry | entry-list |
| rop | entry, team-base | entry | entry | entry-list, team-base-tab |
| director | entry, teams overview | entry | entry | entry-list, teams-overview |
| admin | entry, teams roster | entry, teams roster | entry | entry-list, teams-roster-filled |

**Общий визуальный PASS vs прототип:** **нет** — row actions и field-builder INN/TOP требуют контракт (см. `clients-v3-prototype-contract-gaps.md`). Прототип для сравнения: [Perplexity computer session](https://www.perplexity.ai/computer/a/4f284ecc-6d26-4f4e-9d3d-36b2b7cf314c).

## Происхождение скриншотов

- Имена: `<git-sha>-<slug>-<desktop|mobile>[-dark].png`
- Каталог: `CLIENTS_V3_VISUAL_DIR` или store `media/clients-v3-visual-review/captures-<sha>/`
- SHA: checkout HEAD, опционально сверка с `CLIENTS_V3_VERIFIED_SHA`

## HTTP 500 при «полном» browser-прогоне

**Наблюдение:** несколько browser-файлов в одном процессе node → 500 на v3/list. **Мера:** отдельные последовательные команды на файл; `resetPoolForTests` / DB до listen.

## Production

Не изменялся.
