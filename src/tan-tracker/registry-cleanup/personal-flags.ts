import type { Pool, PoolClient } from "pg";

type Db = Pool | PoolClient;

export type PersonalRegistryLists = {
  hiddenTransferIds: string[];
  archivedTransferIds: string[];
};

export async function loadPersonalRegistryLists(
  client: Db,
  ownerPartyId: string,
): Promise<PersonalRegistryLists> {
  const res = await client.query<{
    public_code: string;
    hidden_at: Date | null;
    personal_archived_at: Date | null;
  }>(
    `SELECT t.public_code, f.hidden_at, f.personal_archived_at
     FROM tt_personal_registry_flags f
     JOIN tt_transfers t ON t.id = f.transfer_id
     WHERE f.owner_party_id = $1::uuid AND t.deleted_at IS NULL`,
    [ownerPartyId],
  );
  const hiddenTransferIds: string[] = [];
  const archivedTransferIds: string[] = [];
  for (const row of res.rows) {
    if (row.personal_archived_at) archivedTransferIds.push(row.public_code);
    else if (row.hidden_at) hiddenTransferIds.push(row.public_code);
  }
  return { hiddenTransferIds, archivedTransferIds };
}

export async function setPersonalArchived(
  client: PoolClient,
  ownerPartyId: string,
  transferIds: string[],
  archived: boolean,
): Promise<void> {
  for (const transferId of transferIds) {
    if (archived) {
      await client.query(
        `INSERT INTO tt_personal_registry_flags (owner_party_id, transfer_id, personal_archived_at, hidden_at, updated_at)
         VALUES ($1::uuid, $2, NOW(), NULL, NOW())
         ON CONFLICT (owner_party_id, transfer_id) DO UPDATE SET
           personal_archived_at = NOW(),
           hidden_at = NULL,
           updated_at = NOW()`,
        [ownerPartyId, transferId],
      );
    } else {
      await client.query(
        `UPDATE tt_personal_registry_flags
         SET personal_archived_at = NULL, updated_at = NOW()
         WHERE owner_party_id = $1::uuid AND transfer_id = $2`,
        [ownerPartyId, transferId],
      );
    }
  }
}

export async function setPersonalHidden(
  client: PoolClient,
  ownerPartyId: string,
  transferIds: string[],
  hidden: boolean,
): Promise<void> {
  for (const transferId of transferIds) {
    if (hidden) {
      await client.query(
        `INSERT INTO tt_personal_registry_flags (owner_party_id, transfer_id, hidden_at, personal_archived_at, updated_at)
         VALUES ($1::uuid, $2, NOW(), NULL, NOW())
         ON CONFLICT (owner_party_id, transfer_id) DO UPDATE SET
           hidden_at = NOW(),
           personal_archived_at = NULL,
           updated_at = NOW()`,
        [ownerPartyId, transferId],
      );
    } else {
      await client.query(
        `UPDATE tt_personal_registry_flags
         SET hidden_at = NULL, updated_at = NOW()
         WHERE owner_party_id = $1::uuid AND transfer_id = $2`,
        [ownerPartyId, transferId],
      );
    }
  }
}

export async function clearPersonalFlagsForTransfer(client: PoolClient, transferId: string): Promise<void> {
  await client.query(`DELETE FROM tt_personal_registry_flags WHERE transfer_id = $1`, [transferId]);
}
