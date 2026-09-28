# Матрица приёмки

**Версия эталона:** визуальный прототип **v2**, 25.09.2026 (26 экранов) + план **v1.1**, 28.09.2026  
**SHA main (аудит R0.1):** `f591f483d5d8886dfa9c4626c9f347622958f204`  
**Дата обновления:** 2026-09-28 (дополнение материалами v1.1)

Легенда:

| Статус | Значение |
|--------|----------|
| ✅ done | подтверждено кодом и/или тестами на main |
| 🟡 partial | есть реализация, не закрывает релиз |
| 🔲 placeholder | UI/структура без данных |
| ❌ missing | не реализовано |
| ⏸ blocked | ждёт владельца / 1С / следующий промпт |
| 📋 planned | в плане v1.1, не начато |
| 🔍 unverified | не проверено в R0.1 |

---

## R0 — Подготовка

| ID | Промпт | Требование | Реализация | Тест / артефакт | Статус | SHA |
|----|--------|------------|------------|-----------------|--------|-----|
| R0-01 | R0.1 | Аудит main vs R1 | `docs/delivery/*` | PR #8 | 🟡 partial | PR#8 |
| R0-02 | R0.1 | Границы R1–R8 из v1.1 | release-plan.md | v1.1 PDF | ✅ done | PR#8 |
| R0-03 | R0.1 | Brand inventory + блокеры | brand-contract.md | v1.1 PDF | ✅ done | PR#8 |
| R0-04 | R0.1 | Source contracts baseline | source-contracts.md | code audit | ✅ done | f591f48 |
| R0-05 | R0.2 | Синтетика `/LC/clients/`, `/LC/catalog/` | — | — | 📋 planned | — |
| R0-06 | R0.2 | Тестовый контракт без production | — | — | 📋 planned | — |

---

## R1 — «Мои клиенты»

| ID | Экран / сценарий | Требование (v1.1 / прототип) | Реализация (main) | Тест | Статус | SHA |
|----|------------------|------------------------------|-------------------|------|--------|-----|
| R1-A01 | Login | Email/password, session | `src/auth/*` | integration | ✅ done | f591f48 |
| R1-A02 | Login | Rate limit 429 | rate-limit.ts | integration | ✅ done | f591f48 |
| R1-A03 | Login | CSRF Origin | csrf.ts | integration | ✅ done | f591f48 |
| R1-A04 | Profile | GET/PATCH self | profile/* | integration | ✅ done | f591f48 |
| R1-A05 | Profile | Блок PATCH email/role/status | validation | integration | ✅ done | f591f48 |
| R1-A06 | Auth | 8 ролей в enum | migration 001 | code | ✅ done | f591f48 |
| R1-A07 | **core** | user ↔ ID сотрудника 1С | нет FK | — | ❌ missing | f591f48 |
| R1-A08 | **core** | Manager — свои клиенты | requireAdmin | 403 | ❌ missing | f591f48 |
| R1-A09 | **core** | Regional / ROP scope | нет | 403 | ❌ missing | f591f48 |
| R1-A10 | clients (пр.04) | Список + pagination | admin only | integration | 🟡 partial | f591f48 |
| R1-A11 | clients | Search q | query.ts | integration | 🟡 partial | f591f48 |
| R1-A12 | clients | Filters manager/holding/phone | query | integration | 🟡 partial | f591f48 |
| R1-A13 | clients | Sync status | sync-status API | integration | 🟡 partial | f591f48 |
| R1-A14 | passport (пр.04–05) | Name, address, phones | dto + detail | integration | 🟡 partial | f591f48 |
| R1-A15 | passport | Manager, holding | guid_* display | integration | 🟡 partial | f591f48 |
| R1-A16 | passport | Актуальность import time | last_imported_at | code | 🟡 partial | f591f48 |
| R1-A17 | passport (пр.05) | Реквизиты | placeholder | DOM | 🔲 placeholder | f591f48 |
| R1-A18 | passport (пр.05) | Юрлица / ТТ / доставка | placeholder | DOM | 🔲 placeholder | f591f48 |
| R1-A19 | passport | Коммерческие условия | placeholder | DOM | 🔲 placeholder | f591f48 |
| R1-A20 | passport | Команда (regional, ROP) | placeholder | DOM | 🔲 placeholder | f591f48 |
| R1-I01 | import | 8-field JSON CLI | onec-clients | unit+IT | ✅ done | f591f48 |
| R1-I02 | R1.1 | Discount, Markups save | unknown → warn | — | ⏸ blocked | f591f48 |
| R1-I03 | R1.2 | Extended 1C structure | нет файла | — | ⏸ blocked | f591f48 |
| R1-I04 | R1.5 | Scheduled import | CLI only | — | ❌ missing | f591f48 |
| R1-U01 | R1.4 | UI = прототип v2 | PR #7 interim | — | ⏸ blocked | f591f48 |

---

## UI / Brand

| ID | Область | Требование | Реализация | Статус | SHA |
|----|---------|------------|------------|--------|-----|
| UI-B01 | Shell | Layout sidebar/header | legacy-shell | ✅ done | f591f48 |
| UI-B02 | Shell | Light/dark | legacy-tokens | ✅ done | f591f48 |
| UI-B03 | Shell | Mobile a11y | focus trap | ✅ done | 3a285d9 |
| UI-B04 | Shell | SVG icons | shell-icons.js | ✅ done | f591f48 |
| UI-B05 | Brand | Exo 2 local | fonts/exo-2 | ✅ done | f591f48 |
| UI-B06 | Brand | Golos vs Exo 2 | **не решено** | ⏸ blocked | — |
| UI-B07 | Brand | 100% прототип v2 | interim PR #7 | ⏸ blocked | f591f48 |
| UI-B08 | Brand | Официальный брендбук | не получен | ⏸ blocked | — |

---

## R2 — Моя работа (v1.1)

| ID | Экран (прототип) | Промпт | Статус |
|----|------------------|--------|--------|
| R2-01 | 01, 02, 06 | R2.1 Контракт Битрикс24 | 📋 planned |
| R2-02 | 01, 02, 06 | R2.2 Задачи и рабочий день | 📋 planned |
| R2-03 | 06, 16 | R2.3 Чек-листы, документы | 📋 planned |
| R2-04 | 17 | R2.4 Сводка рекламаций | 📋 planned |

---

## R3 — Каталог, витрины, визиты

| ID | Экран | Промпт | Статус |
|----|-------|--------|--------|
| R3-01 | — | R3.1 Импорт `/LC/catalog/` | 📋 planned |
| R3-02 | — | R3.2 Поиск товаров | 📋 planned |
| R3-03 | 10, 11 | R3.3 Факт витрины | 📋 planned |
| R3-04 | 14, 15, 26 | R3.4 План и результат визита | 📋 planned |

---

## R4 — Заказы, деньги, замещение

| ID | Экран | Промпт | Статус |
|----|-------|--------|--------|
| R4-01 | 07, 09 | R4.1 Задолженность | 📋 planned |
| R4-02 | 07 | R4.2 Заказы и отгрузки | 📋 planned |
| R4-03 | 18, 20 | R4.3 Временные доступы | 📋 planned |
| R4-04 | 08, 16, 19 | R4.4 Передача задач B24 | 📋 planned |

---

## R5 — Планы и развитие

| ID | Экран | Промпт | Статус |
|----|-------|--------|--------|
| R5-01 | 09, 21 | R5.1 План-факт | 📋 planned |
| R5-02 | 13 | R5.2 Адресные цели | 📋 planned |
| R5-03 | 12 | R5.3 Установка и фото | 📋 planned |

---

## R6 — Заказные продажи

| ID | Промпт | Статус |
|----|--------|--------|
| R6-01 | R6.1 Запрос и расчёт | 📋 planned |
| R6-02 | R6.2 Контроль решения | 📋 planned |

---

## R7 — Маршрутный лист

| ID | Промпт | Статус |
|----|--------|--------|
| R7-01 | R7.1 Рейс и черновик | 📋 planned |
| R7-02 | R7.2 Excel/PDF | 📋 planned |

---

## R8 — Управление

| ID | Экран | Промпт | Статус |
|----|-------|--------|--------|
| R8-01 | 22, 23, 24 | R8.1 Команда и аналитика | 📋 planned |
| R8-02 | 03 | R8.2 Рекомендации | 📋 planned |
| R8-03 | 19 | R8.3 Оценка эффективности | 📋 planned |

---

## Проверки R0.1 (2026-09-28)

| Проверка | Результат |
|----------|-----------|
| `git fetch origin main` | SHA `f591f483d5d8886dfa9c4626c9f347622958f204` |
| Материалы v1.1 + прототип v2 | **получены** (PDF, владелец) |
| Открытые PR на старт R0.1 | не было |
| Активный PR | **#8** (docs, draft) |
| `npm test` | 116 passed (первая итерация R0.1) |
| `npm run typecheck` | OK |
| `npm run test:integration` | 🔍 не запускался |
| Chromium UI | 🔍 не выполнялся (docs-only) |
| Production / TW | 🔍 не читались |

---

## Следующий промпт

**R0.2** — контракты источников и синтетические примеры (не R1).
