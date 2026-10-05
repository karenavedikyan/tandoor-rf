# Clients list: column mapping (role base)

Согласованные колонки прототипа и текущие источники в ЛК РФ. Если поле отсутствует в источнике — в UI показывается «Нет данных».

| Колонка | Источник | Тип | Доступность |
| --- | --- | --- | --- |
| Клиент | `onec_clients.name_client` | string | все роли в области |
| Код 1С | — | — | нет в API списка |
| ИНН | — | — | нет в API списка |
| Город | `onec_clients.address` (частично) | string | все роли в области |
| Категория | — | — | нет в API списка |
| РОП | `rop_team_members` + `users.full_name` (режим teams/review) | string | РОП, директор, admin |
| Менеджер | `onec_clients.name_manager` / `guid_manager` | uuid + string | все роли в области |
| Региональный менеджер | `extended_snapshot.currentRetailOutlets[].managers.regionalManager` | per-outlet | режим ТТ, карточка |
| Кол-во доступных ТТ | `COUNT(onec_retail_outlets)` в scope | number | clients list (partial) |
| Состояние назначения | `manager_roster_state`, review/unassigned | enum | teams/review |
| Холдинг | `onec_clients.name_holding` / `guid_holding` | uuid + string | clients list |
| Адрес | `onec_clients.address` или outlet address | string | clients / outlets |
| Склад | extended outlet `warehouse` | boolean | карточка / outlets (partial) |
| Tandoor Club | extended outlet `additional.statusTandoorClub` | string | карточка |
| Cashback | — | — | нет в API списка |
| Следующий шаг | — | — | нет в API списка |
| Торговая точка | `onec_retail_outlets` + snapshot address | string | entity=outlets |
| ID ТТ | `onec_retail_outlets.guid_store` | uuid | entity=outlets |
| Статус ТТ | `onec_retail_outlets.is_closed` | boolean | entity=outlets |

Подтверждение назначений: manager/ROP — `user_onec_employee_links` + `guid_manager`; regional — `access_grants` + regional GUID в snapshot outlet; director/admin — `fullClientBase` с denials.
