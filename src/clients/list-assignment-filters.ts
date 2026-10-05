import { mergeSqlFilters } from "../access/combine-filters";
import type { SqlFilter } from "./query";
import type { ClientsListQuery } from "./query";
import {
  clientAssignedToRopClause,
  clientHeadOfSalesGuidSql,
  clientRegionalGuidSql,
  managerInRopBranchClause,
  outletHeadOfSalesGuidSql,
  outletManagerGuidSql,
  outletRegionalGuidSql,
} from "./org/assignment-sql";
import { outletSnapshotSubquery } from "./outlets/list-filter";

const ZERO_UUID = "00000000-0000-0000-0000-000000000000";

function usesOrgTeamsBranchFilters(input: ClientsListQuery): boolean {
  return input.view === "teams" && Boolean(input.ropEmployeeGuid);
}

export function applyClientListAssignmentFilters(
  userFilter: SqlFilter,
  input: ClientsListQuery,
): SqlFilter {
  if (usesOrgTeamsBranchFilters(input)) {
    return userFilter;
  }

  let filter = userFilter;
  const rop = input.ropEmployeeGuid;
  const manager = input.managerId;

  if (rop && manager) {
    filter = mergeSqlFilters(filter, [managerInRopBranchClause("$1", "$2")], [rop, manager]);
  } else if (rop) {
    filter = mergeSqlFilters(filter, [clientAssignedToRopClause("$1")], [rop]);
  }

  if (input.missingRop) {
    filter = mergeSqlFilters(filter, [`${clientHeadOfSalesGuidSql("onec_clients")} IS NULL`], []);
  }
  if (input.missingManager) {
    filter = mergeSqlFilters(
      filter,
      [
        `NULLIF(BTRIM(lower(onec_clients.guid_manager::text)), '${ZERO_UUID}') IS NULL`,
      ],
      [],
    );
  }
  if (input.missingRegional) {
    filter = mergeSqlFilters(
      filter,
      [`onec_clients.extended_snapshot->'regionalManager'->>'state' = 'unassigned'`],
      [],
    );
  }

  return filter;
}

export function applyOutletListAssignmentFilters(
  userFilter: SqlFilter,
  input: ClientsListQuery,
): SqlFilter {
  if (usesOrgTeamsBranchFilters(input)) {
    return userFilter;
  }

  const snapshotExpr = outletSnapshotSubquery("ro", "oc");
  const ropHeadSql = outletHeadOfSalesGuidSql(snapshotExpr);
  const outletManagerSql = outletManagerGuidSql(snapshotExpr);
  const outletRegionalSql = outletRegionalGuidSql(snapshotExpr);

  let filter = userFilter;
  const rop = input.ropEmployeeGuid;
  const manager = input.managerId;
  const orgTeamsRegionalHandled = Boolean(rop) && Boolean(input.regionalManagerId);

  if (rop && manager) {
    filter = mergeSqlFilters(
      filter,
      [
        `${ropHeadSql} = lower($1::text)`,
        `${outletManagerSql} = lower($2::text)`,
      ],
      [rop, manager],
    );
  } else if (rop) {
    filter = mergeSqlFilters(filter, [`${ropHeadSql} = lower($1::text)`], [rop]);
  } else if (manager) {
    filter = mergeSqlFilters(filter, [`${outletManagerSql} = lower($1::text)`], [manager]);
  }

  if (input.regionalManagerId && !orgTeamsRegionalHandled) {
    filter = mergeSqlFilters(filter, [`${outletRegionalSql} = lower($1::text)`], [input.regionalManagerId]);
  }

  if (input.missingRop) {
    filter = mergeSqlFilters(
      filter,
      [
        `(
          ${ropHeadSql} IS NULL
          OR COALESCE(${snapshotExpr}->'managers'->'headOfSales'->>'state', '') IN ('unassigned', 'invalid')
        )`,
      ],
      [],
    );
  }
  if (input.missingManager) {
    filter = mergeSqlFilters(
      filter,
      [
        `(
          ${outletManagerSql} IS NULL
          OR COALESCE(${snapshotExpr}->'managers'->'manager'->>'state', '') IN ('unassigned', 'invalid')
        )`,
      ],
      [],
    );
  }
  if (input.missingRegional) {
    filter = mergeSqlFilters(
      filter,
      [`COALESCE(${snapshotExpr}->'managers'->'regionalManager'->>'state', '') = 'unassigned'`],
      [],
    );
  }

  return filter;
}

export function buildScopedRopOptionsSql(scopeWhere: string, scopeParams: unknown[]): {
  sql: string;
  params: unknown[];
} {
  const scopeClause = scopeWhere ? scopeWhere.replace(/^WHERE\s+/, "") : "TRUE";
  return {
    sql: `
      SELECT DISTINCT ON (rop_guid)
        rop_guid AS id,
        COALESCE(rop_name, rop_guid) AS name
      FROM (
        SELECT
          ${clientHeadOfSalesGuidSql("oc")} AS rop_guid,
          NULLIF(BTRIM(oc.extended_snapshot->'headOfSales'->>'name'), '') AS rop_name
        FROM onec_clients oc
        WHERE ${scopeClause.replaceAll("onec_clients.", "oc.")}
        UNION ALL
        SELECT
          ${outletHeadOfSalesGuidSql("outlet")} AS rop_guid,
          NULLIF(BTRIM(outlet->'managers'->'headOfSales'->>'name'), '') AS rop_name
        FROM onec_clients oc
        CROSS JOIN LATERAL jsonb_array_elements(
          COALESCE(oc.extended_snapshot->'currentRetailOutlets', '[]'::jsonb)
        ) outlet
        WHERE ${scopeClause.replaceAll("onec_clients.", "oc.")}
      ) scoped_rop
      WHERE rop_guid IS NOT NULL
      ORDER BY rop_guid ASC, rop_name ASC
    `,
    params: scopeParams,
  };
}

export { clientRegionalGuidSql };
