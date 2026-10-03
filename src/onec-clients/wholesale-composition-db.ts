import type { PoolClient } from "pg";
import type { ExistingCompositionContext } from "./wholesale-composition";

function mapCountRows(
  rows: Array<{ key: string; count: string }>,
): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of rows) {
    map.set(row.key.toLowerCase(), Number(row.count));
  }
  return map;
}

export async function loadExistingCompositionContext(
  client: PoolClient,
): Promise<ExistingCompositionContext> {
  await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
  try {
    const [clients, outlets, accessGrants, linkedAccounts, bitrixTasks] = await Promise.all([
      client.query<{ guid_client: string }>("SELECT guid_client::text FROM onec_clients"),
      client.query<{ guid_client: string; count: string }>(
        `
          SELECT guid_client::text, COUNT(*)::text AS count
          FROM onec_retail_outlets
          GROUP BY guid_client
        `,
      ),
      client.query<{ object_id: string; count: string }>(
        `
          SELECT object_id::text, COUNT(*)::text AS count
          FROM access_grants
          WHERE grant_type = 'client'
            AND revoked_at IS NULL
          GROUP BY object_id
        `,
      ),
      client.query<{ guid_client: string; count: string }>(
        `
          SELECT oc.guid_client::text, COUNT(DISTINCT uo.user_id)::text AS count
          FROM onec_clients oc
          JOIN user_onec_employee_links uo
            ON uo.employee_id = oc.guid_manager
           AND uo.revoked_at IS NULL
          GROUP BY oc.guid_client
        `,
      ),
      client.query<{ card_guid: string; count: string }>(
        `
          SELECT cco.card_guid::text, COUNT(DISTINCT tb.task_id)::text AS count
          FROM bitrix24_client_card_objects cco
          JOIN bitrix24_task_bindings tb
            ON tb.object_type = cco.object_type
           AND tb.object_guid = cco.object_guid
           AND tb.binding_status = 'confirmed'
          GROUP BY cco.card_guid
        `,
      ),
    ]);

    const clientGuids = new Set(clients.rows.map((row) => row.guid_client.toLowerCase()));
    const confirmedOutletsByClient = mapCountRows(
      outlets.rows.map((row) => ({ key: row.guid_client, count: row.count })),
    );
    const activeAccessGrantCountByClient = mapCountRows(
      accessGrants.rows.map((row) => ({ key: row.object_id, count: row.count })),
    );
    const linkedEmployeeAccountCountByClient = mapCountRows(
      linkedAccounts.rows.map((row) => ({ key: row.guid_client, count: row.count })),
    );
    const bitrixTaskCountByClient = mapCountRows(
      bitrixTasks.rows.map((row) => ({ key: row.card_guid, count: row.count })),
    );

    await client.query("COMMIT");
    return {
      baselineAvailability: "loaded",
      clientGuids,
      activeAccessGrantCountByClient,
      linkedEmployeeAccountCountByClient,
      confirmedOutletsByClient,
      bitrixTaskCountByClient,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

export function unavailableCompositionContext(): ExistingCompositionContext {
  return {
    baselineAvailability: "unavailable",
    clientGuids: new Set<string>(),
    activeAccessGrantCountByClient: new Map(),
    linkedEmployeeAccountCountByClient: new Map(),
    confirmedOutletsByClient: new Map(),
    bitrixTaskCountByClient: new Map(),
  };
}
