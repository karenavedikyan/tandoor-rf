# Приёмка: раздел «Клиенты» v3 по прототипу

PR: https://github.com/karenavedikyan/tandoor-rf/pull/77  
Production **не изменялся**.

## Матрица ролей (вход / функция / ACL / UI / desktop-mobile)

| Роль | Вход | Функция | ACL | UI vs прототип | Desktop | Mobile |
|------|------|---------|-----|----------------|---------|--------|
| manager | PASS URL + class | PASS list, колонки, карточка | PASS scoped legal | PARTIAL | PASS browser + screenshot | PASS cards meta |
| assistant | PASS URL | PASS delegated Legal One | PASS delegation_clients | PARTIAL | PASS screenshot | NOT RUN |
| regional_manager | PASS retail-first | PASS Store One row | PASS regional on retail | PARTIAL | PASS screenshot | PASS screenshot |
| rop | PASS teams | PASS teams shell, stats | PASS team scope | PARTIAL | PASS screenshot | PASS screenshot |
| director | PASS teams | PASS ROP/team overview | PASS fullClientBase | PARTIAL | PASS screenshot | PASS screenshot |
| admin | PASS teams→all | PASS v3 list, entity switch, 1С panel | PASS admin | PARTIAL | PASS screenshot | NOT RUN |

Скриншоты реализации: `/opt/cursor/artifacts/screenshots/impl-v3-{role}-{desktop|mobile}.png`  
Эталон прототипа: [Perplexity computer](https://www.perplexity.ai/computer/a/4f284ecc-6d26-4f4e-9d3d-36b2b7cf314c)

## Исправления (после 6b4e6fb)

| Задача | Статус |
|--------|--------|
| Приоритет нового ответственного над stale DOM/URL | PASS — `hasExplicitResponsibleNavigation`, `legacyStateToV3`, `isV3TeamAssignment`, без `managerGuid` при team-assignment; сброс `teamKind` при возврате к выбору |
| Смена ответственного без reload | PASS — browser: M1→M2, manager→regional→hardware, clear; вкладка «По командам» reopen picker |
| Пагинация кнопкой + return | PASS — `#page-next`, `v3pageSize` в return (`LIST_QUERY_KEYS`), back на page=2 |
| Retail filters regression | PASS — manager + closed + type + search без потери фильтров |
| Async compact team panel | PASS — `loadOrchestrated` ждёт `renderCompactRopTeamPanel` |

## Команды (Node 22.14.0)

| Команда | Результат |
|---------|-----------|
| `npm run typecheck` | PASS |
| `npm run build` | PASS |
| `npm test` | 695/695 PASS |
| `test/integration/clients-v3-api.test.ts` | 6/6 PASS |
| `test/browser/clients-v3.browser.test.ts` | 7/7 ×2 прогона, exit 0 |
| `test/browser/clients-v3-roles-entry.browser.test.ts` | 6/6 PASS |

## Оставшиеся расхождения с прототипом (конкретно)

Общее для всех ролей: переключатель сущностей v3 (холдинги/юрлица/ТТ/сироты) и legacy view-switcher («Все клиенты» / «По командам») — двойная навигация; в прототипе один уровень вкладок. Фильтры v3 — выпадающие списки, не чипы/мультiselect прототипа. Карточка объекта — секции v3 DTO, без части вторичных блоков прототипа (скидки/наценки/LPR в полном объёме).

| Область | Прототип | Реализация | Нужность |
|---------|----------|------------|----------|
| **manager — старт** | Сразу список «Мои клиенты», акцент на назначения | `clientsHref` → legal list, subtitle «Мои назначения» | UX polish, не блокер ACL |
| **manager — колонки** | Фиксированный набор + быстрые действия в строке | Колонки v3ListColumns, без row actions | Действия — отдельный релиз |
| **assistant** | Отдельный баннер «работаю от имени» | Delegation через ACL, без крупного баннера прототипа | Желательно для приёмки |
| **regional — вкладки** | Только ТТ + фильтры по маршруту | retail-first + v3 filters (manager/closed/type) | Функционально достаточно |
| **rop — команда** | Карточки сотрудников с метриками в одном стиле | Compact team panel (`clients-teams-compact`) | Визуальный паритет |
| **director — обзор** | Список РОП с разворотом веток | Compact overview + expand | Структура близка, стили отличаются |
| **admin — старт** | Клиенты как у director | Director layout + панель обновления 1С | Admin-only, в прототипе нет |
| **mobile** | Упрощённые карточки, sticky search | Cards + filters wrap | assistant/admin mobile не сняты |
| **счётчики** | Крупные KPI над списком | `resultCountEl` текстом, portfolio stats частично | Средний приоритет |

Полный pixel-parity и row-level actions **не заявлены** в PR #77; скриншоты фиксируют текущий PARTIAL.
