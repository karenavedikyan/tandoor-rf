# Матрица приёмки

**Версия эталона:** прототип v1.1 — **не получен**; UI-эталон interim = `tandoor-platform` @ `79dc78d` + PR #7 UI на main  
**SHA main (аудит R0.1):** `f591f483d5d8886dfa9c4626c9f347622958f204`  
**Дата:** 2026-09-28

Легенда статусов:

| Статус | Значение |
|--------|----------|
| ✅ done | подтверждено кодом и/или тестами на main |
| 🟡 partial | есть реализация, не закрывает R1 для роли сотрудника |
| 🔲 placeholder | UI/структура без данных |
| ❌ missing | не реализовано |
| ⏸ blocked | ждёт владельца / 1С / документ v1.1 |
| 🔍 unverified | не проверено в этой сессии |

---

## R1 — «Мои клиенты»

| ID | Экран / сценарий | Требование | Реализация (main) | Тест / артефакт | Статус | SHA |
|----|------------------|------------|-------------------|-----------------|--------|-----|
| R1-A01 | Login | Email/password, session cookie | `src/auth/*` | `auth-profile.test.ts` | ✅ done | f591f48 |
| R1-A02 | Login | Rate limit 429 | `src/auth/rate-limit.ts` | integration | ✅ done | f591f48 |
| R1-A03 | Login | CSRF Origin | `src/middleware/csrf.ts` | integration | ✅ done | f591f48 |
| R1-A04 | Profile | GET/PATCH self (name, phone) | `src/profile/*` | integration | ✅ done | f591f48 |
| R1-A05 | Profile | Блок PATCH email/role/status | validation | integration | ✅ done | f591f48 |
| R1-A06 | Auth | Роли в enum (8 значений) | `users.role` CHECK | migration 001 | ✅ done | f591f48 |
| R1-A07 | **R1 core** | Связь user ↔ ID сотрудника 1С | **нет колонки/FK** | — | ❌ missing | f591f48 |
| R1-A08 | **R1 core** | Manager видит **своих** клиентов | `requireAdmin` only | 403 all non-admin | ❌ missing | f591f48 |
| R1-A09 | **R1 core** | Regional / ROP scope | не реализовано | 403 | ❌ missing | f591f48 |
| R1-A10 | Clients list | Admin list + pagination | `src/clients/*` | integration | 🟡 partial | f591f48 |
| R1-A11 | Clients list | Search q | query.ts | integration | 🟡 partial | f591f48 |
| R1-A12 | Clients list | Filter manager UUID | admin query param | integration | 🟡 partial | f591f48 |
| R1-A13 | Clients list | Filter holding UUID | query | unit/DOM | 🟡 partial | f591f48 |
| R1-A14 | Clients list | Filter phone yes/no | query | partial IT | 🟡 partial | f591f48 |
| R1-A15 | Clients list | Sync status / warning | sync-status API | integration | 🟡 partial | f591f48 |
| R1-A16 | Client card | Name, address, phones | dto + detail.js | integration | 🟡 partial | f591f48 |
| R1-A17 | Client card | Manager from 1C | guid_manager display | integration | 🟡 partial | f591f48 |
| R1-A18 | Client card | Holding link → filter | detail UI | — | 🟡 partial | f591f48 |
| R1-A19 | Client card | Актуальность (import time) | last_imported_at MSK | code | 🟡 partial | f591f48 |
| R1-A20 | Client card | Реквизиты (INN, KPP, …) | placeholder section | DOM | 🔲 placeholder | f591f48 |
| R1-A21 | Client card | Коммерческие условия | placeholder section | DOM | 🔲 placeholder | f591f48 |
| R1-A22 | Client card | Regional / furniture manager | placeholder | DOM | 🔲 placeholder | f591f48 |
| R1-A23 | Client card | Торговые точки | honest «не подключены» | DOM | 🔲 placeholder | f591f48 |
| R1-I01 | Import | 8-field JSON validate + apply | onec-clients CLI | unit+integration | ✅ done | f591f48 |
| R1-I02 | Import | Scheduled / automatic | **CLI only** | — | ❌ missing | f591f48 |
| R1-I03 | Import | New 1C fields (Markups, …) | unknown keys → warn | — | ⏸ blocked | f591f48 |

---

## UI / Brand (interim, PR #7)

| ID | Область | Требование | Реализация | Тест / арtefact | Статус | SHA |
|----|---------|------------|------------|-----------------|--------|-----|
| UI-B01 | Shell | Sidebar + header layout | legacy-shell.css/js | legacy-shell-dom.test | ✅ done | f591f48 |
| UI-B02 | Shell | Light/dark theme | legacy-tokens.css | unit test | ✅ done | f591f48 |
| UI-B03 | Shell | Mobile drawer a11y | focus trap, inert | unit + Chromium | ✅ done | 3a285d9 |
| UI-B04 | Shell | SVG nav icons (not emoji) | shell-icons.js | unit test | ✅ done | f591f48 |
| UI-B05 | Brand | Exo 2 local | fonts/exo-2 | code | ✅ done | f591f48 |
| UI-B06 | Brand | Font vs prototype (Golos?) | Exo 2 used | — | ⏸ blocked | f591f48 |
| UI-B07 | Brand | Match accepted prototype | prototype N/A | — | ⏸ blocked | f591f48 |

---

## R2–R8

| ID | Релиз | Статус |
|----|-------|--------|
| R2+ | все требования | ⏸ blocked — документ v1.1 не получен |

---

## Проверки R0.1 (2026-09-28)

| Проверка | Результат |
|----------|-----------|
| `git fetch origin main` | SHA `f591f483d5d8886dfa9c4626c9f347622958f204` |
| Открытые PR | **нет** |
| `npm test` | **116 passed**, 0 failed |
| `npm run typecheck` | OK |
| `npm run test:integration` | **не запускался** в R0.1 (требует `tandoor_rf_test`; последний прогон PR #7: 53 passed) |
| Chromium UI | **не выполнялся** в R0.1 (docs-only PR) |
| Production / TW данные | **не читались** |
