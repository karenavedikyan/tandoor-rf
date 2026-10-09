# PROPOSED CONTRACT — synthetic holding composition examples

**Not** a 1C export. **PROPOSED CONTRACT** only — **not** current production export semantics.

- **Variant A** files: explicit `holding=true` root — pass **today’s** first-read validator (not a mandate to rework 1C).
- **Variant B:** `holding-variant-b-self-ref-cluster.json` — self-ref root + member rows, **multiple** illustrated legal rows and outlets in one cluster; **does not pass** current validator (`HOLDING_SELF_REFERENCE`, derived issues on children). Parser/normalization for B belongs in a **separate PR**, not mixed with diagnosis PR #71.

## Assumption (proposal only)

Each **member row** (`holding !== true`) stands for **one legal entity** in these demos **if and only if** 1C later confirms «one `guid_client` = one unique legal entity» or supplies a dedicated legal-entity key. **Until then** `legalEntityCount` is unknown in production rules; the tables below are **target composition illustrations**, not live contract facts.

| File | Illustrated composition type (under assumption above) |
|------|--------------------------------------------------------|
| `holding-mono.json` | Холдинг моно (1 юрлицо, 1 ТТ) |
| `holding-mono-network.json` | Холдинг моно сеть |
| `holding-group.json` | Холдинг групп — see note below |
| `holding-group-network.json` | Холдинг групп сеть |
| `holding-variant-b-self-ref-cluster.json` | Variant **B** — self-ref root + 2 member rows, 2 outlets (**validator fail**) |

### `holding-variant-b-self-ref-cluster.json` (variant B proposal)

Minimal cluster: row 0 is **proposed** holding root via `guid_holding === guid_client` (`holding` omitted/false); row 1 is a member pointing at that root. Illustrates that self-ref **does not imply** «mono» (here: 2 rows, 2 outlets under one root). **Not** accepted by current `validateClientsFileBytes`; enabling it requires a **separate parser PR** after 1C contract sign-off.

### `holding-group.json` (composition example, not shared-TT proof)

Two member rows **illustrate** two legal entities under one holding root; **only the first row** carries `retail_outlets` (one `guid_store` in the group). That models **group = 2 legal entities, 1 outlet in the group** under the proposal assumption — **not** proof that 1C supports «one outlet shared by multiple legal entities» or how such a link should be transmitted (open question; see business model doc §5–6).

Confirmed keys in files: eight base fields + `holding`, `retail_outlets`, minimal F2–F5 shape.

**New keys (proposal only):** none here; a future `guid_legal_entity` would be documented when proposed.
