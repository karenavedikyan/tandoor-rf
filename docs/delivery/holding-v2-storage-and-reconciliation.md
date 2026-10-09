# Holding v2 — этап 2: хранение и reconciliation (internal)

**Зависимость:** PR #73 (`holdingExchangeSchema: v2` parser/validator, diagnostic path).  
**Не входит:** pipeline switch, public apply, API/UI, scope/grants, production backfill.

## Схема (migration `041_onec_holding_v2_reconciliation.sql`)

| Таблица | Назначение |
|---------|------------|
| `onec_holding_v2_legal_links` | 1 активная строка / `guid_client` → `guid_holding_root`, `is_holding_head` |
| `onec_holding_v2_outlet_links` | 1 активная строка / `guid_store` → `guid_holding_root`, `is_closed`, `closure_known` |
| `onec_holding_v2_client_type_category` | `type_category` + presence (без destructive omitted/{}) |
| `onec_holding_v2_outlet_type_category` | то же для ТТ |
| `onec_holding_v2_reconcile_runs` | журнал internal apply |
| `onec_holding_v2_apply_state` | последний `normalized_state_sha256` (singleton) |

**Legacy compatibility:** `onec_clients`, `onec_retail_outlets`, extended snapshot и legacy import **не** переключаются этим PR. V2-слой заполняется только через `applyHoldingV2Reconciliation` после v2-валидации. FK `legal_links.guid_client → onec_clients` — stubs должны существовать (тесты seed через `seedOnecClientsForReconcile`).

## Reconciliation

Entry: `applyHoldingV2Reconciliation({ databaseUrl, payload })` — [`src/onec-clients/holding-v2-reconcile/`](../src/onec-clients/holding-v2-reconcile/).

1. `buildHoldingV2DesiredSnapshot` — order-independent карта связей из `extendedRecords`.
2. `computeDesiredNormalizedStateSha256` — канонический hash активных связей + type_category patches.
3. Сравнение с persisted hash → **`NO_CHANGES`** (совпадение SHA файла **не** достаточно).
4. Иначе одна транзакция: advisory lock `902_451_003` → upsert legal/outlet links → для `membershipCompleteHoldings` deactivate ссылки внутри холдинга, отсутствующие в снимке → merge type_category (patch-by-presence).
5. Инварианты: один active `guid_client`, один active `guid_store`.

### Правила удаления связей

- Холдинг **отсутствует целиком** в файле → строки v2 **не** трогаем.
- Холдинг **в файле** и membership complete → outlet/legal links на этом root, не в desired set → `link_active=false`.
- `retail_outlets: []` / explicit empty → нет active outlet links для complete head.
- Omitted `type_category` → **не** обновляем stored metadata; `{}` → object present, ключи полей не очищают сохранённые значения.

## Production barrier

`applyClientsImport` по-прежнему **`APPLY_BLOCKED`** для `holdingExchangeSchema: v2`. Internal reconcile **не** вызывается из CLI/FTP/regular-update.

## Следующий этап (не этот PR)

- Pipeline switch + verification gate на prod JSON (полный SHA audit).
- API/DTO composition + `withheld` presentation.
- Scope/grants при смене holding membership (без auto-expand доступа).
- Связь v2 layer с `onec_retail_outlets.guid_client` при согласованной политике.

## Production audit (этап 1)

Цифры `recordCount=2742` vs `group_network=2320` **не подтверждены** на production JSON в CI. Воспроизводимый эталон — synthetic bundle (`recordCount=5062`, `holdingRootCount=2742`).
