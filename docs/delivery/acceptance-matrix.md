# Матрица приёмки

## Карточка по прототипу v2: 28.09.2026

Реализована визуальная структура Обзора и Данных, 9 вкладок с клавиатурной
навигацией, локальные палитра и Golos из v2. Контакты и источник остаются
рабочими; неподключённые разделы явно обозначены. См.
[границы соответствия](./client-card-prototype-parity.md).

Проверки: 137 unit и 12 browser на синтетических API-ответах; typecheck/build.
Проверка реальной production-сессии и интеграции БД не выполнялась.
Полный R1.4, R0.2 и будущие интеграции не закрыты этим изменением.

**Версия эталона:** прототип v2 + план v1.1  
**SHA main (код):** `cd276e67193efa48a1c48fe14bd43aca530ae9ae` (PR #9 merged)  
**Дата:** 2026-09-28 · накопительный реестр (R0.1 + R0.2 + сверка материалов)

## Как читать таблицу

| Колонка | Смысл |
|---------|--------|
| **Реализация** | Код/UI/документ на `main` |
| **Тесты** | Прогон R0.1 / R0.2 или «не проверено» + источник |
| **Приёмка** | Релиз по правилу 100%; этап R0 ≠ приёмка R1 |

**SHA доказательства** — коммит, содержащий проверяемый код, документ или тестовый пример; он может относиться к ветке PR, а не к прежнему `main`. База аудита указана отдельно выше. Коммит добавления свидетельств PR №10: `8b95946cb1254aa7ba90c6d35b733cd2d051ff5e`.

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

| ID | Требование | Реализация | Тесты | Приёмка | SHA доказательства |
|----|------------|------------|-------|---------|----------|
| R0-01 | Аудит main vs R1, блокеры | `docs/delivery/*` | n/a | ✅ R0.1 (PR #8) | 5c2636c |
| R0-02 | Границы R0–R8 из v1.1 | `release-plan.md` | n/a | ✅ R0.1 | 5c2636c |
| R0-03 | Brand inventory, блокеры | `brand-contract.md` | n/a | ✅ R0.1 | 5c2636c |
| R0-04 | Source baseline | `source-contracts.md` | код сверен | ✅ R0.1 | 5c2636c |
| R0-05 | Контракт по фактическому обмену | 8 полей + **наблюдаемые** типы коммерции: [clients-field-contract.md](./clients-field-contract.md); семантика ⏸ | unit validate + синтетика R0.2 | 🟡 partial R0.2 | 8b95946 |
| R0-06 | Синтетические фикстуры | `test/fixtures/onec-clients/*` (форма по аудиту) | `onec-clients-synthetic-fixtures.test.ts` R0.2 | 🟡 partial (каталог XML синтетика нет) | 8b95946 |
| R0-07 | Правила обмена | [exchange-rules.md](./exchange-rules.md) | README+apply сверен | 🟡 partial (E1–E7 открыты) | cd276e6 |
| R0-08 | Контракт каталога | [catalog-contract-spec.md](./catalog-contract-spec.md) — 8 XML **наблюдались**; полный контракт ⏸ | структурный аудит снимка; **нет** XSD | 🟡 partial | 8b95946 |
| R0-09 | Вопросы 1С | [onec-specialist-questions.md](./onec-specialist-questions.md) — статусы 🟢/🟡/🔴 | n/a | 🟡 partial R0.2 | 8b95946 |
| R0-10 | Сверка имеющихся материалов | [r02-existing-evidence.md](./r02-existing-evidence.md) | n/a (не новая FTP-проверка) | 🟡 partial | 8b95946 |

**R0.2 целиком:** 🟡 partial — типы/структура снимка зафиксированы; открыты семантика (Q4–Q6, Q5), расширение (Q8), полный контракт каталога (Q12–Q17).

---

## R1 — «Мои клиенты» (приёмка релиза **не заявляется**)

| ID | Экран / сценарий | Требование | Реализация (main) | Тесты | Приёмка R1 | SHA доказательства |
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
| R1-I01 | import | 8-field JSON CLI | `src/onec-clients/*` | R0.1: 116 unit passed; R0.2: **126 unit passed** + fixtures; integration — **не проверено** | n/a | 5c2636c |
| R1-I02 | R1.1 | Discount, Markups | `EXTRA_FIELDS`, не сохраняется | R0.2: `extra-unknown-fields.json` — observed types, warn + 8 ключей | ⏸ blocked Q4–Q6 (смысл) | код: cd276e6; пример: 8b95946 |
| R1-I03 | R1.2 | Extended 1C structure | **нет** | — | ⏸ blocked Q8 | 5c2636c |
| R1-I04 | R1.5 | Scheduled import | CLI only | — | ❌ missing | 5c2636c |
| R1-U01 | R1.4 | UI = прототип v2 | PR #7 interim | Chromium **не проверено**; unit legacy-shell — R0.1/R0.2 | ⏸ blocked | 5c2636c |

### R1.4-prep — подготовка UI «Клиенты» (ограниченный объём)

| ID | Требование | Реализация | Тесты | Приёмка | SHA доказательства |
|----|------------|------------|-------|---------|----------|
| R1-P01 | Список: поиск, фильтры, сброс, пагинация | `public/clients.js` + API | unit clients-*; integration workspace | 🟡 prep | PR head |
| R1-P02 | Возврат из карточки с query | `return` param | unit client-detail-display | 🟡 prep | PR head |
| R1-P03 | Карточка: сотруднические подписи, без UUID в основном UI | `client-detail-sections.js` | unit + browser mocked API | 🟡 prep | PR head |
| R1-P04 | «Загружено в ЛК»; «Время обновления в 1С не передано» | `formatLoadedInLkLabel`, sync status | unit + browser | 🟡 prep | PR head |
| R1-P05 | Копирование адреса и телефона (точный буфер, успех/ошибка, без вызова clipboard для пустого) | `resolveAddressPresentation`, copy controller | unit address + browser (отдельные сценарии адрес/телефон/отказ) | 🟡 prep | PR head |
| R1-P06 | Без коммерции / демоданных | placeholders only | unit asserts no Discount | 🟡 prep | PR head |
| R1-P07 | admin-only сохранён | `requireAdmin` без изменений | **integration не перезапускался** (нет PostgreSQL) | 🟡 prep | main |
| R1-P08 | Exo 2 сохранён; Golos не утверждён | без смены шрифта | n/a | ⏸ blocked UI-B06 | — |
| R1-P09 | Сверка с прототипом v2 PDF | **не выполнялась** (эталон не в repo) | browser 8 screenshots (`test-results/screenshots`, theme toggle UI) | ⏸ blocked UI-B07 | PR head |
| R1-P10 | Переключение темы через UI, логотип, сохранение после reload | `clients-shell.js` toggle | browser mocked API | 🟡 prep | PR head |

**R1.4-prep:** 🟡 partial prep — UI на 8 полях; **не** R1.4, **не** пилот. R0.2 partial; R1.1–R1.3 не завершены.

### R1.3-prep — матрица ролей и прав (docs only)

| ID | Требование | Реализация | Тесты | Приёмка | SHA доказательства |
|----|------------|------------|-------|---------|----------|
| R1-3P01 | Матрица ролей (A/B/поля) | [access-matrix.md](./access-matrix.md) | n/a (spec) | 📋 prep | PR head |
| R1-3P02 | Правила, иерархия, 1С-link, безопасность | [access-rules.md](./access-rules.md) | n/a | 📋 prep | PR head |
| R1-3P03 | Сценарии будущих тестов доступа | [access-acceptance-scenarios.md](./access-acceptance-scenarios.md) | **не выполнялись** | 📋 prep | PR head |
| R1-3P04 | Роли assistant/coordinator + delegations (**предложение**, migration) | access-matrix § рекомендуемая модель | n/a | 📋 prep | PR head |
| R1-3P07 | Серверная проверка срока замещения на каждом запросе | access-rules §6 | ACC-120…123 spec | 📋 prep | PR head |
| R1-3P08 | История после отзыва — без read клиентских данных ассистентом | access-rules §4.5 | ACC-45…46 spec | 📋 prep | PR head |
| R1-3P05 | Серверная фильтрация по ролям | **не реализована** (`requireAdmin`) | integration 403 manager only | ❌ missing R1.3 | main |
| R1-3P06 | user ↔ ID сотрудника 1С | **не реализована** | — | ❌ missing R1.3 | main |

**R1.3-prep:** 📋 prep — документация и сценарии; **не** R1.3, **не** пилот. R0.2, R1.1, R1.2 не закрыты.

---

## UI / Brand (interim PR #7)

| ID | Область | Требование | Реализация | Тесты | Приёмка | SHA main |
|----|---------|------------|------------|-------|---------|----------|
| UI-B01 | Shell | Layout sidebar/header | legacy-shell.css/js | unit legacy-shell-dom; R0.2: 126 passed | n/a R1 | 5c2636c |
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
| `npm test` (unit) | **126 passed**, 0 failed |
| `npm run typecheck` | OK |
| `npm run test:integration` | **не выполнялся** |
| Образец XML `/LC/catalog/` | **не получен** |
| Production FTP/БД | **не подключались** |

### R1.4-prep (2026-09-28, PR #11)

| Проверка | Результат |
|----------|-----------|
| SHA main (база) | `371b40d67193efa48a1c48fe14bd43aca530ae9ae` (PR #10) |
| Проверенный commit PR #11 | `91315723922340825ac56606d64bf3dab32e0f72` |
| `npm test` (unit) | **137 passed**, 0 failed |
| `npm run test:browser` | **11 passed**, 0 failed (Playwright; **mocked API**, real HTML/JS/shell; без прав администратора) |
| `npm run typecheck` | OK |
| `npm run build` | OK |
| `npm run test:integration` | **не выполнялся** (нет PostgreSQL в среде агента) |
| Серверный requireAdmin (API 401/403) | **не перепроверялся**; mock «Нет доступа» ≠ проверка серверной защиты |
| Копирование адрес/телефон | отдельные клики; точный буфер; успех/ошибка без «ИЛИ»; пустой/пробельный адрес — 0 вызовов clipboard |
| Тема | штатная кнопка `[data-theme-toggle]`; логотип official/light; `localStorage` после reload |
| Chromium 1440/390 light+dark × list+card | **8 скриншотов** в `test-results/screenshots/` (переопределение: `TANDOOR_BROWSER_SCREENSHOT_DIR`) |
| Production FTP/БД | **не подключались** |

### R1.3-prep (2026-09-28, PR #13)

| Проверка | Результат |
|----------|-----------|
| SHA main (база) | `d2ece0bede51a4543c0ab8c7c9b30435fabefed0` |
| Проверенный commit PR #13 | `d10d1543a16bc7564659010eb8b5a84f3e2fb970` |
| Код приложения | **не менялся** |
| БД / миграции / импорт / права | **не менялись** |
| `npm test` / integration | **не перезапускались** (docs-only PR) |
| Сценарии ACC-* | спецификация; **автотесты не реализованы** |

### R0.2 продолжение — сверка имеющихся материалов (2026-09-28)

| Проверка | Результат |
|----------|-----------|
| SHA main (база) | `cd276e67193efa48a1c48fe14bd43aca530ae9ae` |
| Проверенный коммит PR №10 (материалы и пример) | `8b95946cb1254aa7ba90c6d35b733cd2d051ff5e` |
| Источник свидетельств | ранее прочитанный снимок 23.09; **не** новая FTP-проверка |
| `npm test` (unit) | **126 passed**, 0 failed |
| `npm run typecheck` | OK |
| `npm run test:integration` | **не выполнялся** |
| Production FTP/БД | **не подключались** |

---

## Следующий шаг

Для **R1.1** нужны подтверждённые правила коммерческих полей **Q4–Q6** и приёмка применимой части R0.2. **Q8** относится к **R1.2**; вопросы каталога **Q12–Q17** относятся к **R3** и не являются техническими условиями реализации R1.1.

R0.2 целиком остаётся **partial**. Переход к R1.1 до полного закрытия R0.2 возможен только после отдельного согласования владельцем ограниченного объёма и обновления плана/промпта. Этот PR не разрешает такой переход автоматически и не меняет очередь релизов.
