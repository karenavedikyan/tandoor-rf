import type { Pool, PoolClient } from "pg";
import { combineScopeAndFilter } from "../access/combine-filters";
import { buildClientScopeSql } from "../access/scope-sql";
import type { AccessContext } from "../access/types";

export type HoldingV2CompositionVisibility = "visible" | "withheld";

export async function resolveHoldingV2CompositionVisibility(
  context: AccessContext,
  client: Pool | PoolClient,
  holdingRootGuid: string | null,
): Promise<HoldingV2CompositionVisibility> {
  if (!holdingRootGuid) {
    return "visible";
  }

  const legalRows = await client.query<{ guid_client: string }>(
    `
      SELECT guid_client::text
      FROM onec_holding_v2_legal_links
      WHERE guid_holding_root = $1::uuid AND link_active = TRUE
    `,
    [holdingRootGuid],
  );
  const legalGuids = legalRows.rows.map((row) => row.guid_client);
  if (legalGuids.length === 0) {
    return "visible";
  }

  const scope = buildClientScopeSql(context);
  const scoped = combineScopeAndFilter(scope, {
    whereSql: "WHERE guid_client = ANY($1::uuid[])",
    params: [legalGuids],
  });
  if (scoped.whereSql === "WHERE FALSE") {
    return "withheld";
  }

  const visible = await client.query<{ count: string }>(
    `
      SELECT COUNT(*)::text AS count
      FROM onec_clients
      ${scoped.whereSql}
    `,
    scoped.params,
  );
  const visibleCount = Number(visible.rows[0]?.count ?? 0);
  if (visibleCount < legalGuids.length) {
    return "withheld";
  }
  return "visible";
}
