# Приёмка: раздел «Клиенты» v3 по прототипу

PR: https://github.com/karenavedikyan/tandoor-rf/pull/77  
Production **не изменялся**.

## Матрица ролей (вход / функция / ACL / UI / desktop-mobile)

| Роль | Вход | Функция | ACL | UI vs прототип | Desktop | Mobile |
|------|------|---------|-----|----------------|---------|--------|
| manager | PASS URL + class | PASS list, колонки, карточка | PASS scoped legal | PARTIAL | PASS browser + screenshot | PASS cards meta |
| assistant | PASS URL | PASS delegated Legal One | PASS delegation_clients | PARTIAL | PASS browser | NOT RUN |
| regional_manager | PASS retail-first | PASS Store One row | PASS regional on retail | PARTIAL | PASS screenshot | PASS screenshot |
| rop | PASS teams | PASS teams shell, stats | PASS team scope | PARTIAL | PASS screenshot | PASS screenshot |
| director | PASS teams | PASS ROP/team overview | PASS fullClientBase | PARTIAL | PASS screenshot | PASS screenshot |
| admin | PASS teams→all | PASS v3 list, entity switch, 1С panel | PASS admin | PARTIAL | PASS screenshot | NOT RUN |

Скриншоты реализации: `/opt/cursor/artifacts/screenshots/impl-v3-{role}-{desktop|mobile}.png`  
Эталон прототипа: `/opt/cursor/artifacts/screenshots/prototype-*.png` (внешний Perplexity)

## Исправления (HEAD после 50fb7af)

| Задача | Статус |
|--------|--------|
| Сохранение v3-фильтров при поиске/пагинации | PASS — `readFiltersFromDom`, `mergeListStateForUserAction`, DOM/URL fallback в `legacyStateToV3`, v3 search path в `scheduleLoad`, `pageSize`/`v3pageSize`, сброс responsible при `switchView` → all |
| Гонка browser team→all | PASS — `waitForResponse` до click, проверка URL и строк |
| Browser retail filters regression | PASS — manager + closed + type + search + clear q + page=2 + explicit clear |
| Role depth (не только entry) | PARTIAL — 6 ролей: list/teams/колонки/скриншоты; полный паритет вкладок/действий vs прототип — **NOT RUN** |

## Команды (Node 22.14.0)

| Команда | Результат |
|---------|-----------|
| `npm run typecheck` | PASS |
| `npm run build` | PASS |
| `npm test` | 694/694 PASS |
| `test/integration/clients-v3-api.test.ts` | 6/6 PASS |
| `test/browser/clients-v3.browser.test.ts` | 6/6 ×2 прогона, exit 0 |
| `test/browser/clients-v3-roles-entry.browser.test.ts` | 6/6 ×2 прогона, exit 0 |

## Оставшиеся расхождения

- Визуальный pixel-parity с Perplexity по всем вкладкам/счётчикам/действиям — не заявлен; только PARTIAL + скриншоты.
- Admin/assistant mobile — NOT RUN.
- Часть полей прототипа вне v3 DTO.
