# Матрица приёмки

**Версия эталона:** прототип v2 + план v1.1  
**SHA main (код):** `5c2636c3e5e4321f3a53ca680e03b545635a6f51` (R0.1 merged)  
**Дата:** 2026-09-28 · накопительный реестр (R0.1 + R0.2)

## Как читать таблицу

| Колонка | Смысл |
|---------|--------|
| **Реализация** | Код/UI/документ на `main` |
| **Тесты** | Прогон R0.1 / R0.2 или «не проверено» + источник |
| **Приёмка** | Релиз по правилу 100%; этап R0 ≠ приёмка R1 |

**SHA** — коммит `main`, к которому относится код.

### Статусы приёмки

| Статус | Значение |
|--------|----------|
| ✅ done | этап/требование этапа принято |
| ⏳ pending | не принято |
| n/a | вне scope релиза |
| 🟡 partial | реализация есть, релиз/этап не закрыт |
| 🔲 placeholder | UI без данных |
| ❌ missing | нет реализации |
| ⏸ blocked | блокер (1С, владелец, материалы) |
| 📋 planned | в плане v1.1 |

---

## R0 — Подготовка

| ID | Требование | Реализация | Тесты | Приёмка | SHA main |
|----|------------|------------|-------|---------|----------|
| R0-01 | Аудит main vs R1, блокеры | `docs/delivery/*` | n/a | ✅ R0.1 (PR #8) | 5c2636c |
| R0-02 | Границы R0–R8 из v1.1 | `release-plan.md` | n/a | ✅ R0.1 | 5c2636c |
| R0-03 | Brand inventory, блокеры | `brand-contract.md` | n/a | ✅ R0.1 | 5c2636c |
| R0-04 | Source baseline | `source-contracts.md` | код сверен | ✅ R0.1 | 5c2636c |
| R0-05 | Контракт по фактическому обмену | 8 полей: [clients-field-contract.md](./clients-field-contract.md); коммерция/расширение ⏸ | unit validate + синтетика R0.2 | 🟡 partial R0.2 | 5c2636c |
| R0-06 | Синтетические фикстуры | `test/fixtures/onec-clients/*` | `onec-clients-synthetic-fixtures.test.ts` R0.2 | 🟡 partial (каталог XML нет) | 5c2636c |
| R0-07 | Правила обмена | [exchange-rules.md](./exchange-rules.md) | README+apply сверен | 🟡 partial (E1–E7 открыты) | 5c2636c |
| R0-08 | Контракт каталога | [catalog-contract-spec.md](./catalog-contract-spec.md) spec only | **нет XML образца** | ⏸ blocked | 5c2636c |
| R0-09 | Вопросы 1С | [onec-specialist-questions.md](./onec-specialist-questions.md) | n/a | 🟡 partial R0.2 | 5c2636c |

**R0.2 целиком:** 🟡 partial — ждёт материалы 1С (Q4–Q8, Q11–Q12).

---

## R1 — «Мои клиенты» (приёмка релиза **не заявляется**)

| ID | Экран / сценарий | Требование | Реализация (main) | Тесты | Приёмка R1 | SHA main |
|----|------------------|------------|-------------------|-------|------------|----------|
| R1-A01 | Login | Email/password, session | `src/auth/*` | не проверено в R0.1/R0.2; `test/integration/auth-profile.test.ts` | n/a | 5c2636c |
| R1-A02 | Login | Rate limit 429 | `src/auth/rate-limit.ts` | не проверено; `test/integration/concurrent-rate-limit.test.ts` | n/a | 5c2636c |
| R1-A03 | Login | CSRF Origin | `src/middleware/csrf.ts` | не проверено; auth-profile integration | n/a | 5c2636c |
| R1-A04 | Profile | GET/PATCH self | `src/profile/*` | не проверено; auth-profile integration | n/a | 5c2636c |
| R1-A05 | Profile | Блок PATCH email/role/status | validation | не проверено; auth-profile integration | n/a | 5c2636c |
| R1-A06 | Auth | 8 ролей в enum | migration 001 | не проверено (integration) | n/a | 5c2636c |
| R1-A07 | **core** | user ↔ ID сотрудника 1С | **нет FK** | — | ❌ missing | 5c2636c |
| R1-A08 | **core** | Manager — свои клиенты | `requireAdmin` only | не проверено; `clients-workspace.test.ts` → 403 | ❌ missing | 5c2636c |
| R1-A09 | **core** | Regional / ROP scope | **нет** | не проверено | ❌ missing | 5c2636c |
| R1-A10 | clients (пр.04) | Список + pagination | admin API | не проверено; clients-workspace integration | 🟡 partial | 5c2636c |
| R1-A11 | clients | Search `q` | `query.ts` | не проверено | 🟡 partial | 5c2636c |
| R1-A12 | clients | Filters manager/holding/phone | query | не проверено | 🟡 partial | 5c2636c |
| R1-A13 | clients | Sync status | sync-status API | не проверено | 🟡 partial | 5c2636c |
| R1-A14 | passport | Name, address, phones | dto + detail.js | не проверено | 🟡 partial | 5c2636c |
| R1-A15 | passport | Manager, holding | guid_* display | не проверено | 🟡 partial | 5c2636c |
| R1-A16 | passport | Актуальность (import time) | `last_imported_at` | не проверено (UI) | 🟡 partial | 5c2636c |
| R1-A17 | passport (пр.05) | Реквизиты | placeholder | unit DOM не в scope R0 | 🔲 placeholder | 5c2636c |
| R1-A18 | passport (пр.05) | Юрлица / ТТ / доставка | placeholder | — | 🔲 placeholder | 5c2636c |
| R1-A19 | passport | Коммерческие условия | placeholder | — | 🔲 placeholder | 5c2636c |
| R1-A20 | passport | Команда (regional, ROP) | placeholder | — | 🔲 placeholder | 5c2636c |
| R1-I01 | import | 8-field JSON CLI | `src/onec-clients/*` | R0.1: 116 unit passed; R0.2: **125 unit passed** + fixtures; integration — **не проверено** | n/a | 5c2636c |
| R1-I02 | R1.1 | Discount, Markups | `EXTRA_FIELDS`, не сохраняется | R0.2: `extra-unknown-fields.json` — warn + 8 ключей в parsed | ⏸ blocked Q4–Q6 | 5c2636c |
| R1-I03 | R1.2 | Extended 1C structure | **нет** | — | ⏸ blocked Q8 | 5c2636c |
| R1-I04 | R1.5 | Scheduled import | CLI only | — | ❌ missing | 5c2636c |
| R1-U01 | R1.4 | UI = прототип v2 | PR #7 interim | Chromium **не проверено**; unit legacy-shell — R0.1/R0.2 | ⏸ blocked | 5c2636c |

---

## UI / Brand (interim PR #7)

| ID | Область | Требование | Реализация | Тесты | Приёмка | SHA main |
|----|---------|------------|------------|-------|---------|----------|
| UI-B01 | Shell | Layout sidebar/header | legacy-shell.css/js | unit legacy-shell-dom; R0.2: 125 passed | n/a R1 | 5c2636c |
| UI-B02 | Shell | Light/dark | legacy-tokens.css | unit R0.1/R0.2 | n/a R1 | 5c2636c |
| UI-B03 | Shell | Mobile a11y | focus trap, inert | unit R0.1/R0.2; Chromium **не проверено** | n/a R1 | 5c2636c |
| UI-B04 | Shell | SVG icons | shell-icons.js | unit R0.1/R0.2 | n/a R1 | 5c2636c |
| UI-B05 | Brand | Exo 2 local | fonts/exo-2 | код main | n/a | 5c2636c |
| UI-B06 | Brand | Golos vs Exo 2 | Exo 2 в коде; Golos в прототипе | — | ⏸ blocked (владелец) | — |
| UI-B07 | Brand | 100% прототип v2 | interim ≠ v2 | UI не сверялся | ⏸ blocked | 5c2636c |
| UI-B08 | Brand | Официальный брендбук | не получен | — | ⏸ blocked | — |

---

## R2–R8

| ID | Релиз | Статус | Приёмка |
|----|-------|--------|---------|
| R2-01…R2-04 | Моя работа | 📋 planned | n/a |
| R3-01…R3-04 | Каталог, витрины | 📋 planned | n/a |
| R4-01…R4-04 | Заказы, замещение | 📋 planned | n/a |
| R5-01…R5-03 | Планы, развитие | 📋 planned | n/a |
| R6-01…R6-02 | Заказные продажи | 📋 planned | n/a |
| R7-01…R7-02 | Маршрутный лист | 📋 planned | n/a |
| R8-01…R8-03 | Управление | 📋 planned | n/a |

Детали: [release-plan.md](./release-plan.md).

---

## Проверки

### R0.1 (2026-09-28)

| Проверка | Результат |
|----------|-----------|
| SHA main (аудит) | `f591f483d5d8886dfa9c4626c9f347622958f204` |
| `npm test` (unit) | 116 passed |
| `npm run test:integration` | **не выполнялся** |
| Production FTP/БД | **не подключались** |

### R0.2 (2026-09-28, PR #9)

| Проверка | Результат |
|----------|-----------|
| SHA main (база) | `5c2636c3e5e4321f3a53ca680e03b545635a6f51` |
| `npm test` (unit) | **125 passed**, 0 failed |
| `npm run typecheck` | OK |
| `npm run test:integration` | **не выполнялся** |
| Образец XML `/LC/catalog/` | **не получен** |
| Production FTP/БД | **не подключались** |

---

## Следующий шаг

Приёмка **R0.2** (Computer) → материалы 1С → **R1.1** (не автоматически).
