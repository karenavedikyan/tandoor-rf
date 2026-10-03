# Контракт полей — `all_clients.json`

**SHA main (база):** `cd276e67193efa48a1c48fe14bd43aca530ae9ae` (merge PR #9)  
**Снимок обмена:** 23.09.2026 — см. [r02-existing-evidence.md](./r02-existing-evidence.md) (**ранее прочитан**, не новая проверка FTP)  
**Файл:** `{ONEC_FTP_BASE_PATH}/clients/all_clients.json` (см. [source-contracts.md](./source-contracts.md))  
**Формат:** JSON-массив объектов; UTF-8; BOM допустим.

Уровни доказательства:

| Метка | Значение |
|-------|----------|
| **код** | `KNOWN_CLIENT_KEYS`, `validate.ts`, `apply.ts` на main |
| **тест** | unit/integration в репозитории |
| **снимок** | наблюдалось в ранее прочитанном `/LC/clients/all_clients.json` (3824 записи, SHA `dc0f7f24…`) |
| **согласовано 1С** | письменное подтверждение семантики — **нет** |
| **синтетика** | `test/fixtures/onec-clients/*` — **не** исходная выгрузка |

---

## 1. Восемь ключей текущего импорта (подтверждено кодом + тестами)

| Поле | Тип JSON | Смысл (контракт UI/БД) | Обязательность | Пустые значения | ID / связи | Импорт main | Релиз |
|------|----------|------------------------|----------------|---------------|------------|-------------|-------|
| `guid_client` | string UUID | Стабильный ID **строки snapshot** в ЛК; PK `onec_clients` | да | null UUID запрещён | PK; **не** утверждение «юрлицо» или «ТТ» | validate + upsert | **R1** (есть) |
| `name_client` | string | Отображаемое имя клиента в списке/карточке | да | trim → пусто = **ошибка** `EMPTY_NAME` | не связывать с другими объектами по имени | сохраняется | R1 |
| `guid_holding` | string | UUID холдинга **на строке** | ключ обязателен | `""` → NULL в БД | пара с `name_holding`; **не** нормализованная таблица | сохраняется | R1 |
| `name_holding` | string | Имя холдинга на строке | ключ обязателен | `""` допустимо только если `guid_holding` тоже `""` | **HOLDING_CONTRACT:** id и name оба пустые или оба непустые | сохраняется | R1 |
| `guid_manager` | string UUID | ID менеджера **из 1С** на записи клиента | да | null UUID запрещён; см. §1.1 | **не** `users.id` ЛК; **не** проверяется на существование справочника сотрудников | сохраняется | R1 |
| `name_manager` | string | ФИО/имя менеджера из 1С | да | trim → пусто = **ошибка** | не использовать для user↔1C mapping | сохраняется | R1 |
| `address` | string | Фактический адрес (как в выгрузке) | ключ обязателен | `""` → warning `EMPTY_ADDRESS`, запись **принимается** | **не** место доставки и **не** ТТ автоматически | сохраняется как есть | R1 |
| `telephone` | string[] | Массив телефонных строк | ключ обязателен | `[]` или все пустые → warning `EMPTY_TELEPHONE` | элементы — string; не связывать клиентов по телефону | JSONB array | R1 |

**Источник кода:** `src/onec-clients/constants.ts`, `validate.ts`, migration `002_onec_clients.sql`.

### 1.1 Правила UUID в валидаторе (контракт кода, не 1С)

Источник: `src/onec-clients/uuid.ts` → `isValidNonZeroUuid` / `isEmptyOrValidNonZeroUuid`.

| Правило | Поведение |
|---------|-----------|
| Формат | RFC-4122-подобная строка `8-4-4-4-12` hex |
| Версия (первый hex-символ 3-го блока) | **1–5** допустимы |
| Variant (первый hex-символ 4-го блока) | **8, 9, a, b** (регистр не важен до normalize) |
| Null UUID | `00000000-0000-0000-0000-000000000000` → **отклоняется** |
| Нормализация | trim + lower case в parsed-записи |
| `guid_holding` | дополнительно: пустая строка **без** UUID допустима |

**Не утверждается:** какую версию UUID генерирует 1С — только то, что **принимает** текущий импорт.

Синтетика: `valid-uuid-v5.json` (R0.2 fixtures).

---

## 2. Коммерческие поля — наблюдение vs смысл vs импорт

> Наличие ключа во **всех** 3824 строках снимка **не** доказывает обязательность в будущих выгрузках.  
> Наблюдаемый JSON-тип **не** заменяет согласованный контракт.

| Поле | Наблюдалось в снимке | Тип в снимке | Смысл / единицы / область | Импорт main | Целевой релиз |
|------|---------------------|--------------|---------------------------|-------------|---------------|
| `Discount` | да; 244 **непустых** значения | **string** | **тип наблюдался; бизнес-смысл и гарантии формата не согласованы** | `EXTRA_FIELDS` → **не сохраняется** | R1.1 |
| `DiscountAmount` | ключ у **всех** записей | **number** | **тип наблюдался;** не % и не рубли без 1С; смысл нуля — **неизвестно** | не сохраняется | R1.1 |
| `Markups` | 18 непустых массивов; 49 объектов | **array of object** | **тип наблюдался;** правила расчёта — **неизвестно** | не сохраняется | R1.1 |
| `Markups[].Name` | 49 значений; **1 пустое** | **string** | **тип наблюдался;** допустимость пустого — **не согласовано** | — | R1.1 |
| `Markups[].Percentage` | 49 значений | **number** | **тип наблюдался;** единицы, знак, база — **не согласованы** | — | R1.1 |

**Подтверждено кодом:** любой ключ вне 8 → warning `EXTRA_FIELDS`; parsed-запись содержит **только** 8 полей.

**Синтетика:** `extra-unknown-fields.json` — **вымышленные значения**; форма (string/number/array, `Name`/`Percentage`) основана на структурном аудите; **не** исходная выгрузка.

### Что больше не запрашивать у 1С (закрыто наблюдением снимка)

- Есть ли коммерческие поля вообще — **да**, в исследованном снимке.
- `Markups` — массив или объект — **массив объектов**.
- Вложенные ключи — **`Name`**, **`Percentage`**.
- JSON-тип `DiscountAmount` — **number**.

### Что всё ещё нужно от 1С для R1.1 (открыто)

1. Семантика `Discount` (программа, код, описание или иное).
2. Смысл `DiscountAmount`, единицы, трактовка **нуля** (не интерпретировать как %/₽ без ответа).
3. Что идентифицирует `Markups[].Name`; допустима ли пустая строка.
4. Единицы и база `Percentage`; взаимодействие скидки и наценок; сроки и исключения.
5. Объект и период применения (клиент, холдинг, договор, категория/товар).
6. Отсутствие ключа vs пустой массив vs очистка ранее заполненного значения.

---

## 3. Расширенный формат `extended_v1` (R1.2-prep)

**Статус реализации:** адаптер, диагностика, read-only хранение и UI — **реализовано и проверено на синтетике** (`test/helpers/onec-clients-extended-fixtures.ts`, migration `024_onec_clients_extended.sql`).  
**Реальный JSON от 1С:** **не получен** — типы вложенности и пустых значений **не считаются проверенными на live**.  
**Подтверждения 1С (02.10.2026):** см. таблицу ниже (**согласовано 1С**, не live).

| Поле / группа | Смысл | Импорт | UI/API |
|---------------|-------|--------|--------|
| `holding` (boolean, клиент) | карточка — холдинг | validate + apply | карточка «Данные» |
| `guid_holding` (extended) | связь по GUID; `name_holding` **не обязателен** | validate + apply | как раньше |
| `guid_regional_manager` / `name_regional_manager` | региональный менеджер | validate + apply | «Данные», отдельно от ТТ |
| `guid_hardware_manager` / `name_hardware_manager` | менеджер по фурнитуре | validate + apply | «Данные» |
| `guid_head_of_the_sales_department` / `name_head_of_the_sales_department` | РОП | validate + apply | «Данные» |
| `retail_outlets[]` | вложенные ТТ (read-only snapshot) | validate + apply JSONB | вкладка «Данные» |
| `retail_outlets[].holding` (string) | **название** холдинга в точке, ≠ boolean клиента | validate | UI |
| `retail_outlets[].warehouse` | boolean «используется как склад» | validate | UI |
| `retail_outlets[].address.*` | адреса и направление маршрута | validate | UI |
| `retail_outlets[].information_loading.*` | дни приёмки + `loading_time` (начало) | validate | UI; **нет** окончания и дней погрузки |
| `retail_outlets[].managers.*` | ответственные ТТ; пустой GUID → «Не назначен», **без наследования** | validate + apply | UI |
| `retail_outlets[].contact_information.*` | контакты магазина/бухгалтерии | validate | UI (whitelist) |
| `retail_outlets[].LPR_information.*` | ЛПР, бонусы | validate (хранение) | **не публикуется** (deny-by-default) |
| `retail_outlets[].guid_store` | постоянный UUID ТТ (подтверждено 1С-специалистом; **live JSON не проверен**) | validate + registry `onec_retail_outlets`; уникальность по всему файлу и в БД | UI: «Торговая точка 1С · …» |
| `retail_outlets[].closed` | boolean закрытия (только `true`/`false`; null/строки/числа → ошибка) | validate + merge с сохранением предыдущего статуса при отсутствии поля | «Открыта» / «Закрыта» / «Статус не передан» |

**Определение версии файла:** `extended_v1`, если **хотя бы одна** запись содержит `holding: boolean`, массив `retail_outlets` и/или ключи доп. ответственных (`guid_regional_manager`, `guid_hardware_manager`, `guid_head_of_the_sales_department` и пары `name_*`). Иначе — legacy (8 ключей, прежние правила).

**Запрещено:** синтетические GUID ТТ, сопоставление ТТ между снимками по ordinal, наследование пустого ответственного ТТ, `outletConfirmed=true` из-за наличия `retail_outlets`, автоматическое расширение прав из полей ответственных, автоматическая выдача вложенных ТТ по доступу к карточке клиента.

**Доступ к вложенным ТТ (API/UI):** deny-by-default; исключения только по матрице R13 — `admin`, `director` с `fullClientBase`. Менеджер с доступом к карточке холдинга **не** получает адреса/контакты/назначения вложенных ТТ без отдельного разрешения. Количество недоступных ТТ не раскрывается.

**Снимок ТТ:** текущий массив хранится в `extended_snapshot.currentRetailOutlets`; подтверждённые `guid_store` дополнительно регистрируются в `onec_retail_outlets` (PK, связь с `guid_client`). Идентичность ТТ определяется **только** по `guid_store`, не по адресу/ordinal. Исчезновение GUID из следующего снимка **не** означает закрытие или удаление. Анонимные снимки без `guid_store` остаются read-only и **не** привязываются к новым GUID эвристически. Конфликт `guid_store` между карточками клиентов блокирует apply затронутых расширенных данных. История закрытия — `closureHistory[]` на точке; архивные снимки — `retailOutletHistory[]`.

**Политика дублей `guid_store` в одном файле:** идентичные повторы одной строки — предупреждение `DUPLICATE_OUTLET_GUID_ROW`, в apply учитывается одна ТТ; противоречивые повторы (разные клиенты, `closed`, адрес) — ошибка `OUTLET_GUID_CONFLICT` / `DUPLICATE_OUTLET_GUID`, apply блокируется.

**Диагностика (агрегаты, без PII):** `outletsWithGuid`, `outletsWithoutGuid`, `outletsOpen`, `outletsClosed`, `outletsUnknownClosure`, `duplicateOutletGuidCount`, `outletParentLinkConflicts`, `knownOutletsMissingFromSnapshot` (на apply).

**Актуальность расширения:** колонки `extended_imported_at`, `extended_freshness_state` (`current` | `preserved_from_previous` | `not_provided_in_snapshot`). После legacy-снимка блок помечается как сохранённый из предыдущей выгрузки.

**Присутствие полей в снимке:** отсутствующий ключ ≠ явное пустое назначение. При apply отсутствующие блоки (`holding`, `retail_outlets`, пары ответственных) **сохраняют** предыдущее рабочее значение и помечаются `preserved_from_previous` / `not_provided_in_snapshot` в `blocks.blockFreshness`. Явный пустой GUID снимает ответственного без наследования (`explicit_empty` → «Не назначен»). Для нового клиента отсутствие поля → «Не передано» (`not_provided`), не «Не назначен».

**Сравнение изменений:** `extendedBusinessDataEqual()` сравнивает только бизнес-проекцию (холдинг, ответственные, `currentRetailOutlets`); SHA, `importedAt`, `retailOutletHistory` и технические флаги не влияют на `changedCount`. История ТТ дополняется только при реальном изменении содержания точек.

**Актуальность по блокам:** `blocks.blockFreshness` и DTO `blockFreshness` передают состояние каждого блока (`current` / `preserved_from_previous` / `not_provided_in_snapshot`). Смешанное состояние не маркируется как полностью актуальное. `blocks.blockProvenance` хранит для каждого блока `sourceSha256` и `importedAt` последней выгрузки, из которой блок реально получен; верхний уровень `snapshot.sourceSha256` / `extended_source_sha256` — SHA **последней обработанной** выгрузки, а не единый источник всех блоков. При блокировке неподтверждённого контракта колонка `source_sha256` (legacy) обновляется, `extended_*` и снимок сохраняются; DTO/API опираются на `extended_freshness_state` и не показывают расширение как «из текущей выгрузки».

**Блокировка apply расширения:** production-путь всегда `extendedContractVerification=unverified`. Расширенный блок **не публикуется** в рабочие колонки/`extended_snapshot`, пока контракт не подтверждён; legacy-поля клиента применяются. Результат apply/CLI содержит `extendedApplied`, `extendedBlockReason`, `extendedBlockedCount`. Тесты используют `validateClientsForApplyTest()` с `synthetic_confirmed`.

**Сотрудники 1С:** в снимке хранится `directory_unverified`; связь с аккаунтом ЛК (`directory_unverified_account_linked`) **разрешается при чтении** по актуальным `user_onec_employee_links` (отзыв связи виден без re-import). Справочник 1С не подтверждён; связь не расширяет права. `clientExtendedReady=false` до live JSON от специалиста.

### 3.1 Кандидаты без подтверждённого live-образца (прежний перечень)

| Группа | Примеры | Связи | Примечание |
|--------|---------|-------|------------|
| Холдинг как сущность | `guid_holding` + дочерние записи | явные ID из 1С | сейчас — атрибут строки |
| Юрлица | INN, KPP, OGRN, legal name | parent holding ID | не выводить из `guid_client` |
| Торговые точки | ID ТТ, название, адрес | parent legal/holding | обязательны для R3 |
| Места доставки | ID, адрес | parent legal/TT | ≠ ТТ без ID |
| Реквизиты | email, region, city, MA | к юрлицу | прототип экран 05 |
| Ответственные | regional, furniture, ROP | ID сотрудника 1С | ≠ `guid_manager` без контракта |
| Договоры | номер, срок, лимит | к юрлицу | R4 частично |

**Запрещено:** связи по совпадению `name_*`, телефона или адреса.

---

## 4. Семантика `guid_client`

| Утверждение | Статус |
|-------------|--------|
| Это PK строки кэша `onec_clients` | **код** |
| Это «клиент» в UI R1 | **v1.1** |
| Это ID юрлица | **не утверждено** |
| Это ID торговой точки | **не утверждено** |

**Вопрос 1С:** что именно выгружает `guid_client` в текущем `all_clients.json`? (см. [onec-specialist-questions.md](./onec-specialist-questions.md))

---

## 5. Синтетические фикстуры

| Файл | Сценарий | Ожидание валидатора |
|------|----------|---------------------|
| `valid-two-records.json` | корректный набор | ok |
| `empty-address-and-phones.json` | пустой адрес и телефоны | ok + warnings |
| `duplicate-guid.json` | дублирующийся ID | `DUPLICATE_CLIENT` |
| `invalid-guid.json` | null UUID | `INVALID_UUID` |
| `invalid-telephone-type.json` | число вместо string в массиве | `INVALID_TYPE` |
| `extra-unknown-fields.json` | Discount string, DiscountAmount number, Markups[{Name,Percentage}] (синтетика) | ok + `EXTRA_FIELDS`; 8 ключей в parsed |
| `holding-id-without-name.json` | несогласованная пара holding | `HOLDING_CONTRACT` |
| `invalid-json.json`, `truncated-json.json` | повреждённый документ | `INVALID_JSON` |
| `repeat-snapshot.json` | та же нормализованная запись, что первая в `valid-two-records` | ok (**только** validate; не apply/БД) |
| `valid-uuid-v5.json` | ненулевой UUID версии 5 | ok |

**Extended (синтетика, не live):** `test/helpers/onec-clients-extended-fixtures.ts` — holding + outlets, пустой ответственный ТТ, directory-unverified manager.

Тесты: `test/unit/onec-clients-extended-validate.test.ts`, `test/unit/onec-clients-extended-strict-validate.test.ts`, `test/unit/onec-clients-extended-presence.test.ts`, `test/unit/onec-clients-extended-snapshot-history.test.ts`, `test/integration/onec-clients-extended-import.test.ts`, `test/integration/clients-extended-access.test.ts`, `test/integration/clients-extended-link-read.test.ts`, `test/unit/clients-extended-dto.test.ts`, `test/unit/client-card-extended-render.test.ts`, `test/browser/client-card-extended.browser.test.ts`.
