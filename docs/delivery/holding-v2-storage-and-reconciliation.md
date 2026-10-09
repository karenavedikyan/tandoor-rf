# Holding v2 — этап 2: хранение и reconciliation (internal)

**Зависимость:** PR #73 (`holdingExchangeSchema: v2` parser/validator, diagnostic path).  
**Не входит:** pipeline switch, public apply, API/UI, scope/grants, production backfill.

## Схема (migration `041_onec_holding_v2_reconciliation.sql`)

| Таблица | Назначение |
|---------|------------|
| `onec_holding_v2_legal_links` | 1 активная строка / `guid_client` → `guid_holding_root`, `is_holding_head` |
| `onec_holding_v2_outlet_links` | 1 активная строка / `guid_store` → `guid_holding_root`, `is_closed`, `closure_known` |
| `onec_holding_v2_client_type_category` | `type_category` + presence (без destructive omitted/{}/null) |
| `onec_holding_v2_outlet_type_category` | то же для ТТ |
| `onec_holding_v2_reconcile_runs` | журнал прогонов (status, counts, safe `error_code`) |
| `onec_holding_v2_apply_state` | последний `normalized_state_sha256` (singleton) |

### Предпосылки (не реализовано в pipeline)

- **`onec_clients` row must exist`** для каждого `guid_client` в v2-снимке (FK). Создание новых клиентских объектов рабочим import/apply **не** делает этот PR — в integration tests используется `seedOnecClientsForReconcile`.
- **История:** сохраняются текущие v2-связи (`link_active`) и merge type_category; **не** ведётся полная event-sourced история каждого переноса. `onec_holding_v2_reconcile_runs` — агрегаты прогона, не audit trail полей.
- **Витрина / дистрибуция / F1–F5 / roster:** перенос связей v2 **не** доказан сохранением каталога — только отсутствие destructive delete юрлица/ТТ в v2-таблицах. Scope/grants **не** меняются.

## Reconciliation

Entry: `applyHoldingV2Reconciliation({ databaseUrl, payload })`.

1. Pre-checks (без записи): `TYPE_CATEGORY_EXPLICIT_NULL`, `OUTLET_COMPOSITION_INCOMPLETE` (ТТ без `guid_store` при переданном списке).
2. Под lock: load persisted → **`projectHoldingV2BusinessState(persisted, desired)`** (холдинги вне файла сохраняются; снятие связей только в `membershipCompleteHoldings`).
3. **`ORPHAN_HOLDING_LINKS`**: каждая active legal/outlet link → active self-ref head root (отклонение до записи при демotion головы с висящими M/S).
4. `computeBusinessStateSha256(persisted)` vs `computeBusinessStateSha256(projected)` → **`NO_CHANGES`** без upsert/`updated_at` (journal `no_changes` допустим). Same file SHA при пустой БД → первый прогон **SUCCESS** (backfill).
5. Иначе транзакция: upsert links → merge type_category (patch-by-presence; `{}` не затирает ключи; **null с presence → reject**) → post invariant check → journal `success`.

Advisory lock: **`902_451_003`**. Конкурентное второе соединение → `RECONCILE_LOCKED`.

### Safe error codes (внешний результат)

`TYPE_CATEGORY_EXPLICIT_NULL`, `OUTLET_COMPOSITION_INCOMPLETE`, `ORPHAN_HOLDING_LINKS`, `CLIENT_STUB_MISSING`, `RECONCILE_LOCKED`, `INVARIANT_VIOLATION`, `DATABASE_ERROR`.

## Production barrier

`applyClientsImport` → **`APPLY_BLOCKED`** для v2. Reconcile **не** в CLI/FTP/regular-update.

## Следующий этап

Pipeline switch, prod SHA audit, API/UI, scope rules, optional sync с `onec_retail_outlets`.

## Production audit (этап 1)

Не подтверждён. Synthetic bundle: `recordCount=5062`, `holdingRootCount=2742`.
