# Матрица полей обмена → карточка клиента v3

Снимок инвентаря: 2026-10-20 (SHA файлов — в задании владельца).  
Статусы UI: **shown** — отображается при наличии в БД; **empty-1c** — «Нет данных из 1С»; **not-in-exchange** — не входит в JSON; **external** — другой источник; **restricted** — скрыто правами.

## Юрлицо (`all_clients.json`)

| Путь JSON | Parser / import | Хранение | API detail | UI | Пусто |
|-----------|-----------------|----------|------------|-----|-------|
| `guid_client` | `parse-records` | `onec_v3_legal_entities.guid_client` | `guid` | заголовок | empty-1c |
| `name_client` | parse | `name_client` | `name` | заголовок, Данные | empty-1c |
| `inn`, `kpp` | parse | columns | `inn`, `kpp` | Данные | empty-1c |
| `guid_holding`, `name_holding` | parse | columns | `holding_*` | ссылка холдинга | empty-1c |
| `type_category.*` | parse → JSONB | `type_category` | `type_category` | ТОП: `nameType`; категория: `nameCategory` | empty-1c |
| `markups[]` | parse | `markups` | `markups` | Данные → наценки | empty-1c |
| `Discount`, `DiscountAmount` | parse | `discount`, `discount_amount` | same | Данные → коммерция | показывать 0 |
| `guid_manager`…`guid_head_of_the_sales_department` | parse | `managers` JSONB | `managers` | Ответственные | «Не назначен в 1С» |
| `address`, `telephone[]` | parse | columns | same | Обзор / Данные | empty-1c |
| `other.*` (все ключи инвентаря) | `pickSupportedOtherFields` (полное сохранение) | `other_fields` JSONB | `other_fields` | Данные → группы + «Все данные 1С» | ключ отсутствует → строка не выводится; значение null/"" → пропуск |

### `other` — группы UI (`client-detail-exchange-catalog.js`)

Каждый ключ из инвентаря `all_clients.json` `$[].other.*` перечислен в `V3_CLIENT_OTHER_INVENTORY_KEYS` (`src/onec-exchange-v3/other-fields.ts`) и имеет подпись в `public/client-detail-exchange-catalog.js`. Непопавшие в группы ключи (включая будущие) отображаются в раскрываемом блоке **«Все данные 1С (дополнительные поля)»** с fallback-подписью = исходный ключ.

Даты ISO с годом `0001` форматируются как время (`08:00`); иные даты — `ДД.ММ.ГГГГ ЧЧ:ММ`.

## Холдинг (`all_holding.json`)

| Путь | Хранение | UI |
|------|----------|-----|
| `guid_holding`, `name_holding` | `onec_v3_holdings` | заголовок |
| `type_category` | JSONB | ТОП / тип (только тип холдинга) |
| `retail_chain`, `holding_group` | columns | Данные |
| `managers` | JSONB | Ответственные |
| `legal_entities[]`, `retail_outlets[]` | composition API | состав (scoped) |

## Торговая точка (`all_retail.json`)

| Путь | Хранение | UI |
|------|----------|-----|
| `guid_store` | `onec_v3_retail_outlets` | заголовок (адрес) |
| `type_category` | JSONB | ТОП: `nameType`, категория |
| `address.*` | JSONB | Данные |
| `information_loading.*` | JSONB | приёмка |
| `managers` | JSONB | ответственные ТТ |
| `contact_information.*` | JSONB | контакты (не ЛПР) |
| `LPR_information.*` | JSONB | ЛПР |
| `additional_information.*` | JSONB | Club |
| `warehouse`, `closed` | columns | статусы |

## Сотрудники (`all_employees.json`)

| Путь | Хранение | UI в карточке клиента |
|------|----------|------------------------|
| `email`, `telephone`, `date_of_assumption`, `work_schedule` | roster tables | только через назначения / политику employee visibility; не в общем API карточки |

## Продажи (`sale.json`)

| Путь | Import | UI |
|------|--------|-----|
| `month`, `client_info.id`, `sale_info.*` | `onec_v3_sales_lines` (отдельный apply) | вкладка «Продажи» (только юрлицо) |

Пока `sales_lines` не применены в БД: **«Данные из 1С ещё не загружены»** на вкладке при пустом ответе API (не смешивать с empty-1c по полю).

## Разделы карточки (прототип)

| Вкладка | Источник | Статус в PR |
|---------|----------|-------------|
| Обзор, Данные | 1С v3 | shown |
| Продажи | sale.json | shown при данных |
| Работа, Рекламации | Битрикс24 | external (видима, честный текст) |
| Витрина, Заказы, Финансы, Документы, План | вне clients JSON | external |

## Список v3: колонка ТОП

`category_name` в SQL списка юрлиц/ТТ берётся из `type_category.nameType` (ТОП), `type_name` — из `nameCategory` где есть.
