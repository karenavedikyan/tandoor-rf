# QA flows (не public/dist)

## Существующие клиенты (PR103 guard)

1. Вход менеджер/РОП/директор → `/clients?v3mode=1&…`
2. Teams → regional / manager / hardware portfolio
3. Fullscreen TOP → search → reset → Esc → reopen (scope + empty TOP)
4. Карточка legal → вкладка «Продажи» → Back

## Сводка продаж на карточке и в списке (PR client-sales-summary)

1. `/clients?v3mode=1&v3entity=legal_grouped` — при включённых колонках «Продажи» подгружается batch `/api/clients/v3/client-sales/batch` (только текущая страница).
2. `v3salesMonth=YYYY-MM` в URL списка → карточка `?v3salesMonth=` → Back сохраняет месяц.
3. Карточка holding/legal, вкладка **Обзор**: три плитки (₽, ед., юрлица с продажами) + раскрытая таблица юрлиц; ссылка «Подробнее» → вкладка «Продажи».
4. Retail / orphan_retail: без колонок продаж и без блока на обзоре.
5. Месяц только из API (`/api/clients/v3/client-sales/months`), по умолчанию последний импортированный.

## Новый раздел «Продажи»

1. Sidebar: **Клиенты** → **Продажи** (`/sales`)
2. Период (month из API), territory query params как у v3 list (`teamGuid`, `ropBranchGuid`, `responsibleGuid`, …)
3. Вкладки **Продажи** / **Возвраты** (signed values)
4. Сводка ВХ / МК / Фурнитура + таблица 5 категорий
5. Пустое production: «Нет загруженных данных из 1С»

## Viewports

- Desktop 1280×800
- Mobile 375×812

## Роли

- Менеджер: без новых финансовых полей
- РОП: без себестоимости (как legal-sales)
- Директор/admin: полный набор где разрешено `canViewMarginFields`
