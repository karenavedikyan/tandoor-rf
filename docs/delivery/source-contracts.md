# Контракты источников данных

**SHA main (база R0.2):** `5c2636c3e5e4321f3a53ca680e03b545635a6f51` (merge PR #8, R0.1)  
**Этап:** R0.2 · 2026-09-28 · **production FTP/БД не подключались**

## Состав документации R0.2

| Документ | Содержание |
|----------|------------|
| [clients-field-contract.md](./clients-field-contract.md) | Поля `all_clients.json`: 8 ключей, коммерция, расширение |
| [exchange-rules.md](./exchange-rules.md) | Snapshot, повтор, unknown fields, открытые вопросы |
| [catalog-contract-spec.md](./catalog-contract-spec.md) | Ожидание R3.1; **XML не утверждён** |
| [onec-specialist-questions.md](./onec-specialist-questions.md) | Вопросы 1С → материалы → блокеры |

Синтетические фикстуры: `test/fixtures/onec-clients/` · тесты: `test/unit/onec-clients-synthetic-fixtures.test.ts`

---

## 1. FTP — три уровня (не смешивать)

| Уровень | Значение | Где |
|---------|----------|-----|
| **Базовый каталог** | `ONEC_FTP_BASE_PATH` — **обязательный** env; **runtime-default нет** | `src/onec-ftp/config.ts` |
| **Относительный путь** | `CLIENTS_RELATIVE_PATH = "clients/all_clients.json"` | `src/onec-clients/constants.ts` |
| **Итоговый path** | `{basePath}/clients/all_clients.json` | `src/onec-clients/path.ts` |

Пример: `ONEC_FTP_BASE_PATH=/LC` → `/LC/clients/all_clients.json`.  
`.env.example` содержит **пример** `/LC`, не default приложения.

### Разрешённая область (политика v1.1, не env)

| Путь (при base `/LC`) | Назначение | ЛК |
|-----------------------|------------|-----|
| `/LC/clients/all_clients.json` | Snapshot клиентов | импорт CLI ✅ |
| `/LC/catalog/` | Товарный блок XML | **не подключён** (R3.1) |
| Заказы / финансы | — | **не исследовались** в R0.2 |

---

## 2. Клиенты — сводка

### Подтверждено (код + unit-тесты + синтетика R0.2)

- 8 обязательных ключей — см. [clients-field-contract.md §1](./clients-field-contract.md#1-восемь-ключей-текущего-импорта-подтверждено-кодом--тестами)
- Правила валидации, snapshot upsert, `RECORD_COUNT_DECREASED` — [exchange-rules.md](./exchange-rules.md)

### Частично подтверждено (аудит v1.1 — нужна сверка 1С)

| Поле | Наличие в обмене | Смысл | Импорт |
|------|------------------|-------|--------|
| `Discount` | аудит 28.09: «не сохраняются» | **неизвестно** | `EXTRA_FIELDS` |
| `DiscountAmount` | то же | **неизвестно** | не сохраняется |
| `Markups` | то же | **неизвестно** | не сохраняется |

### Не утверждено (блокер R1.2)

Расширенная структура: холдинг, юрлица, ТТ, реквизиты, ответственные — **файл не получен**.

---

## 3. Каталог — сводка

**Контракт XML не утверждён.** Спецификация ожидаемого поведения R3.1: [catalog-contract-spec.md](./catalog-contract-spec.md).  
**Блокер:** обезличенный образец `/LC/catalog/`.

---

## 4. Сущности и запреты (v1.1)

- `guid_client` — PK snapshot; **не** ID юрлица/ТТ без подтверждения 1С.
- Холдинг на строке — атрибут, не нормализованная таблица.
- Связи **только** по явным ID; не по имени/телефону/адресу.
- ЛК — кэш, не CRM.

---

## 5. Auth (без изменений main)

`/api/clients/*` — `requireAdmin`. Mapping user↔1C — R1.3.

---

## 6. Статус R0.2

| Компонент | Статус |
|-----------|--------|
| Контракт 8 полей + правила обмена | ✅ документирован + синтетика |
| Discount/Markups/Markups смысл | ⏸ блокер Q4–Q6 |
| Расширенный JSON клиентов | ⏸ блокер Q8 |
| Контракт каталога XML | ⏸ блокер Q11–Q12 |
| **R0.2 закрыт полностью** | **нет** — ждёт материалы 1С |

Следующий промпт после приёмки R0.2: **не R1.1 автоматически** — по треку v1.1 после снятия блокеров.
