# Матрица приёмки

**Версия эталона:** прототип **v2**, 25.09.2026 + план **v1.1**, 28.09.2026  
**SHA main (объект аудита R0.1):** `f591f483d5d8886dfa9c4626c9f347622958f204`  
**Дата:** 2026-09-28

## Как читать таблицу

Три колонки доказательств **не смешиваются**:

| Колонка | Смысл |
|---------|--------|
| **Реализация** | Есть ли код/UI/документ на указанном SHA `main` (статический обзор, grep, чтение файлов) |
| **Тесты** | Был ли **прогон в R0.1**; иначе — конкретный источник или «не проверено в R0.1» |
| **Приёмка** | Выполнено ли требование **релиза** по правилу 100%; R0.1 **не принимает** R1–R8 |

**SHA** — коммит **`main`**, к которому относится реализация. Документация R0.1 в PR #8 до merge не меняет `main`.

### Статусы приёмки

| Статус | Значение |
|--------|----------|
| ⏳ pending | R0.1 / релиз не принят |
| n/a | Вне scope текущего релиза |
| 🟡 partial | Реализация есть, релиз не закрыт |
| 🔲 placeholder | UI без данных |
| ❌ missing | Нет реализации |
| ⏸ blocked | Блокер (1С, владелец, материалы) |
| 📋 planned | В плане v1.1 |

---

## R0 — Подготовка

| ID | Требование | Реализация | Тесты | Приёмка | SHA main |
|----|------------|------------|-------|---------|----------|
| R0-01 | Аудит main vs R1, блокеры | docs в PR #8 (не merged) | n/a (docs) | ⏳ pending R0.1 | f591f48 |
| R0-02 | Границы R0–R8 из v1.1 | `release-plan.md` (PR #8) | n/a | ⏳ pending R0.1 | f591f48 |
| R0-03 | Brand inventory, блокеры | `brand-contract.md` (PR #8) | n/a | ⏳ pending R0.1 | f591f48 |
| R0-04 | Source contracts baseline | `source-contracts.md` (PR #8) | код сверен с main | ⏳ pending R0.1 | f591f48 |
| R0-05 | Контракт по **фактическому** обмену + подтверждения 1С | — | — | 📋 planned R0.2 | — |
| R0-06 | Синтетические фикстуры (только тесты, не контракт) | — | — | 📋 planned R0.2 | — |

---

## R1 — «Мои клиенты» (приёмка релиза **не заявляется** в R0.1)

| ID | Требование | Реализация (main) | Тесты | Приёмка R1 | SHA main |
|----|------------|-------------------|-------|------------|----------|
| R1-A01 | Login email/password, session | `src/auth/*` | не проверено в R0.1; файл `test/integration/auth-profile.test.ts` | n/a | f591f48 |
| R1-A02 | Rate limit 429 | `src/auth/rate-limit.ts` | не проверено в R0.1; `test/integration/concurrent-rate-limit.test.ts` | n/a | f591f48 |
| R1-A03 | CSRF Origin | `src/middleware/csrf.ts` | не проверено в R0.1; auth-profile integration | n/a | f591f48 |
| R1-A04 | Profile GET/PATCH self | `src/profile/*` | не проверено в R0.1; auth-profile integration | n/a | f591f48 |
| R1-A05 | Блок PATCH email/role/status | validation | не проверено в R0.1; auth-profile integration | n/a | f591f48 |
| R1-A06 | 8 ролей в enum | migration 001 | не проверено в R0.1 (integration) | n/a | f591f48 |
| R1-A07 | user ↔ ID сотрудника 1С | **нет** | — | ❌ missing | f591f48 |
| R1-A08 | Manager — свои клиенты | `requireAdmin` only | не проверено в R0.1; `clients-workspace.test.ts` ожидает 403 | ❌ missing | f591f48 |
| R1-A09 | Regional / ROP scope | **нет** | не проверено в R0.1 | ❌ missing | f591f48 |
| R1-A10 | Список + pagination | admin API | не проверено в R0.1; clients-workspace integration | 🟡 partial | f591f48 |
| R1-A11 | Search `q` | `query.ts` | не проверено в R0.1 | 🟡 partial | f591f48 |
| R1-A12 | Filters manager/holding/phone | query | не проверено в R0.1 | 🟡 partial | f591f48 |
| R1-A13 | Sync status | sync-status API | не проверено в R0.1 | 🟡 partial | f591f48 |
| R1-A14 | Name, address, phones | dto + detail.js | не проверено в R0.1 | 🟡 partial | f591f48 |
| R1-A15 | Manager, holding display | guid_* | не проверено в R0.1 | 🟡 partial | f591f48 |
| R1-A16 | Актуальность (import time) | `last_imported_at` | не проверено в R0.1 (UI) | 🟡 partial | f591f48 |
| R1-A17 | Реквизиты | placeholder | unit DOM не в scope R0.1 | 🔲 placeholder | f591f48 |
| R1-A18 | Юрлица / ТТ / доставка | placeholder | — | 🔲 placeholder | f591f48 |
| R1-A19 | Коммерческие условия | placeholder | — | 🔲 placeholder | f591f48 |
| R1-A20 | Команда (regional, ROP) | placeholder | — | 🔲 placeholder | f591f48 |
| R1-I01 | 8-field JSON import CLI | `src/onec-clients/*` | unit: **116 passed** R0.1 (`npm test`, f591f48); integration import — **не проверено в R0.1** | n/a (импорт ≠ R1 приёмка) | f591f48 |
| R1-I02 | Discount, Markups | unknown → warn | — | ⏸ blocked (R0.2 / 1С) | f591f48 |
| R1-I03 | Extended 1C structure | **нет** | — | ⏸ blocked | f591f48 |
| R1-I04 | Scheduled import | CLI only | — | ❌ missing | f591f48 |
| R1-U01 | UI = прототип v2 | PR #7 interim shell | Chromium — **не проверено в R0.1**; unit `legacy-shell-dom.test.ts` — в прогоне 116 passed | ⏸ blocked | f591f48 |

---

## UI / Brand (interim PR #7; 100% прототип **не принят**)

| ID | Требование | Реализация | Тесты | Приёмка | SHA main |
|----|------------|------------|-------|---------|----------|
| UI-B01 | Shell layout | legacy-shell.css/js | unit legacy-shell-dom — 116 passed R0.1 | n/a R1 | f591f48 |
| UI-B02 | Light/dark | legacy-tokens.css | unit — в прогоне R0.1 | n/a R1 | f591f48 |
| UI-B03 | Mobile a11y | focus trap, inert | unit — R0.1; **Chromium — не проверено в R0.1** (PR #7 вне R0.1) | n/a R1 | f591f48 |
| UI-B04 | SVG icons | shell-icons.js | unit — R0.1 | n/a R1 | f591f48 |
| UI-B05 | Exo 2 local | fonts/exo-2 | код на main | n/a | f591f48 |
| UI-B06 | Golos vs Exo 2 | Exo 2 в коде; Golos в прототипе | — | ⏸ blocked (владелец) | — |
| UI-B07 | 100% прототип v2 | interim ≠ v2 | UI не сверялся в R0.1 | ⏸ blocked | f591f48 |
| UI-B08 | Официальный брендбук | не получен | — | ⏸ blocked | — |

---

## R2–R8

Все строки — **📋 planned**; приёмка **n/a** до соответствующего релиза. Детали: [release-plan.md](./release-plan.md).

---

## Проверки, выполненные в R0.1

| Проверка | Результат | SHA / источник |
|----------|-----------|----------------|
| `git fetch origin main` | `f591f483d5d8886dfa9c4626c9f347622958f204` | f591f48 |
| Материалы v1.1 + прототип v2 | получены (PDF) | владелец |
| Статический обзор кода | auth, clients, onec-clients, FTP path | f591f48 |
| `npm test` (unit) | 116 passed | f591f48, сессия R0.1 |
| `npm run typecheck` | OK | f591f48, сессия R0.1 |
| `npm run test:integration` | **не выполнялся** | — |
| Chromium / UI | **не выполнялся** | — |
| Production / TW FTP | **не подключались** | — |

## Следующий промпт

**R0.2** — уточнение контрактов по **фактической** структуре обмена и подтверждениям 1С; синтетика для тестов; блокер при нехватке материалов; **без production** (не R1).
