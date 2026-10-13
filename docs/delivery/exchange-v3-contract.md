# Exchange v3 — контракт FTP `LC/clients/`

**Статус:** действующий контракт для нового импорта (PR draft, `main` после merge).  
**Исторические документы** (`clients-field-contract.md`, holding-v2 pipeline) — только для поиска legacy-зависимостей.

## Файлы комплекта

| Файл | Назначение |
|------|------------|
| `all_holding.json` | Холдинги и состав (ссылки на юрлица и ТТ через `guid_retail`) |
| `all_clients.json` | Юрлица (`guid_client`) |
| `all_retail.json` | Торговые точки (`guid_store`), **без** `guid_client` |
| `all_employees.json` | Справочник ОПТ (контракт без изменений) |

Корень: JSON-массив, UTF-8. Ориентиры по объёму снимка 13.10.2026 — в промпте владельца; **не** зашивать в валидатор.

## Семантика `guid_retail` в холдинге

- В `legal_entities[]` — UUID **юрлица** (`all_clients.guid_client`).
- В `retail_outlets[]` — UUID **ТТ** (`all_retail.guid_store`).

Переименование полей в 1С не требуется.

## Поля `other` (юрлица)

Публикуется только явная карта `V3_SUPPORTED_CLIENT_OTHER_KEYS` в коде (`src/onec-exchange-v3/other-fields.ts`). Весь объект `other` через API не отдаётся.

## Нормализация

- Пустая строка и нулевой UUID в необязательном GUID → отсутствие значения.
- Нулевой UUID в обязательном идентификаторе → запись не создаётся.
- `loading_time` — локальное время без TZ.
- Неизвестные ключи не ломают импорт; ошибки структуры и дубли PK блокируют apply.

## Ограничение согласованности

Без маркера готовности 1С **нельзя** гарантировать, что четыре файла сформированы одним заданием. Импорт использует SHA256 каждого файла и **bundle fingerprint**; при отсутствии `export_bundle_manifest.json` в runbook фиксируется ограничение (см. `exchange-v3-clean-start-runbook.md`).

## Реализация

- Валидация: `src/onec-exchange-v3/validate-bundle.ts`
- Apply: `src/onec-exchange-v3/apply.ts`
- Админ «Обновить из 1С»: `src/onec-regular-update/run-update.ts` → v3
