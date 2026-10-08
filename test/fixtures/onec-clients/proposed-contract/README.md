# PROPOSED CONTRACT — synthetic holding composition examples

**Not** a 1C export. Illustrates **variant A** (explicit `holding=true` root + member rows) for **current** first-read validator only — **not** a mandate to rework 1C.

## Assumption (proposal only)

Each **member row** (`holding !== true`) stands for **one legal entity** in these demos **if and only if** 1C later confirms «one `guid_client` = one unique legal entity» or supplies a dedicated legal-entity key. **Until then** `legalEntityCount` is unknown in production rules; the tables below are **target composition illustrations**, not live contract facts.

| File | Illustrated composition type (under assumption above) |
|------|--------------------------------------------------------|
| `holding-mono.json` | Холдинг моно (1 юрлицо, 1 ТТ) |
| `holding-mono-network.json` | Холдинг моно сеть |
| `holding-group.json` | Холдинг групп — see note below |
| `holding-group-network.json` | Холдинг групп сеть |

### `holding-group.json` (composition example, not shared-TT proof)

Two member rows **illustrate** two legal entities under one holding root; **only the first row** carries `retail_outlets` (one `guid_store` in the group). That models **group = 2 legal entities, 1 outlet in the group** under the proposal assumption — **not** proof that 1C supports «one outlet shared by multiple legal entities» or how such a link should be transmitted (open question; see business model doc §5–6).

Confirmed keys in files: eight base fields + `holding`, `retail_outlets`, minimal F2–F5 shape.

**New keys (proposal only):** none here; a future `guid_legal_entity` would be documented when proposed.
