# QA flows (не public/dist)

## Существующие клиенты (PR103 guard)

1. Вход менеджер/РОП/директор → `/clients?v3mode=1&…`
2. Teams → regional / manager / hardware portfolio
3. Fullscreen TOP → search → reset → Esc → reopen (scope + empty TOP)
4. Карточка legal → вкладка «Продажи» → Back

## Сводка продаж на карточке и в списке (PR client-sales-summary)

1. `/clients?v3mode=1&v3entity=legal_grouped` — при включённых колонках «Продажи» (в т.ч. «По юрлицам») подгружается `GET /api/clients/v3/client-sales/batch` (readChain; territory query как у v3 list). Проверить реальный выбор четырёх полей в диалоге, обычный/мобильный/полноэкранный список.
2. Селектор «Месяц продаж» в filterbar + `v3salesMonth=YYYY-MM` в URL → карточка `?v3salesMonth=` → Back сохраняет месяц.
3. Карточка holding/legal, вкладка **Обзор**: три плитки + таблица юрлиц; «Подробнее» → `/clients/{legalGuid}?v3Entity=legal&cardTab=sales&v3salesMonth=…&return=…` (сохраняются период, территория и исходный список). Возврат из раздела «Продажи» не подменяется возвратом в «Клиенты».
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

- Менеджер: выручка, единицы и количество юрлиц только в разрешённой области; без новых полей себестоимости/маржи.
- РОП: без себестоимости (как legal-sales)
- Директор/admin: полный набор где разрешено `canViewMarginFields`
