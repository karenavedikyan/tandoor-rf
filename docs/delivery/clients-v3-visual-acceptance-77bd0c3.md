# Визуальная приёмка «Клиенты» v3 — SHA `77bd0c3224a1456332e66874ffd18672c713f055`

PR: https://github.com/karenavedikyan/tandoor-rf/pull/77  
Стенд: изолированная тестовая БД, отдельные учётные записи ролей (browser seed / visual capture), без admin view-as.  
Эталон: [Perplexity prototype](https://www.perplexity.ai/computer/a/4f284ecc-6d26-4f4e-9d3d-36b2b7cf314c) + сохранённые PNG в store `media/clients-v3-visual-review/prototype/` (экспорт computer, окт. 2026).

**Артефакты:** zip `media/clients-v3-visual-review/clients-v3-visual-77bd0c3.zip` (23 capture + 8 prototype + README).  
Подпись файлов: `77bd0c3-{role}-{screen}-{desktop|mobile}[-dark].png`, viewport 1440×900 / 390×844.

## Вердикт

**Визуальная приёмка не пройдена:** перечисленные блокеры (раздел B/C) — существенные расхождения с эталоном по навигации/фильтрам/карточке/командным экранам; полный pixel-parity не достигнут.  
Функциональный вход по ролям и ACL **пройден** (отдельно от визуала). Технические регрессии на SHA — PASS (см. ниже).

## Матрица по ролям (PASS / FAIL / NOT RUN)

Легенда: **В** — вход/старт, **К** — каркас, **С** — список, **Ф** — фильтры/чипы, **Р** — ролевые действия, **Д** — карточка/возврат, **D/M** — desktop/mobile, **T** — темы.

| Роль | В | К | С | Ф | Р | Д | D | M | T | Эталон |
|------|---|---|---|---|---|---|---|---|---|---|
| manager | PASS | FAIL | FAIL | FAIL | PASS | PARTIAL/FAIL | PASS | PASS | PASS | `prototype-manager-my-database.png` |
| assistant | PASS | PASS | PASS | N/A | PASS | NOT RUN | PASS | PASS | PASS | нет отдельного экрана → сравнение с manager-like + баннер |
| regional_manager | PASS | FAIL | PASS | FAIL | PASS | NOT RUN | PASS | PASS | PASS | `prototype-regional-retail-points.png` |
| rop | PASS | FAIL | FAIL | PASS | PARTIAL | NOT RUN | PASS | PASS | PASS | `prototype-rop-my-team.png`, `prototype-rop-team-database.png` |
| director | PASS | FAIL | FAIL | PASS | PARTIAL | NOT RUN | PASS | PASS | PASS | `prototype-director-all-database.png` |
| admin | PASS | FAIL | FAIL | PASS | PASS* | NOT RUN | PASS | PASS | PASS | `prototype-admin-all-database.png` (+ field map NOT RUN) |

\* Admin: панель обновления 1С — продуктовое отличие (C), не FAIL по функции.

### NOT RUN (нужен материал или отдельный прогон)

- Пустой результат поиска, ошибка загрузки + «Повторить» — не снимались в этом прогоне (нет стабильного fault injection).
- Admin «Карта полей» — в приложении нет route (блокер B).
- Assistant/regional/director/rop/admin — полный сценарий карточки с вложенными переходами (частично: manager card+return PASS).

## Сопоставление с эталоном (кратко)

| Роль | Прототип | Реализация (77bd0c3) | Класс |
|------|----------|----------------------|-------|
| manager | «Моя база», KPI 3/5, field-builder, chips TOP/ИНН/…, 5 колонок | «Юрлица», KPI v3, v3 select + chips, 4 колонки, entity «Юрлица/ТТ» | B/C |
| assistant | Баннер замещения (демо) | Баннер + KPI «Клиенты замещения», legal-only | A частично / PASS функция |
| regional | Старт ТТ, regional filters | retail-first, v3 filters | B (multiselect) |
| rop | Карточки сотрудников, метрики | compact team + вкладки «База команды/Моя команда» | C |
| director | РОП cards + expand стиль прототипа | compact overview | C |
| admin | Обзор + карта полей | director layout + 1С panel | B (карта полей) |

## Отличия A / B / C

### A — локальные (исправлены ранее в PR; на 77bd0c3 переснято)

- Сетка v3 filters (min-width), sticky search mobile, скрытие неработающих legacy filters.

### B — контракт / поведение (блокеры визуальной приёмки)

1. Multiselect и «Фильтры по всем полям» прототипа vs v3 dropdowns — нужен контракт v3 или упрощённый эталон.
2. Row quick actions — нет разрешённых операций.
3. Карточка: блоки LPR/скидки/наценки — проверить detail API; полный набор полей прототипа не воспроизведён.
4. Admin «Карта полей и источников» — нет маршрута.

### C — продукт vs демо-прототип

1. Панель обновления 1С (admin) — оставлена.
2. Компактные team cards vs «employee cards» прототипа.
3. Заголовки «Юрлица» vs «Клиенты, ТТ и ответственные» — копирайт/IA.

## Вопросы владельцу (для закрытия визуала)

1. Принимаем v3 select+chips вместо field-builder прототипа для R2 или требуем parity?
2. Row actions — перечень разрешённых операций?
3. Карта полей admin — scope релиза?
4. Compact team UI — достаточно функционально или нужен design pass?

## Технические регрессии (SHA `77bd0c3`, этот прогон)

| Команда | Exit |
|---------|------|
| `npm run typecheck` | 0 |
| `npm run build` | 0 |
| `npm test` | 696 pass, 0 fail |
| `test/integration/clients-v3-api.test.ts` | 6 pass |
| `test/integration/clients-assistant-delegation-presentation.test.ts` | 11 pass |
| `test/browser/clients-v3.browser.test.ts` | 8 pass |
| `test/browser/clients-v3-roles-entry.browser.test.ts` | 6 pass |
| `test/browser/clients-v3-visual-acceptance.browser.test.ts` | 8 pass (capture only) |

**Не являются доказательством визуального PASS.**
