import type { Pool, PoolClient } from "pg";
import { combineScopeAndFilter, mergeSqlFilters } from "../access/combine-filters";
import { buildClientScopeSql } from "../access/scope-sql";
import type { AccessContext } from "../access/types";
import { buildOutletScope } from "./outlets/scope-sql";

export type HoldingV2CompositionVisibility = "visible" | "withheld";

async function countScopedRows(
  client: Pool | PoolClient,
  whereSql: string,
  params: unknown[],
  fromSql: string,
): Promise<number> {
  if (whereSql === "WHERE FALSE") {
    return 0;
  }
  const visible = await client.query<{ count: string }>(
    `
      SELECT COUNT(*)::text AS count
      FROM ${fromSql}
      ${whereSql}
    `,
    params,
  );
  return Number(visible.rows[0]?.count ?? 0);
}

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
  if (legalGuids.length > 0) {
    const scope = buildClientScopeSql(context);
    const scoped = combineScopeAndFilter(scope, {
      whereSql: "WHERE guid_client = ANY($1::uuid[])",
      params: [legalGuids],
    });
    const visibleLegalCount = await countScopedRows(client, scoped.whereSql, scoped.params, "onec_clients");
    if (visibleLegalCount < legalGuids.length) {
      return "withheld";
    }
  }

  const outletLinkRows = await client.query<{ guid_store: string }>(
    `
      SELECT guid_store::text
      FROM onec_holding_v2_outlet_links
      WHERE guid_holding_root = $1::uuid AND link_active = TRUE
    `,
    [holdingRootGuid],
  );
  const outletGuids = outletLinkRows.rows.map((row) => row.guid_store);
  if (outletGuids.length > 0) {
    const outletScope = buildOutletScope(context);
    if (outletScope.whereSql === "WHERE FALSE") {
      return "withheld";
    }
    const scopedOutlets = mergeSqlFilters(outletScope, ["ro.guid_store = ANY($1::uuid[])"], [outletGuids]);
    const visibleOutletCount = await countScopedRows(
      client,
      scopedOutlets.whereSql,
      scopedOutlets.params,
      "onec_retail_outlets ro INNER JOIN onec_clients oc ON oc.guid_client = ro.guid_client",
    );
    if (visibleOutletCount < outletGuids.length) {
      return "withheld";
    }
  }

  return "visible";
}
