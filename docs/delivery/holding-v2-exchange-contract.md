# Контракт обмена: холдинги v2 и type_category (этап 1 — parser/validator)

**Статус:** подтверждённый контракт 1С → реализация **read-only validation** (`holdingExchangeSchema: v2`).  
**Production apply/import** без изменений (legacy schema); v2 payload → `APPLY_BLOCKED`.

## Definition of Done — этап 1

| Критерий | Статус |
|----------|--------|
| V2 parser/validator (`validateHoldingV2ClientsFileBytes`, structure, composition, `type_category` на v2-пути) | ✅ |
| Read-only diagnostics (`holdingV2Diagnostics`, `scripts/holding-v2-diagnose-clients-file.ts`) | ✅ |
| Read-only аудит **production** `all_clients.json` зафиксирован с воспроизводимым SHA и tallies | ⚠️ **не подтверждён** (см. ниже) |
| Regression tests (`holding-v2-contract.test.ts`, synthetic composition bundle) | ✅ |
| Legacy validator / scheduled import без изменений семантики | ✅ |
| Apply/import: v2 payload → `APPLY_BLOCKED` | ✅ |
| **Не входит в этап 1:** PostgreSQL/storage, reconciliation, pipeline switch на v2 | ⛔ |
| **Не входит:** API/DTO/UI для composition / type_category | ⛔ |
| **Не входит:** закрытие F6 и «полная» модель холдингов в проде | ⛔ |

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

Обязательные ключи stdout (при заданном `AUDIT_CLIENTS_PATH`): `ok`, `issueCount`, `compositionTallies`, `typeCategoryStats`, `diagnosticsTallies` (+ `recordCount`, `sha256`, `byteSize` **без** пути к файлу). Sample issues: `{ code, field, index, outletIndex }` — **без значений полей**, GUID, имён и контактов.

`typeCategoryStats`: `rowsWithTypeCategoryObject` — ключ `type_category` с JSON-объектом (в т.ч. `{}`); `rowsWithTypeCategoryFieldKeys` — хотя бы один из `guid_type` / `name_type` / … в объекте.

## V2 payload при `sourceFormat: legacy`

`validateHoldingV2ClientsFileBytes` **не** зависит от extended-маркеров файла: при `holdingExchangeSchema: v2` в payload сохраняются `extendedRecords` (parsed `type_category`, `fieldPresence` связей, `retail_outlets`), даже если детектор вернул `sourceFormat: legacy`. Default `validateClientsFileBytes` (legacy schema) по-прежнему **не** отдаёт `extendedRecords`.

## Read-only свидетельства (Computer)

### A. Синтетический bundle (воспроизводимо в CI)

`buildCompositionPatternBundle({ monoCount: 422, groupNetworkCount: 2320 })` — **не** production JSON.

| Поле | Значение |
|------|----------|
| `ok` | `true` |
| `issueCount` | `0` |
| `recordCount` | **5062** (= 422×1 + 2320×2 юрлица) |
| `diagnosticsTallies.holdingRootCount` | **2742** (= 422 + 2320 голов) |
| `compositionTallies` | mono **422**, mono_network **0**, group **0**, group_network **2320** |
| Инвариант | Σ типов состава = `holdingRootCount`; `legalEntityRowCount` ≥ `holdingRootCount` + `group` + `group_network` |

Минимальная модель: mono = 1 юрлицо + 1 ТТ; group_network = голова + 1 member + 2 ТТ на голове.

### B. Production `all_clients.json` — **непроверенно в репозитории**

Ранее в документе фигурировали `recordCount=2742` вместе с `group_network=2320` (≥2 юрлица на холдинг) — **арифметически несовместимо** с одной строкой на юрлицо (ожидаемый минимум юрлиц ≈ 422 + 2×2320 = **5062** при той же классификации).

Пока нет зафиксированного **полного SHA-256** снимка, версии кода диагностики и первичного JSON-отчёta в CI, **production-цифры не считаются подтверждёнными**. Кандидат для сверки: SHA-256 prefix `a957ab33…` (полный hash — при следующем read-only прогоне с `AUDIT_CLIENTS_PATH`).

## Этап 2 (отдельный PR, stacked на #73)

См. [`holding-v2-storage-and-reconciliation.md`](./holding-v2-storage-and-reconciliation.md) — migration `041`, internal `applyHoldingV2Reconciliation`, test-DB integration. Public apply по-прежнему заблокирован.

## Следующий этап (pipeline / UI)

1. Backfill gate + regular-update на v2.  
2. API/DTO, scope-safe `visible` / `withheld`, UI badge.  
3. Production audit с полным SHA и prod JSON.

## Неподтверждённо (не реализуем destructively)

- Semantics omitted/null для `type_category` (не правило «удалить связи»).  
- Глобальное удаление холдинга, отсутствующего в файле.  
- Перенос ТТ между холдингами — проверять на реальных JSON при этапе 2.
