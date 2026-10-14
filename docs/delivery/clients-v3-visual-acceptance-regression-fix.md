# Clients v3 — приёмка PR #77 (ролевой раздел «Клиенты»)

## Итоговый SHA

**Код и тесты:** `d05b4b8` (блок после `872d15e` / `e1aaa15`: live navigation token, manifest 30/30, browser DB lifecycle, filter reload token).

База: `e1aaa15` (гонка `loadList`, оркестрация switcher, счётчики команд); документ `872d15e`.

## Изменения приложения (этот блок)

1. **Глобальная актуальность навигации:** `activeRequestId` + `isNavigationCurrent()` / `buildV3UiContext(navId)`; проверка до URL, панели команд, `loadList`, ошибок. Смена v3-фильтров: новый token через `reloadFromV3Filters` → `ClientsV3.loadList` (без потери multiselect при teams-home).
2. **Гонка v3 `loadList`:** поколение `v3ListLoadGeneration` + navigation guard (unit: `clients-v3-load-list-race`, `clients-v3-navigation-orchestration`).
3. **Visual manifest:** полный план **30** файлов до прогона; `planned` | `captured` | `missing` | `not-run`; `runStatus: complete` только при 30/30 текущего прогона; старые PNG в каталоге SHA удаляются в `before`.
4. **Browser HTTP 500:** suite-level `prepareDatabase` до listen; без `DROP SCHEMA` между тестами при живом сервере.

## Команды и результаты (изолированная `TEST_DATABASE_URL`, browser — отдельные команды)

| Команда | PASS |
|---------|------|
| `npm run typecheck` | да |
| `npm run build` | да |
| `npm test` | **714** unit (+ navigation orchestration 4, manifest 4) |
| `node --import tsx --test --test-concurrency=1 test/integration/clients-v3-api.test.ts test/integration/clients-v3-teams.test.ts test/integration/clients-assistant-delegation-presentation.test.ts` | **18** |
| `node --import tsx --test --test-concurrency=1 test/browser/clients-v3.browser.test.ts` | **12** |
| `node --import tsx --test --test-concurrency=1 test/browser/clients-v3-roles-entry.browser.test.ts` | **6** |
| `node --import tsx --test --test-concurrency=1 test/browser/clients-v3-visual-acceptance.browser.test.ts` | **9** (сценарии; `CLIENTS_V3_VISUAL_DIR` при необходимости) |

**Multiselect:** «multiselect filters persist…» — **3/3** повтора.

**Browser функциональный итог:** 12 + 6 = **18** (без pixel-сравнения с прототипом).

## Проверки по задаче

| Область | Результат |
|---------|-----------|
| Обратный порядок teams → all / teams A → B | unit PASS (jsdom + deferred `loadTeamsContext`) |
| Поздняя ошибка / teams-home без лишнего list | unit PASS |
| Visual manifest | unit partial/complete; прогон **30/30** `captured`, `runStatus: complete` |
| HTTP 500 | устранён lifecycle (нет drop schema при listening server) |

## Визуальная матрица (30 captures)

| Роль | Desktop | Mobile | Dark | Сценарии |
|------|---------|--------|------|----------|
| manager | entry, filters, card, return | entry, filters, card, return | entry | entry-list, filters-chips, card-detail, return-list |
| assistant | entry, delegation | entry, delegation | entry | entry-list, delegation-banner |
| regional | entry | entry | entry | entry-list |
| rop | entry, team-base | entry | entry | entry-list, team-base-tab |
| director | entry, teams overview | entry | entry | entry-list, teams-overview |
| admin | entry, teams roster | entry, teams roster | entry | entry-list, teams-roster-filled |

**Functional PASS vs прототип:** **нет** — row actions и field-builder INN/TOP (см. `clients-v3-prototype-contract-gaps.md`).

**Capture completeness:** отдельно от функционального PASS; `manifest.json` фиксирует `plannedCaptureCount: 30`.

## Происхождение скриншотов

- Имена: `<git-sha>-<slug>-<desktop|mobile>[-dark].png`
- Каталог: `CLIENTS_V3_VISUAL_DIR` или store `media/clients-v3-visual-review/captures-<sha>/`
- SHA: `resolveVerifiedGitSha()` (короткий префикс в имени каталога допустим)

## Production (PR #77 release)

| Поле | Значение |
|------|----------|
| Статус | **MERGED** в `main`; **deploy на lk.tandoor.ru — ожидает оператора / автодеплой Timeweb** |
| PR HEAD | `fca1e3218e07f649af47307e5e55973da943c64d` |
| Merge commit `main` | `b90e8a31beaad40c3d6fa4744514b96136fce7f6` (2026-10-14) |
| Timeweb app | **258307** → https://lk.tandoor.ru |
| Pre-release prod marker | `clients-v3.js` без `navigationIsStale` (Last-Modified 2026-10-13) |
| Миграции в diff PR | **нет** — отдельный `npm run migrate` не требуется для этого выпуска |
| Prod smoke (агент) | health/ready PASS; сценарии с логином — **NOT RUN** (нет production-сессии в среде агента) |

**Оператор (если автодеплой не стартовал):** Timeweb Cloud → приложение **258307** → деплой ветки `main`, commit **`b90e8a3`** (или «последний коммит main» после merge). API: `POST /api/v1/apps/258307/deploy` с телом `{"commit_sha":"b90e8a3..."}` и токеном из панели (не в репозитории).

**Откат:** redeploy предыдущего успешного deployment / commit `234abc8` (pre-#77) без изменений БД и env.

Очистка клиентов, импорт 1С, Bitrix24, права и расписания **не выполнялись**.
