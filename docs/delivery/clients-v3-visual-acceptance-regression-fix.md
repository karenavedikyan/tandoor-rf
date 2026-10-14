# Clients v3 — приёмка PR #77 (ролевой раздел «Клиенты»)

## Итоговый SHA

См. последний коммит ветки `cursor/clients-v3-prototype-ui-9e11` (код + документы). Опорные: `13b8fd2` (multiselect `[]`), `0f5eb44` (doc SHA).

## Изменения приложения (этот блок)

1. **Переход менеджер A→B (UX):** полоска переключения ответственных на списке (`clients-team-switcher-strip`); admin/director видят карточку ветки РОП с `clients-team-member-row__count` вместо скрытого compact-only; загрузка `/responsibles` при выбранном ответственном.
2. **Browser:** сценарий A→B через вкладку «По командам» / `switchView` и **видимый** `locator.click()` по строке команды (без `evaluate` / `force`).
3. **Visual captures:** SHA из `resolveVerifiedGitSha()` (`test/helpers/verified-git-sha.ts`), каталог `captures-<sha>/`, `manifest.json`.
4. **DB/browser teardown:** подготовка БД до старта HTTP-сервера в roles-entry и visual; `pg_advisory_unlock` в `resetDatabase`; отдельный прогон browser-файлов (не один процесс на три suite).

## Команды и результаты (изолированная `TEST_DATABASE_URL`, DB последовательно)

| Команда | PASS |
|---------|------|
| `npm run typecheck` | да |
| `npm run build` | да |
| `npm test` | **704** |
| `node --import tsx --test --test-concurrency=1 test/integration/clients-v3-api.test.ts test/integration/clients-assistant-delegation-presentation.test.ts` | **17** |
| `node --import tsx --test --test-concurrency=1 test/browser/clients-v3.browser.test.ts` | **11** |
| `node --import tsx --test --test-concurrency=1 test/browser/clients-v3-roles-entry.browser.test.ts` | **6** |
| `node --import tsx --test --test-concurrency=1 test/browser/clients-v3-visual-acceptance.browser.test.ts` | см. прогон на SHA (captures + manifest) |

**Browser функциональный итог:** 11 + 6 = **17** (без учёта capture-suite). Capture-suite — отдельный функциональный PASS создания файлов, не pixel PASS.

## Multiselect и A→B

- `[]` / dual multiselect: без изменений правил `13b8fd2`.
- A→B: dual type/category сохраняются в DOM, URL и API после «По командам» → выбор M2.

## Визуальная матрица (по manifest `captures-<sha>/manifest.json`)

| Роль | Desktop | Mobile | Dark | Сценарии в manifest |
|------|---------|--------|------|---------------------|
| manager | entry, filters, card, return | entry, filters, card, return | entry | entry-list, filters-chips, card-detail, return-list |
| assistant | entry, delegation | entry, delegation | entry | entry-list, delegation-banner |
| regional | entry | entry | entry | entry-list |
| rop | entry, team-base | entry | entry | entry-list, team-base-tab |
| director | entry, teams overview | entry | entry | entry-list, teams-overview |
| admin | entry, teams roster | entry, teams roster | entry | entry-list, teams-roster-filled |

**Общий визуальный PASS vs прототип:** **нет** — row actions и field-builder INN/TOP требуют контракт (см. `clients-v3-prototype-contract-gaps.md`).

## Происхождение скриншотов

- Имена: `<git-sha>-<slug>-<desktop|mobile>[-dark].png`
- Каталог: `CLIENTS_V3_VISUAL_DIR` или store `media/clients-v3-visual-review/captures-<sha>/`
- SHA: checkout HEAD, опционально сверка с `CLIENTS_V3_VERIFIED_SHA`

## HTTP 500 при «полном» browser-прогоне

**Наблюдение:** `GET /api/clients/v3/list` и `GET /api/clients/completeness-queue` с 500 при одном процессе node на несколько browser-файлов; повтор отдельных suite — 200.

**Причина:** `prepareDatabase` / `DROP SCHEMA` между файлами при ещё живом `appServer` или незакрытых запросах → pool/routes падают на пустой схеме. Не подавление ошибок приложения.

**Меры:** DB reset до listen; `resetPoolForTests` между suite; три команды browser; advisory unlock миграций.

## Production

Не изменялся.
