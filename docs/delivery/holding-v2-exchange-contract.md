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

Вывод: SHA256, recordCount, issueCodes, sample `{ code, field, index, outletIndex }` — **без значений полей**.

## Следующий этап (не этот PR)

1. Migration / snapshot fields для `type_category` и composition type.  
2. Reconciliation membership (omitted links ≠ keep old).  
3. Backfill gate + regular-update на v2.  
4. API/DTO, scope-safe `visible` / `withheld`, UI badge.

## Неподтверждённо (не реализуем destructively)

- Semantics omitted/null для `type_category` (не правило «удалить связи»).  
- Глобальное удаление холдинга, отсутствующего в файле.  
- Перенос ТТ между холдингами — проверять на реальных JSON при этапе 2.
