# Матрица приёмки

**Версия эталона:** прототип v2 + план v1.1  
**SHA main:** `5c2636c3e5e4321f3a53ca680e03b545635a6f51` (R0.1 merged)  
**Дата:** 2026-09-28

## Как читать таблицу

| Колонка | Смысл |
|---------|--------|
| **Реализация** | Код/документ на `main` или в PR R0.2 |
| **Тесты** | Прогон в текущем этапе или «не проверено» |
| **Приёмка** | Релиз по правилу 100%; R0.x ≠ R1 |

**SHA** — коммит `main`, к которому относится код (документы R0.2 — в PR до merge).

---

## R0 — Подготовка

| ID | Требование | Реализация | Тесты | Приёмка | SHA main |
|----|------------|------------|-------|---------|----------|
| R0-01 | Аудит main vs R1 | `docs/delivery/*` на main | n/a | ✅ R0.1 принят (PR #8) | 5c2636c |
| R0-02 | Границы R0–R8 | `release-plan.md` | n/a | ✅ R0.1 | 5c2636c |
| R0-03 | Brand inventory | `brand-contract.md` | n/a | ✅ R0.1 | 5c2636c |
| R0-04 | Source baseline | `source-contracts.md` | код сверен | ✅ R0.1 | 5c2636c |
| R0-05 | Контракт по фактическому обмену | 8 полей: [clients-field-contract.md](./clients-field-contract.md); коммерция/расширение ⏸ | unit validate + синтетика R0.2 | 🟡 **partial R0.2** | 5c2636c |
| R0-06 | Синтетические фикстуры | `test/fixtures/onec-clients/*` | `onec-clients-synthetic-fixtures.test.ts` R0.2 | 🟡 partial (каталог XML нет) | 5c2636c |
| R0-07 | Правила обмена | [exchange-rules.md](./exchange-rules.md) | код README+apply сверен | 🟡 partial (E1–E7 открыты) | 5c2636c |
| R0-08 | Контракт каталога | [catalog-contract-spec.md](./catalog-contract-spec.md) spec only | **нет XML образца** | ⏸ blocked | 5c2636c |
| R0-09 | Вопросы 1С | [onec-specialist-questions.md](./onec-specialist-questions.md) | n/a | 🟡 partial R0.2 | 5c2636c |

**R0.2 целиком:** 🟡 partial — независимая часть выполнена; **не закрыт** без материалов 1С (Q4–Q8, Q11–Q12).

---

## R1 — «Мои клиенты» (приёмка **не заявляется**)

| ID | Требование | Реализация | Тесты | Приёмка R1 | SHA |
|----|------------|------------|-------|------------|-----|
| R1-I01 | 8-field import | `onec-clients/*` | unit R0.2 fixtures + legacy validate tests | n/a | 5c2636c |
| R1-I02 | Discount, Markups | warn only | синтетика `extra-unknown-fields.json` R0.2 | ⏸ blocked Q4–Q6 | 5c2636c |
| R1-I03 | Extended structure | нет | — | ⏸ blocked Q8 | 5c2636c |

*(Остальные строки R1 без изменений логики — см. main до R0.2; приёмка R1 не заявлена.)*

---

## Проверки R0.2 (2026-09-28)

| Проверка | Результат | SHA / источник |
|----------|-----------|----------------|
| `git fetch origin main` | `5c2636c3e5e4321f3a53ca680e03b545635a6f51` | merge PR #8 |
| Production FTP/БД | **не подключались** | — |
| `npm test` | см. PR R0.2 | branch R0.2 |
| `npm run typecheck` | см. PR R0.2 | branch R0.2 |
| `npm run test:integration` | **не выполнялся** | — |
| Образец XML `/LC/catalog/` | **не получен** | блокер R0-08 |

---

## Следующий шаг

Приёмка **R0.2** (Computer) → снятие блокеров 1С → **R1.1** по треку (не автоматически).
