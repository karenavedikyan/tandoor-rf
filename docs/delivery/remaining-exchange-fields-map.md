# F0 — карта оставшихся полей обмена 1С → ЛК

**Серия:** F (после G1/G2 на `main`; **не** зависит от G3 / PR #62)  
**F0:** исследование (PR #63). **F1:** опубликован на `main` (merge PR #64, `45c2e58`). **F2:** реализован в подтверждённом объёме (PR #66) — [f2-top-source-blocker.md](./f2-top-source-blocker.md).  
**Актуальная выгрузка FTP 08.10.2026:** на агенте **не** читалась; для F2 использован **исторический** read-only audit снимка **04.10.2026** (SHA `b439063…`, fixture `test/fixtures/onec-clients/recovered-exchange-structure.json`).

**Эталон UI (не доказательство JSON):** [прототип «Вся информация о клиенте»](https://www.perplexity.ai/computer/a/tandoor-rf-vizualnyi-prototip-TyhOzG0mT06dPTayt88xTA) — секции «Холдинг / юрлица», «ЛПР», «Расчёты и договор», «Магазин и доставка» задают целевое отображение.

**Правило доступа (F1):** читатель **доступной** записи клиента/ТТ видит все **бизнес-поля** этой ТТ в DTO/UI, включая ЛПР. Доступ к родителю **не** открывает соседние ТТ. Preview — scope целевого сотрудника, read-only.

---

## 1. Источники и происхождение

### 1.1 Файл в среде F0

| Проверка | Результат |
|----------|-----------|
| `all_clients.json` в репозитории / VM | **нет** |
| `AUDIT_CLIENTS_PATH` | **не задан** (в т.ч. прогон F2 **2026-10-08**) |
| `/LC/clients/all_clients.json` на VM F2 | **нет** |
| `npm run audit:exchange-fields` | fixtures + синтетика `extended_v1` (см. §1.3); TOP/юрлица/договоры **не** в union |

**Вывод:** отсутствие поля в fixtures/parser **не** доказывает отсутствие в production JSON. Ниже — сверка **код + зафиксированные live-свидетельства + синтетика**.

### 1.2 Зафиксированные снимки `all_clients.json` (read-only, не в repo)

| Снимок | Путь | Дата / контекст | SHA-256 | Записей | Ключи верхнего уровня (наблюдение) |
|--------|------|-----------------|---------|---------|-----------------------------------|
| **Legacy** | `/LC/clients/all_clients.json` | FTP 23.09.2026; сверка 28.09.2026 | `dc0f7f243d083d9fc6aeb14fbed8db42babd2a78e9b57da2ac2f85cd969e0086` | 3 824 | 8 импортируемых + `Discount`, `DiscountAmount`, `Markups` |
| **Extended live** | тот же путь | проверка **03.10.2026** (~20,9 MiB) | `52307bbde0dbb1f076b8eee9dd56c3a4a2134bd19ffb8164e885a2f55d690b10` | 3 087 клиентов, 473 вложенные ТТ | legacy-ключи + `holding`, `retail_outlets[]`, доп. ответственные, вложенные блоки (см. [clients-field-contract.md §3.2](./clients-field-contract.md#32-live-наблюдения-и-поддержанные-адаптации-03102026)) |
| **F2 recovered audit** | тот же путь | снимок **04.10.2026**; аудит **08.10.2026** (read-only) | `b439063b1602743ab1df56ee6390ba9d3cc64dce7cdc24763c3d4d7176c74b74` | 3 087 / 473 ТТ | подтверждены `Оптовик_Топ150`, `Оптовик_КатегорияТорговойТочкиТандор` + задел F3 строк (§8–§9) |

Источники метаданных: [r02-existing-evidence.md](./r02-existing-evidence.md), [clients-field-contract.md](./clients-field-contract.md), [f2-top-source-blocker.md](./f2-top-source-blocker.md).

**Актуальность после 03.10.2026 в F0 не перепроверялась** — для свежего SHA нужен запрос к Computer (§1.4).

Связанные файлы обмена (вне `all_clients.json`, но для контекста F/G):

| Файл | Назначение | В F0 |
|------|------------|------|
| `/LC/clients/all_employees.json` | roster сотрудников (`guid_team` / `name_team` — **членство в команде**, не лидер группы) | не аудировался локально; G3 отдельно |
| `/LC/catalog/*/data.xml` | каталог | вне scope F0 |

### 1.3 Подтверждение ключей в репозитории (не live)

| Источник | Назначение |
|----------|------------|
| `test/fixtures/onec-clients/valid-two-records.json` | legacy 8 ключей |
| `test/fixtures/onec-clients/extra-unknown-fields.json` | `Discount`, `DiscountAmount`, `Markups[]` |
| `test/helpers/onec-clients-extended-fixtures.ts` | контракт `extended_v1` (полный перечень путей для audit) |
| `test/helpers/onec-clients-live-fixtures.ts` | **форма** live-полей без PII (не выгрузка) |
| `scripts/audit-exchange-fields.ts` | read-only union ключей |

### 1.4 Запрос к Computer (если нужен свежий structural slice)

Один read-only прогон по **последнему** `/LC/clients/all_clients.json`:

1. **Метаданные:** размер, число записей, **SHA-256**, дата чтения (UTC), без содержимого массива.
2. **Union JSON-путей** по всему файлу (как `audit-exchange-fields`, `scanAll=true`), плюс список **top-level ключей**, встречающихся хотя бы в одной записи, но **не** входящих в известный контракт (§2–§8).
3. **Обезличенный structural slice:** 3–5 записей с **разными формами** (legacy-only, extended с `retail_outlets`, с коммерческими полями), значения заменить на `"…"` / `0` / `false`, **сохранить ключи, типы, вложенность и GUID-связи** (можно синтетические UUID).
4. **Агрегаты без PII** для путей из §2–§8: доля записей с ключом; для `LPR_information.*`, `additional_information.*`, коммерческих полей — доля непустых / sentinel (`0001-01-01…`); для неизвестных блоков «юрлиц»/«договоров»/«TOP» — **имена ключей и типы**, если найдены.
5. **Не** передавать: полные ФИО, телефоны, email, ИНН/КПП/счета, даты рождения, полный файл.

Положить артеfact в repo: `test/fixtures/onec-clients/f0-live-structural-slice.json` (или приложение к PR) + обновить §1.2 этой карты.

---

## 2. Легенда статусов (сквозная)

| Статус | Значение |
|--------|----------|
| **не подтверждено в актуальной выгрузке** | Ключ **не** наблюдался в зафиксированных live-свидетельствах и **не** в контракте extended fixtures; возможно появится позже — нужен §1.4 |
| **в источнике, часто пусто** | Ключ есть; значимая доля пустых/sentinel (зафиксировано для live где известно) |
| **парсится → хранится** | validate/apply кладёт в `onec_clients` / `extended_snapshot` / registry |
| **хранится, скрыто UI/API** | В snapshot есть, DTO не отдаёт или заглушка |
| **отображается** | Карточка и/или список и/или фильтр (Sprint 2/3) |
| **повторный импорт** | Нужен ли re-import после доработки parser/storage |

**Цепочка:** JSON → `extended-validate.ts` / legacy `validate.ts` → `extended-apply.ts` / legacy upsert → `extended_snapshot` JSONB → `extended-dto.ts` / list DTO → `public/client-card*.js`, `public/clients*.js` → `field-filter-registry.ts`.

**Production apply расширения:** по умолчанию `extendedContractVerification=unverified` — расширенный блок может **не** попадать в рабочий snapshot до подтверждения контракта ([clients-field-contract.md §3](./clients-field-contract.md)). Legacy 8 ключей применяются всегда.

---

## 3. Legacy — восемь ключей (уровень клиента)

| JSON-путь | Тип | Источник | Хранение | DTO / карточка | Колонки | Фильтры | Статус ЛК | Re-import |
|-----------|-----|----------|----------|----------------|---------|---------|-----------|-----------|
| `guid_client` | UUID string | legacy + extended | PK `onec_clients` | id | — | scope | **отображается** | нет |
| `name_client` | string | да | column | name | name | `q` | **отображается** | нет |
| `guid_holding` / `name_holding` | string | да | columns | holding | holding | `holding` | **отображается** | нет |
| `guid_manager` / `name_manager` | UUID + string | да | columns | manager | manager | `clientManager`, `missing*`, `*Mode` | **отображается** | нет |
| `address` | string | да | column | address | address | `q`, filled/empty | **отображается** | нет |
| `telephone[]` | string[] | да | JSONB | phones | phone | `phone`, `q`, filled/empty | **отображается** | нет |

См. [sprint2-field-map.md](./sprint2-field-map.md).

---

## 4. Коммерческие поля (уровень клиента)

| JSON-путь | Тип (наблюдение) | Источник | Parser | Хранение | Карточка | Колонки clients | Фильтры | Статус | Re-import |
|-----------|------------------|----------|--------|----------|----------|-----------------|---------|--------|-----------|
| `Discount` | string | legacy снимок: ключ у всех записей; 244 непустых | `commercial-fields.ts` | `extended_snapshot.commercial.discountProgram` при **extended apply** | read-only label | `discountProgram` | `discountProgram`, filled/empty | **отображается**, если snapshot содержит commercial; legacy-only import — **не сохраняется** | да, если prod без extended snapshot |
| `DiscountAmount` | number | ключ у всех в legacy снимке |同上 | `commercial.discountAmount` | label | `discountAmount` | min/max, filled/empty |同上 |同上 |
| `Markups[]` | `{ Name, Percentage }[]` | 18 непустых массивов в legacy |同上 | `commercial.markups` | список | — | `markupName`, `markupPercentage`, filled/empty | карточка + фильтр; **не** колонка списка |同上 |

Legacy import: warning `EXTRA_FIELDS`, **не** в parsed 8 полей.  
См. [sprint3-field-map.md](./sprint3-field-map.md), [clients-field-contract.md §2](./clients-field-contract.md#2-коммерческие-поля--наблюдение-vs-смысл-vs-импорт).

**Осталось для F6:** согласовать с 1С семантику (Q4–Q6) — не блокирует отображение уже сохранённых значений.

---

## 5. Extended — клиент (вне `retail_outlets`)

| JSON-путь | Тип | Live 03.10 | Parser / storage | Карточка | Список / фильтр | Статус | Re-import |
|-----------|-----|------------|------------------|----------|-----------------|--------|-----------|
| `holding` | boolean | да | snapshot | «Данные» | — | **отображается** | при blocked extended — snapshot может не обновляться |
| `guid_regional_manager` / `name_regional_manager` | UUID + string | да | snapshot | ответственные | regional + 8-filter set | **отображается** | см. extended gate |
| `guid_hardware_manager` / `name_hardware_manager` | UUID + string | да | snapshot | да | hardware + filters | **отображается** |同上 |
| `guid_head_of_the_sales_department` / `name_head_of_the_sales_department` | UUID + string | да | snapshot; **РОП клиента**, не лидер команды 1С | да | rop + filters | **отображается** |同上 |
| `retail_outlets` | array | 473 ТТ | `currentRetailOutlets` + history + `onec_retail_outlets` | вкладка «Данные» | `outletsCount`, entity=outlets | **отображается** (с R13 outlet access) | да для новых полей внутри ТТ |

**Не в `all_clients.json`:** `guid_team` / `name_team` — поля **roster** (`all_employees.json`), Sprint G; в F0 не смешивать с клиентским JSON.

---

## 6. Торговые точки — `retail_outlets[]` (кроме ЛПР)

| JSON-путь | Тип | Live / контракт | Хранение | DTO / UI | Фильтры (clients/outlets) | Статус | Re-import |
|-----------|-----|-----------------|----------|----------|---------------------------|--------|-----------|
| `guid_store` | UUID | 472/473 с GUID (03.10) | snapshot + registry PK | ID ТТ, identity | — | **отображается** | нет |
| `closed` | boolean | да | snapshot + closure history | статус ТТ | `outletStatus` | **отображается** | нет |
| `holding` | string | да | snapshot | название на ТТ | — | **отображается** | нет |
| `warehouse` | boolean | да | snapshot | склад | `warehouse` | **отображается** | нет |
| `address.store_address` | string | да | snapshot | адреса | `storeAddressContains`, filled/empty | **отображается** | нет |
| `address.delivery_address` | string | да | snapshot | адреса | filled/empty delivery | **отображается** | нет |
| `address.direction_of_the_route` | string | да | snapshot | маршрут | `routeDirection`, filled/empty | **отображается** | нет |
| `information_loading.loading_on_*` | boolean | пн/ср/пт в контракте | snapshot | приёмка | `loadingSchedule`, filled/empty | **отображается** (не все дни в JSON-именах — см. parser) | нет |
| `information_loading.loading_time` | time / ISO sentinel | `0001-01-01T…` live | snapshot | время приёмки | `loadingTime`, filled/empty | **отображается** (ambiguous → не публикуется как 00:00) | нет |
| `managers.*` (4 роли) | UUID + name | null UUID live | snapshot | ответственные ТТ | 4× outlet filters + mode | **отображается** | нет |
| `contact_information.store_phone` | string | да | snapshot | контакты | contains + filled/empty | **отображается** | нет |
| `contact_information.accountant_phone` | string | да | snapshot | контакты |同上 | **отображается** | нет |
| `contact_information.accountant_email` | string | да | snapshot | контакты |同上 | **отображается** | нет |
| `additional_information.status_tandoor_club` | string | да | snapshot | Tandoor Club | `tandoorClub`, filled/empty | **отображается** | нет |
| `additional_information.bonus_tandoor_club` | string/number → string | live number | snapshot | bonus club | `bonusTandoorClub`, filled/empty | **отображается** (Sprint 3) | нет |

**Прототип:** блок «Магазин и доставка» — largely covered; «Особенности работы» — **нет отдельного JSON-блока** в контракте (placeholder UI).

---

## 7. ЛПР и персональные бонусы (F1)

| JSON-путь | Тип (контракт + истор. live) | Parser → storage | DTO / карточка (F1) | Список ТТ / фильтры (F1) | Re-import |
|-----------|------------------------------|------------------|---------------------|--------------------------|-----------|
| `…LPR_information.name` | string | `outlet.lpr` + `fieldPresence.name` | `RetailOutletDto.lpr.name` | колонка `lprName`; `lprNameContains`; filled/empty `lprName` | нет |
| `…post` | string | да | `lpr.post` | `lprPost*` | нет |
| `…phone` | string | да | `lpr.phone` | `lprPhone*` | нет |
| `…email` | string | да | `lpr.email` | `lprEmail*` | нет |
| `…date_of_birth` | ISO / sentinel | sentinel → explicit empty | `lpr.dateOfBirth` (без TZ-сдвига) | `lprDateOfBirth`, `From`, `To`; filled/empty | нет |
| `…bonus` | string (из number) | string в snapshot | `lpr.bonus` (`"0"` — значение) | `lprBonus*` | нет |
| `…conditions_bonus` | string | да | `lpr.conditionsBonus` | `lprConditionsBonus*` | нет |

Код: `src/clients/lpr-fields.ts`, `extended-dto.ts` → `toOutletDto`; UI: `client-card-prototype.js` (блоки «Контакт ЛПР», «Бонусные условия»); список — `public/clients-logic.js`.

**Snapshot достаточен для отображения**, если `extended_snapshot.currentRetailOutlets[].lpr` уже заполнен импортом. Для снимков **до F1** без `fieldPresence` DTO и SQL-LPR-фильтры используют сохранённые непустые скаляры и маркеры DOB (sentinel/ambiguous/preserved); пустые строки по умолчанию **не** считаются «передано». **Re-import / backfill `fieldPresence` не обязателен** для чтения старых данных; backfill имеет смысл только для записей без extended apply (F6) или если нужна явная семантика «поле передано, но пусто» vs «не передано» на legacy-пустых полях.

---

## 8. ТОП-150 / 350 / 500 и категория 1С (F2)

| Тема | JSON-путь | Уровень | Parser / snapshot | ЛК | Статус | Re-import |
|------|-----------|---------|-------------------|-----|--------|-----------|
| **ТОП-150 (1С)** | `Оптовик_Топ150` | **клиент** | `wholesale-client-exchange-fields.ts` → `extended_snapshot.wholesaleExchange.top150` | колонка `onecTop150`, карточка, фильтры clients | **отображается** (строка as-is; в снимке 04.10 только `Нет`) | да, если extended apply ранее без ключей |
| **Категория 1С** | `Оптовик_КатегорияТорговойТочкиТандор` | **клиент** | `wholesaleExchange.outletCategory` | колонка `onecCategory`, карточка, фильтры clients | **отображается** (A/В/C/D **не** = TOP) | да |
| TOP-350 / TOP-500 | — | — | — | колонка `category` **`hasSource: false`** (прототип) | **не подтверждено** | — |
| Сегмент холдинга / уровень ТТ для категории | — | — | — | не выводится из названия ключа | **не подтверждено** | — |

Источник: historical audit SHA `b439063…` ([f2-top-source-blocker.md](./f2-top-source-blocker.md)). **Не** объявлять positive TOP «Да», пока не наблюдалось в актуальной выгрузке.

**F3/F4 (строки того же снимка):** скалярные поля контрагента F3 — **подключены** (§9); массивы юрлиц/договоров в снимке **не** найдены; F4 — §10.

---

## 9. Юрлица и реквизиты (F3)

| Поле (бизнес) | JSON-путь | Наблюдение | Parser | ЛК | Статус |
|---------------|-----------|------------|--------|-----|--------|
| GUID юрлица | — | Q8 открыт; в снимке 04.10 **нет** массива юрлиц | — | Bitrix24 `legal_entity` — **отдельный** LK объект | **не подтверждено** (массив / справочник) |
| Контрагент (строка) | `Контрагент` | все 3 087 клиентов, string | `counterparty-exchange-fields.ts` → `extended_snapshot.counterparty` | колонка `onecCounterparty`, карточка, `onecCounterpartyContains`, filled/empty | **отображается** (F3 scalar) |
| Юр/физ лицо | `ЮрФизЛицо` | `Компания` / `Частное лицо` |同上 | колонка `onecLegalEntityType`, карточка, exact filter, options | **отображается** (F3 scalar) |
| ОГРН (строка) | `Оптовик_ОГРН` | часто заполнено; ведущие нули as-is |同上 | колонка `onecOgrn`, карточка, exact filter | **отображается** (F3 scalar) |
| Полное наименование | `НаименованиеПолное` | все клиенты |同上 | колонка `onecFullName`, карточка, `onecFullNameContains`, filled/empty | **отображается** (F3 scalar) |
| Код 1С (строка) | `Код` | все клиенты | — | колонка `code1c` **`hasSource: false`** | **в источнике**, **F5** (не F3) |
| Название, ИНН, КПП, адрес юрлица | — | **нет** отдельных ключей в снимке 04.10 | — | колонка `inn` **`hasSource: false`** | **не подтверждено** |
| Банк, БИК, расчётные счета | — | — | — | не в UI | **не подтверждено в актуальной выгрузке** |

**GUID-связи (целевая модель, не выдумывать правила удаления):**

- Ожидается **0..N** юрлиц на холдинга/клиента с явными GUID из 1С.
- Связь ТТ ↔ юрлицо: **только по GUID из источника**; **не** предполагать «1 ТТ = 1 юрлицо».
- Отсутствие ключа в следующем снимке **не** трактовать автоматически как удаление (см. политику extended freshness).

**F3 (реализовано):** четыре скалярных поля контрагента на уровне клиента (parser, snapshot, list/card DTO, фильтры clients-only). **Не входит в F3:** полный справочник юрлиц 0..N, ИНН/КПП/банк, `Код` 1С.

**Блокер справочника юрлиц (0..N):** обезличенный образец массива в JSON (§1.4, Q8).

---

## 10. Договоры (F4)

| Поле | JSON-путь | Наблюдение | ЛК | Статус |
|------|-----------|------------|-----|--------|
| Основной договор (строка) | `Оптовик_ОсновнойДоговор` | не массив; не GUID-связь | — | прототип «Плательщик / договор» | **в источнике**, F4 |
| Основное соглашение (строка) | `Оптовик_ОсновноеСоглашение` | string | — | — | **в источнике**, F4 |
| GUID договора / массив договоров | — | **нет** в снимке 04.10 | — | — | **не подтверждено** |
| Номер, дата, статус | — | — | — | **не подтверждено в актуальной выгрузке** |
| Оплата, отсрочка, лимит | — | — | — | **не подтверждено в актуальной выгрузке** |

**Множественность:** ожидается **0..N** договоров на юрлицо с GUID-связями; без live-ключей cardinality не фиксируется.

**Блокер F4:** тот же structural slice / спецификация 1С.

---

## 11. Прочие поля UI без источника в JSON

| UI / колонка | JSON | Статус |
|--------------|------|--------|
| `code1c` | JSON `Код` подтверждён в снимке 04.10; **не** подключён в UI | `hasSource: false` до F5 |
| `city` | нет отдельного ключа (адрес — одна строка на legacy) | **не подтверждено в актуальной выгрузке** |
| `cashback` (client/outlet) | не в extended audit | **не подтверждено в актуальной выгрузке** |
| `nextStep` | Bitrix24 / LK, не 1С | вне F |
| `warehouse` / `tandoorClub` на **entity=clients** (агрегат) | частично из outlets | колонки client-level **`hasSource: false`** (данные на уровне ТТ) |
| «Временно замещает» | — | **не подтверждено в актуальной выгрузке** |

---

## 12. Сводка «что уже подключено vs осталось»

```mermaid
flowchart LR
  subgraph done [Подключено в ЛК]
    L8[Legacy 8]
    EX[Extended client + outlets]
    COM[Commercial in snapshot]
    FIL[Sprint 2/3 filters]
    LPR[LPR F1 card list filters]
    F2W[F2 TOP150 + category 1C]
    F3C[F3 counterparty scalars]
  end
  subgraph missing [Нет подтверждённого JSON-пути / не подключено]
    TOP350[TOP-350/500]
    LEGDIR[Legal entity directory 0..N]
    CON[Contracts F4]
    PLH[code1c inn city cashback]
  end
  JSON[all_clients.json] --> L8
  JSON --> EX
  JSON --> COM
  JSON --> LPR
  JSON --> F2W
  JSON --> F3C
  JSON -.-> TOP350
  JSON -.-> LEGDIR
  JSON -.-> CON
```

| Область | Подключено | Осталось |
|---------|------------|----------|
| Контакты клиента, адрес legacy | да | — |
| Ответственные client + outlet | да | multi-select polish — не F0 |
| Доставка, приёмка, контакты ТТ, Club | да | расширение дней погрузки — только если появится в JSON |
| Commercial Discount/Markups | да при snapshot | семантика 1С; prod extended gate |
| LPR + DOB + bonus LPR | **F1:** DTO + карточка + фильтры (main) | — |
| TOP-150 + категория 1С (клиент) | **F2:** parser + UI (PR #66) | TOP-350/500; prod F6 |
| Контрагент / ОГРН / тип / полное имя (клиент) | **F3:** parser + UI + filters | справочник юрлиц 0..N; prod F6 backfill |
| Договоры | — | **F4** + live slice |
| Колонки-заглушки (`code1c`, `inn`, …) | — | **F5–F6** после появления полей |

---

## 13. Готовность F1–F6

| Этап | Scope | Готовность к старту | Зависимости / блокеры |
|------|-------|---------------------|------------------------|
| **F0** | Карта полей F | **Карта есть**; свежая полнота live-источника **ещё проверяется** | §1.4 / Computer |
| **F1** | ЛПР, DOB, `bonus` / `conditions_bonus` | **Опубликовано** (`main`, PR #64) | R13: scope ТТ; внутри доступной ТТ — все поля ЛПР |
| **F2** | `Оптовик_Топ150`, `Оптовик_КатегорияТорговойТочкиТандор` | **Код готов** (PR #66); TOP-350/500 **не** подтверждены | Historical audit 04.10; [f2-top-source-blocker.md](./f2-top-source-blocker.md) |
| **F3** | Скаляры контрагента (`Контрагент`, `ЮрФизЛицо`, `Оптовик_ОГРН`, `НаименованиеПолное`) | **Реализовано** (код + тесты); справочник юрлиц **не** входит | Historical audit 04.10; §1.4 для 0..N юрлиц |
| **F4** | Договоры и условия | **Осталось** | Как F3 |
| **F5** | Оставшиеся фильтры / колонки / UI parity | **Осталось** | Зависит от F2–F4 для category/inn/city |
| **F6** | Заполнение новых данных, backfill, сверка | **Осталось** | После F2–F5; prod extended gate; без force/hash подмены |


---

## 14. Открытые вопросы 1С (перекрёстно)

| ID | Связь с F |
|----|-----------|
| Q1 | F3 — что такое `guid_client` |
| Q4–Q6 | F6 — commercial semantics |
| Q8, Q10d | F2–F4 — extended + live JSON |
| Q10a–Q10c | в основном закрыто кодом; outlet access — R13 |

Полный список: [onec-specialist-questions.md](./onec-specialist-questions.md).

---

## 15. Связанные документы

- [clients-field-contract.md](./clients-field-contract.md)
- [sprint2-field-map.md](./sprint2-field-map.md)
- [sprint3-field-map.md](./sprint3-field-map.md)
- [r02-existing-evidence.md](./r02-existing-evidence.md)
- [f2-top-source-blocker.md](./f2-top-source-blocker.md) (F2)

**Audit locally:** `AUDIT_CLIENTS_PATH=/path/to/all_clients.json npm run audit:exchange-fields`
