# Приёмка: раздел «Клиенты» v3 по прототипу

PR: https://github.com/karenavedikyan/tandoor-rf/pull/77  
Production **не изменялся**.

## Матрица ролей

| Роль | Старт (меню / `clientsHref`) | UI vs прототип | Область данных | Проверки | Статус |
|------|------------------------------|----------------|----------------|----------|--------|
| manager | `v3mode=1`, `v3entity=legal`, `view=all` | Portfolio chrome, колонки «Менеджер/Региональный/РОП», вкладка «Моя база» | v3 scope менеджера | unit, browser v3 (manager), navigation | PASS |
| regional_manager | `v3entity=retail`, `entity=outlets` | Retail-колонки (адрес, менеджер ТТ) | retail scope | unit presentation | NOT RUN (browser) |
| rop | `view=teams`, `v3view=teams` | Teams + portfolio ROP при `view=teams` | команда после выбора ответственного | unit | NOT RUN (browser) |
| director | `view=teams`, director layout | Обзор отдела, teams/all/review | fullClientBase | unit | NOT RUN (browser) |
| admin | как director | director layout + admin actions | admin | integration sync-status, browser teams↔all | PASS |
| assistant | как manager | как manager | scoped | unit | NOT RUN (browser) |

## Исправления по ревью PR #77

| Замечание | Статус |
|-----------|--------|
| URL не перетирает user action (`reconcile` из старого search) | PASS — разбор URL только при `loadSource=url`; `writeState` в начале `loadOrchestrated` |
| Bare `/clients` не сбрасывает q/page/rop | PASS — `isBareClientsMenuSearch`, `mergeRoleEntryHref` |
| Меню: `clientsHref` из presentation API | PASS — `clients-shell.js` |
| sync-status без мутации jobs | PASS — `peekActive/LatestRegularUpdateJob`, integration test |
| v3 freshness без legacy journal | PASS — v3 state + import runs + regular jobs |
| Browser after-hook / server leak | PASS — один server в `before`, exit 0 |

## Команды тестов (Node 22.14.0)

- `npm run typecheck` — PASS  
- `npm test` — 692/692 PASS  
- `node --import tsx --test test/integration/clients-v3-api.test.ts` — 5/5 PASS  
- `node --import tsx --test test/browser/clients-v3.browser.test.ts` — 4/4 PASS, exit 0  

## Оставшиеся отличия

- Полные browser-скриншоты regional / ROP / director vs прототип — **NOT RUN** (нужны отдельные учётки + прогон).  
- Эталоны прототипа: `/opt/cursor/artifacts/screenshots/prototype-*.png`.  
- Карта полей / часть legacy-колонок прототипа — вне v3 list DTO (расширение по мере полей в JSON).
