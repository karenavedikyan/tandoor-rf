# Контракт обмена: холдинги v2 и type_category (этап 1 — parser/validator)

**Статус:** подтверждённый контракт 1С → реализация **read-only validation** (`holdingExchangeSchema: v2`).  
**Production apply/import** без изменений (legacy schema); v2 payload → `APPLY_BLOCKED`.

## Definition of Done — этап 1

| Критерий | Статус |
|----------|--------|
| V2 parser/validator (`validateHoldingV2ClientsFileBytes`, structure, composition, `type_category` на v2-пути) | ✅ |
| Read-only diagnostics (`holdingV2Diagnostics`, `scripts/holding-v2-diagnose-clients-file.ts`) | ✅ |
| Read-only аудит production-снимка зафиксирован в этом документе (без PII) | ✅ |
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

Обязательные ключи stdout (при заданном `AUDIT_CLIENTS_PATH`): `ok`, `issueCount`, `compositionTallies`, `typeCategoryStats`, `diagnosticsTallies` (+ `recordCount`, `sha256`, `byteSize` без пути к файлу). Sample issues: `{ code, field, index, outletIndex }` — **без значений полей**, GUID, имён и контактов.

## Read-only аудит production-снимка (Computer)

**Дата:** 2026-10-09 · **Режим:** `validateHoldingV2ClientsFileBytes` (read-only, без apply/import)  
**Файл:** штатный export `all_clients.json` · **SHA-256 (prefix):** `a957ab33…`

| Поле отчёта | Значение (Computer) |
|-------------|---------------------|
| `ok` | `true` |
| `issueCount` | `0` |
| `recordCount` | `2742` |
| `compositionTallies.mono` | `422` |
| `compositionTallies.mono_network` | `0` |
| `compositionTallies.group` | `0` |
| `compositionTallies.group_network` | `2320` |
| `typeCategoryStats.recordCount` | `2742` |
| `typeCategoryStats.rowsWithTypeCategoryObject` | `2742` |
| `typeCategoryStats.invalidCount` | `0` |
| `diagnosticsTallies.duplicateOutletGuidCount` | `0` |
| `diagnosticsTallies.outletParentLinkConflicts` | `0` |
| Циклы / holding link (`issueCount`, коды `HOLDING_V2_*`) | `0` issues |

Сумма `compositionTallies` (mono + group_network): **2742** (= 422 + 2320). Классификация — **на кластер** `guid_holding` (`compositionTallies` ≡ `holdingV2Diagnostics.compositionTypeDistribution`).

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
