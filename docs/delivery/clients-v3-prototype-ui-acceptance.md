# Приёмка: раздел «Клиенты» v3 по прототипу

PR: https://github.com/karenavedikyan/tandoor-rf/pull/77  
Production **не изменялся**.

Эталон прототипа: [Perplexity computer](https://www.perplexity.ai/computer/a/4f284ecc-6d26-4f4e-9d3d-36b2b7cf314c)  
Визуальные пары (эталон/реализация): `/cursor/stores/bc-01a0c95b-ccc6-786a-8dc8-f91f60a1cd82/media/clients-v3-visual-review/`  
Скриншоты прогона browser: `/opt/cursor/artifacts/screenshots/impl-v3-{role}-{desktop|mobile}.png`

## Матрица ролей (функция / ACL / UI / desktop-mobile)

| Роль | Функция | ACL | UI vs прототип | Desktop | Mobile |
|------|---------|-----|----------------|---------|--------|
| manager | PASS — legal-first, KPI v3, filters+chips, карточка | PASS scoped legal/retail | PARTIAL — нет row actions, карточка без полных вторичных блоков | PASS browser + screenshot | PASS |
| assistant | PASS — legal list, баннер замещения, KPI | PASS delegation_clients | PARTIAL — только legal entity (данные замещения) | PASS | PASS |
| regional_manager | PASS — retail-first, v3 filters | PASS regional on retail | PARTIAL — select+chips vs multiselect прототипа | PASS | PASS |
| rop | PASS — «База команды»/«Моя команда», KPI v3, compact team | PASS team scope | PARTIAL — compact team vs карточки прототипа | PASS | PASS |
| director | PASS — «Вся база»/«По командам», overview+expand | PASS fullClientBase | PARTIAL — стили карточек команд | PASS | PASS |
| admin | PASS — director layout + 1С panel + entity switch | PASS admin | PARTIAL — 1С panel вне прототипа (разрешено) | PASS | PASS |

**Вход через меню:** для всех ролей PASS (browser roles-entry + URL `clientsHref` / v3 redirect).

## UI-закрытие расхождений (текущий batch)

| Элемент прототипа | Реализация | Группа |
|-------------------|------------|--------|
| Один уровень навигации list vs teams | View switcher с ролевыми подписями; v3 entity switcher скрыт на teams home и для ROP (`showEntitySwitcher: false`) | Данные + UI |
| KPI над списком | Portfolio stats через `/api/clients/v3/list` totals (v3 active) | Backend v3 |
| Баннер assistant «работаю от имени» | `#clients-delegation-banner` + `delegationContext` API | Backend ACL |
| Фильтры + активные условия | v3 selects + `#v3-filter-chips` с очисткой | UI |
| ROP tabs | «База команды» / «Моя команда» | UI |
| Director/admin tabs | «Вся база» / «По командам» | UI |
| Mobile sticky search | CSS `clients-search-row--sticky` | UI |
| Legacy `/api/clients/org-structure` 500 при v3 | Stats/teams используют v3 org-structure когда exchange v3 active | Bugfix |

## Ограничения (требуют решения владельца / новых данных)

| Элемент | Ограничение | Нужно |
|---------|-------------|--------|
| «Карта полей» (admin) | Нет production route | Отдельная задача на маршрут и ACL |
| Row quick actions в таблице | Нет согласованных разрешённых операций в строке | Backend+ACL+UX spec |
| Полные блоки скидок/наценок/LPR в карточке | DTO v3 не содержит все поля прототипа | Обмен/контракт карточки |
| Multiselect фильтров как в прототипе | v3 API — одиночные type/category/manager | Контракт фильтров v3 |
| ТТ без связей | Отдельная группа сущностей `orphan_retail` — только director/admin | Не смешивать с ролевым portfolio |
| Pixel-parity compact team / director cards | Функционально достаточно для R2; стили отличаются | Design pass по запросу |

Не добавлены: фиктивные метрики, неработающие кнопки, новые права.

## Техническая приёмка (регрессии сохранены)

| Команда | Результат |
|---------|-----------|
| `npm run typecheck` | PASS |
| `npm run build` | PASS |
| `npm test` | 695/695 PASS |
| `test/integration/clients-v3-api.test.ts` | 6/6 PASS |
| `test/browser/clients-v3.browser.test.ts` | 7/7 ×2, exit 0 |
| `test/browser/clients-v3-roles-entry.browser.test.ts` | 6/6 ×2, exit 0 |

Регрессии: смена ответственного без reload, поиск с фильтрами, очистка фильтров, пагинация, карточка/back/forward, read-only sync-status — покрыты browser suite #77.

### HTTP 500 GET `/org-structure`

При активном exchange v3 portfolio stats и team loaders не вызывают legacy `/api/clients/org-structure` (используется `/api/clients/v3/org-structure`). Оставшийся legacy endpoint — для non-v3 режима; 500 в логе при параллельном сбросе pool в других тестах не воспроизводится в clients-v3 browser seed.

## Исправления (история PR)

| Задача | Статус |
|--------|--------|
| Приоритет ответственного / team assignment | PASS |
| Пагинация + return query | PASS |
| SQL `delegationContext` (GROUP BY / ORDER BY) | PASS — баннер assistant |
| Role entry screens + screenshots | PASS |
