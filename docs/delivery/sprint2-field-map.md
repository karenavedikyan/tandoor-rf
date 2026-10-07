# Sprint 2 — карта полей обмена → экран → фильтр → права

**Ветка:** `cursor/sprint2-exchange-filters-9e11` · **base:** `cursor/sprint1-teams-bases-9e11` (PR #56)  
**Источник проверки:** read-only `scripts/audit-exchange-fields.ts` (fixtures + `AUDIT_CLIENTS_PATH` / `AUDIT_EMPLOYEES_PATH`). Import/apply **не запускался**.

## Уровни доказательства

| Метка | Значение |
|-------|----------|
| **синтетика** | `test/helpers/onec-clients-extended-fixtures.ts`, unit/integration |
| **код** | parser → DB → DTO → UI |
| **снимок** | ранее прочитанный `/LC/clients/all_clients.json` (3824 записи) — legacy 8 ключей + коммерческие EXTRA |
| **не проверено live** | TOP-150/350/500, юрлица, категории назначения, roster-поля в клиенте |

---

## Legacy (8 ключей) — подтверждено

| Поле JSON | DB | Список | Карточка | Фильтр | Права |
|-----------|-----|--------|----------|--------|-------|
| `guid_client` | PK | id | guid | — | scope |
| `name_client` | ✓ | name | name | `q` contains | scope |
| `guid_holding` / `name_holding` | ✓ | holding | holding | `holding` | scope |
| `guid_manager` / `name_manager` | ✓ | manager | manager | `manager` / `missingManager` / `clientManagerMode` | scope + R13 |
| `address` | ✓ | address | address | `q`, `filled`/`empty` | read |
| `telephone[]` | JSONB | phone | phones | `phone`, `q` | read |

---

## Extended client (`extended_v1`) — подтверждено синтетикой + кодом

| Поле / блок | DB (`extended_snapshot`) | Карточка (вкладка «Данные») | Список (колонки) | Фильтр | Права / ограничения |
|-------------|--------------------------|----------------------------|------------------|--------|---------------------|
| `holding` (boolean) | ✓ | «Основные сведения» | — | — | read |
| `guid_regional_manager` | ✓ | «Ответственные» | regional | `regionalManager` / `missingRegional` / `regionalManagerMode` | scope не расширяется |
| `guid_hardware_manager` | ✓ | «Ответственные» | hardware | `hardwareManager` / `missingHardware` / `hardwareManagerMode` | scope не расширяется |
| `guid_head_of_the_sales_department` | ✓ | «Ответственные» (РОП) | rop | `ropEmployee` / `missingRop` / `ropEmployeeMode` | scope |
| Client `guid_manager` (legacy) | ✓ | «Менеджер клиента» | manager | `manager` (клиент) | ≠ outlet manager |

---

## Retail outlets (`retail_outlets[]`) — подтверждено

| Поле | Карточка (блок ТТ, `<details>`) | Список outlets | Фильтр clients entity | Фильтр outlets entity | Права |
|------|----------------------------------|----------------|-------------------------|----------------------|-------|
| `guid_store` | Идентификация | guidStore | — | — | nested outlets deny-by-default |
| `closed` | Статус | status | `outletStatus` (same-outlet) | `outletStatus` | read |
| `warehouse` | Склад | warehouse | `warehouse` (same-outlet) | `warehouse` | read |
| `address.store_address` | Адреса | address | `storeAddressContains` | `q` | read |
| `address.delivery_address` | Адреса | — | `filled`/`empty` | — | read |
| `address.direction_of_the_route` | Маршрут | — | `routeDirection` | — | read |
| `information_loading.*` | Приёмка | — | — | — | read; нет end time |
| `managers.manager` | Ответственные ТТ | manager | `manager` (ТТ) | `manager` | отдельно от клиента |
| `managers.guid_regional_manager` | Ответственные ТТ | regional | `regionalManager` (same-outlet) | `regionalManager` | GUID match |
| `managers.guid_hardware_manager` | Ответственные ТТ | hardware | `hardwareManager` (same-outlet) | `hardwareManager` | GUID match |
| `managers.guid_head_of_the_sales_department` | РОП ТТ | rop | `ropEmployee` (outlet) | `ropEmployee` | GUID match |
| `contact_information.*` | Контакты | — | — | — | whitelist, no LPR |
| `additional_information.status_tandoor_club` | Club | tandoorClub | `tandoorClub` (same-outlet) | `tandoorClub` | read |
| `additional_information.bonus_tandoor_club` | — | **не публикуется** | — | — | deny-by-default |
| `LPR_information.*` | — | **не публикуется** | — | — | `sensitiveFieldsWithheld` |

**Same-outlet:** на `entity=clients` условия по ТТ требуют совпадения на **одной** точке (`clientHasOutletMatchingSql`).

---

## Roster (`all_employees.json`) — только у сотрудника/команды

Кадровые поля roster **не дублируются** в карточке клиента. Связь `directory_unverified_account_linked` — при чтении, без расширения scope.

---

## Не подтверждено / отсутствует в fixtures

| Группа | Статус |
|--------|--------|
| TOP-150 / TOP-350 / TOP-500, уровень назначения категории | **не наблюдалось** в синтетике; live не проверен |
| Юрлица (INN, KPP, OGRN, legal name) | **не импортируется**; UI: «юрлица не переданы» |
| `Discount`, `DiscountAmount`, `Markups[]` | warning EXTRA_FIELDS; **не сохраняется** |
| `code1c`, `city`, `cashback` (колонки списка) | `hasSource: false` — нет DTO |
| DOB / персональные бонусы ЛПР | **запрещено** (`sensitiveFieldsWithheld: true`) |

---

## Восемь фильтров ответственных (подписи UI)

| Роль | `entity=clients` | `entity=outlets` | API param |
|------|------------------|------------------|-----------|
| Менеджер | Менеджер клиента | Менеджер ТТ | `manager` |
| Региональный | Региональный клиента | Региональный ТТ | `regionalManager` |
| По фурнитуре | По фурнитуре клиента | По фурнитуре ТТ | `hardwareManager` |
| РОП | РОП клиента | РОП ТТ | `ropEmployee` |

Режимы: конкретный GUID (OR для списка через запятую), `missing*`, `*Mode=assigned|unassigned|not_provided`.

---

## Реестр полевых фильтров (allowlist)

См. `src/clients/field-filters.ts` (`ALLOWED_FILLED_FIELDS`), `src/clients/list-assignment-filters.ts`, `src/clients/outlets/list-filter.ts`.  
Запрещённые поля (LPR, bonus) **нельзя** использовать в SQL-фильтрах.
