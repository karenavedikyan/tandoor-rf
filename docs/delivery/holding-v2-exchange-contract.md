# Контракт обмена: холдинги v2 и type_category (этап 1 — parser/validator)

**Статус:** подтверждённый контракт 1С → реализация **read-only validation** (`holdingExchangeSchema: v2`).  
**Production apply/import** без изменений (legacy schema); v2 payload → `APPLY_BLOCKED`.

## Карта JSON → код → хранение

| Контракт 1С | Parser (этап 1) | PostgreSQL / UI (этап 2+) |
|-------------|-----------------|---------------------------|
| `guid_holding`, self-ref head | `validateHoldingV2Structure` | `onec_clients.guid_holding` (без смены семантики apply) |
| `retail_outlets[]` только на head | `HOLDING_V2_NON_HEAD_OUTLETS` | `extended_snapshot` / outlets registry — **следующий PR** |
| `type_category` на клиенте / ТТ | `parseTypeCategoryExchangeFields` | **не persist** в этапе 1 |
| Тип состава (моно/…) | `classifyHoldingCompositionSiteType` | **не в API/UI** в этапе 1 |
| F2–F5, roster | без изменений | как на main |

## Барьер apply

- Default: `validateClientsFileBytes` → `holdingExchangeSchema: legacy` (self-ref **ошибка**).
- Диагностика / новый контракт: `validateHoldingV2ClientsFileBytes` → `holdingExchangeSchema: v2`.
- `applyClientsImport` отклоняет `holdingExchangeSchema === "v2"` с `APPLY_BLOCKED`.

## Read-only диагностика файла

```bash
export AUDIT_CLIENTS_PATH=/path/to/all_clients.json
node --import tsx scripts/holding-v2-diagnose-clients-file.ts
```

Вывод: SHA256, recordCount, `issueCount`, `compositionTallies`, `typeCategoryStats`, `diagnosticsTallies`, sample `{ code, field, index, outletIndex }` — **без значений полей**, GUID, имён и путей к файлу.

## Read-only аудит production-снимка (Computer)

**Дата:** 2026-10-09 · **Режим:** `validateHoldingV2ClientsFileBytes` (read-only, без apply/import)  
**Файл:** штатный export `all_clients.json` · **SHA-256 (prefix):** `a957ab33…` · **Записей:** 2742

| Проверка | Результат |
|----------|-----------|
| Валидация v2 | `ok=true`, `issueCount=0` |
| Self-ref head (ожидание бизнеса) | 422 головных self-ref |
| `type_category` | 2742 / 2742 строк с объектом, 0 `INVALID_TYPE_CATEGORY` |
| Дубли `guid_store` на голове | 0 |
| Cross-holding конфликты ТТ | 0 |
| Циклы `guid_holding` | 0 |

**Распределение типа состава (holding-level, не row-level):**

| Тип | Количество холдингов |
|-----|----------------------|
| mono | 422 |
| mono_network | 0 |
| group | 0 |
| group_network | 2320 |
| no_active_outlets | (не зафиксировано в отчёте) |
| unknown | (не зафиксировано в отчёте) |

Сумма классифицированных холдингов в отчёте Computer: **2742** (= 422 + 2320). Классификация считается **на кластер** `guid_holding` (см. `holdingV2Diagnostics.compositionTypeDistribution`).

Регрессия в репозитории: `buildCompositionPatternBundle({ monoCount: 422, groupNetworkCount: 2320 })` воспроизводит те же **composition tallies** и `ok=true` без встраивания production JSON (минимальная модель: mono = 1 юрлицо + 1 ТТ; group_network = голова + 1 member + 2 ТТ на голове).

## Следующий этап (не этот PR)

1. Migration / snapshot fields для `type_category` и composition type.  
2. Reconciliation membership (omitted links ≠ keep old).  
3. Backfill gate + regular-update на v2.  
4. API/DTO, scope-safe `visible` / `withheld`, UI badge.

## Неподтверждённо (не реализуем destructively)

- Semantics omitted/null для `type_category` (не правило «удалить связи»).  
- Глобальное удаление холдинга, отсутствующего в файле.  
- Перенос ТТ между холдингами — проверять на реальных JSON при этапе 2.
