import type { TransactionClient } from "./db";
import { AccessServiceError } from "./db";
import { getActiveUser, getEmployeeId } from "./authorization";

export async function assertDelegatorEffectiveClientAccess(
  client: TransactionClient,
  delegatorUserId: string,
  clientGuids: string[],
): Promise<void> {
  const delegator = await getActiveUser(client, delegatorUserId);
  if (delegator.role !== "manager" && delegator.role !== "rop") {
    throw new AccessServiceError(
      "Передающий должен быть менеджером или РОП с действующими полномочиями.",
      "FORBIDDEN",
    );
  }

  const employeeId = await getEmployeeId(client, delegatorUserId);

  const owned = await client.query<{ guid_client: string }>(
    `
      SELECT guid_client::text
      FROM onec_clients
      WHERE guid_client = ANY($1::uuid[])
        AND guid_manager = $2::uuid
    `,
    [clientGuids, employeeId],
  );
  if (owned.rows.length !== clientGuids.length) {
    throw new AccessServiceError(
      "Передающий менеджер не имеет права на один или несколько клиентов.",
      "FORBIDDEN",
    );
  }

  const denied = await client.query<{ guid_client: string }>(
    `
      SELECT DISTINCT oc.guid_client::text
      FROM onec_clients oc
      WHERE oc.guid_client = ANY($1::uuid[])
        AND EXISTS (
          SELECT 1
          FROM access_denials ad
          WHERE ad.user_id = $2::uuid
            AND ad.revoked_at IS NULL
            AND (
              ad.scope_type = 'all_clients'
              OR ad.object_id = oc.guid_client
            )
        )
    `,
    [clientGuids, delegatorUserId],
  );

  if (denied.rows.length > 0) {
    throw new AccessServiceError(
      "Для передающего действует явный запрет на один или несколько клиентов.",
      "FORBIDDEN",
    );
  }
}
