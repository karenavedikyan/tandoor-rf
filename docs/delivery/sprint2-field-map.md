# Sprint 2 — карта полей обмена → экран → фильтр → права

**Ветка:** `cursor/sprint2-exchange-filters-9e11` · **base:** `cursor/sprint1-teams-bases-9e11` (PR #56)  
**Источник проверки:** read-only `scripts/audit-exchange-fields.ts`, integration A–D, browser filters.

## Уровни доказательства

| Метка | Значение |
|-------|----------|
| **синтетика** | fixtures + unit/integration |
| **код** | parser → DB → DTO → UI |
| **снимок** | legacy 8 ключей + коммерческие EXTRA (read-only audit) |
| **не проверено live** | TOP-150/350/500, юрлица, roster-поля в клиенте |

---

## Legacy (8 ключей)

| Поле JSON | DB | Список | Карточка | Фильтр | Права |
|-----------|-----|--------|----------|--------|-------|
| `guid_client` | PK | id | guid | — | scope |
| `name_client` | ✓ | name | name | `q` | scope |
| `guid_holding` / `name_holding` | ✓ | holding | holding | `holding` | scope |
| `guid_manager` / `name_manager` | ✓ | manager | manager | `clientManager` / `missingClientManager` / `clientManagerMode` | scope |
| `address` | ✓ | address | address | `q`, `filled`/`empty=address` | read |
| `telephone[]` | JSONB | phone | phones | `phone`, `q`, `filled`/`empty=telephone` | read |

---

## Extended client (`extended_v1`)

| Поле / блок | Карточка | Список | Фильтр clients | Права |
|-------------|----------|--------|----------------|-------|
| `guid_regional_manager` | «Ответственные» | regional | `clientRegionalManager` / `missingClientRegional` / `clientRegionalManagerMode` | scope не расширяется |
| `guid_hardware_manager` | «Ответственные» | hardware | `clientHardwareManager` / `missingClientHardware` / `clientHardwareManagerMode` | scope не расширяется |
| `guid_head_of_the_sales_department` | РОП | rop | `clientRopEmployee` / `missingClientRop` / `clientRopEmployeeMode` | scope |

Legacy `manager`, `regionalManager`, `hardwareManager`, `ropEmployee`, `missing*` — адаптер на уровне entity.

---

## Retail outlets — same-outlet на `entity=clients`

На `entity=clients` все условия по ТТ (назначения, склад, статус, Club, адрес/маршрут, контакты, приёмка, `filled`/`empty` outlet-полей) применяются в **одном scoped EXISTS** (`client-entity-outlet-filter.ts`) с ограничением Sprint 1 (`outlet-elem-access.ts`).

| Поле | Карточка | Список outlets | Фильтр clients | Фильтр outlets | UI |
|------|----------|----------------|----------------|----------------|-----|
| `warehouse` | Склад | warehouse | `warehouse` | `warehouse` | select |
| `closed` / `closureStatus` | Статус | status | `outletStatus` | `outletStatus` | select |
| `address.store_address` | Адреса | address | `storeAddressContains` | `storeAddressContains` | field panel |
| `address.delivery_address` | Адреса | — | `filled`/`empty=deliveryAddress` | same | field panel |
| `address.direction_of_the_route` | Маршрут | — | `routeDirection`, `filled`/`empty=routeDirection` | same | field panel |
| `information_loading.*` | Приёмка | — | `loadingTime`, `loadingSchedule`, `filled`/`empty=loadingTime|loadingSchedule` | same | field panel |
| `contact_information.*` | Контакты | — | `storePhoneContains`, `accountantPhoneContains`, `accountantEmailContains`, `filled`/`empty` | same | field panel |
| `managers.*` | Ответственные ТТ | manager/regional/hardware/rop | `outletManager`, `outletRegionalManager`, `outletHardwareManager`, `outletRopEmployee` + `missingOutlet*` + `*Mode` | same (outlet* params) | combobox ×4 |
| `additional_information.status_tandoor_club` | Club | tandoorClub | `tandoorClub`, `filled`/`empty=tandoorClub` | same | input |

**Options API:** `outletManagers` — из `managers.manager` доступных snapshot-ТТ (card-read scope, включая outlet-only родителей); regional/hardware/ROP outlet-часть — из `scoped_card_clients` + accessibility; client `managers` — direct list scope. Multi-select / Mode-select в UI **не завершены**.

---

## Восемь фильтров ответственных (UI + API)

| Роль | Клиент (`entity=clients`) | ТТ (`entity=clients`, второй ряд) | Только ТТ (`entity=outlets`) |
|------|---------------------------|-----------------------------------|------------------------------|
| Менеджер | `clientManager` | `outletManager` | `outletManager` |
| Региональный | `clientRegionalManager` | `outletRegionalManager` | `outletRegionalManager` |
| Фурнитура | `clientHardwareManager` | `outletHardwareManager` | `outletHardwareManager` |
| РОП | `clientRopEmployee` | `outletRopEmployee` | `outletRopEmployee` |

Режимы: GUID (OR через запятую в URL), `missingClient*` / `missingOutlet*`, `*Mode=assigned|unassigned|not_provided`.

---

## Реестр filled/empty

См. `src/clients/field-filter-registry.ts`. Неизвестное поле → **400**. Client-only поля на `entity=outlets` → **400**.

Закрыто: LPR, bonus, DOB (`sensitiveFieldsWithheld`). Колонки без DTO (`code1c`, `city`, `cashback`) — `hasSource: false`.

---

## Регрессии (integration)

| ID | Сценарий | Ожидание |
|----|----------|----------|
| A | M1 видит ТТ1; Gold/warehouse на скрытой ТТ2 | `warehouse=yes` → 0; options без сотрудников скрытой ТТ |
| B | warehouse на ТТ1, маршрут на ТТ2 | `warehouse=yes` + `filled=routeDirection` → 0 |
| C | `empty=deliveryAddress` | сужает выдачу; `empty=lprName` → 400 |
| D | `clientManager=M1` + `outletManager=M2` | AND без подмены уровней |
