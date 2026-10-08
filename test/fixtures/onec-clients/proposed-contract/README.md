# PROPOSED CONTRACT — synthetic holding composition examples

**Not** a 1C export. Illustrates **variant A** (explicit `holding=true` root + member rows).

| File | Business type |
|------|----------------|
| `holding-mono.json` | Холдинг моно (1 юрлицо, 1 ТТ) |
| `holding-mono-network.json` | Холдинг моно сеть |
| `holding-group.json` | Холдинг групп |
| `holding-group-network.json` | Холдинг групп сеть |

Confirmed keys: eight base fields + `holding`, `retail_outlets`, F2–F5 keys as in extended contract (minimal empty/null where not needed for shape).

**Shared ТТ (несколько юрлиц → одна `guid_store`):** в текущем validator при разных вложенных строках на одном `guid_store` возможен `OUTLET_GUID_CONFLICT`. Пример `holding-group-network.json` использует **уникальные** `guid_store` на строках; сценарий shared ТТ — открытый вопрос к контракту (см. business model doc §6).

**New keys (proposal only, not in live export):** none in these minimal files; future `guid_legal_entity` would be listed here if added.
