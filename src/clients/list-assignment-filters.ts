import { mergeSqlFilters } from "../access/combine-filters";
import {
  extendedRefPresenceClause,
  guidListMatchClause,
  legacyClientManagerPresenceClause,
} from "./assignment-filter-modes";
import type { SqlFilter } from "./query";
import type { ClientsListQuery } from "./query";
import {
  clientAssignedToRopClause,
  clientHardwareGuidSql,
  clientHeadOfSalesGuidSql,
  clientRegionalGuidSql,
  managerInRopBranchClause,
  outletHardwareGuidSql,
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
      [extendedRefPresenceClause("onec_clients.extended_snapshot->'regionalManager'", "unassigned")],
      [],
    );
  }
  if (input.missingHardware) {
    filter = mergeSqlFilters(
      filter,
      [extendedRefPresenceClause("onec_clients.extended_snapshot->'hardwareManager'", "unassigned")],
      [],
    );
  }

  if (input.regionalManagerIds && input.regionalManagerIds.length > 0 && !input.regionalManagerMode) {
    filter = mergeSqlFilters(
      filter,
      [guidListMatchClause(clientRegionalGuidSql("onec_clients"), "$1")],
      [input.regionalManagerIds],
    );
  } else if (input.regionalManagerId && !input.regionalManagerMode) {
    filter = mergeSqlFilters(
      filter,
      [`${clientRegionalGuidSql("onec_clients")} = lower($1::text)`],
      [input.regionalManagerId],
    );
  }
  if (input.regionalManagerMode) {
    filter = mergeSqlFilters(
      filter,
      [extendedRefPresenceClause("onec_clients.extended_snapshot->'regionalManager'", input.regionalManagerMode)],
      [],
    );
  }

  if (input.hardwareManagerIds && input.hardwareManagerIds.length > 0 && !input.hardwareManagerMode) {
    filter = mergeSqlFilters(
      filter,
      [guidListMatchClause(clientHardwareGuidSql("onec_clients"), "$1")],
      [input.hardwareManagerIds],
    );
  } else if (input.hardwareManagerId && !input.hardwareManagerMode) {
    filter = mergeSqlFilters(
      filter,
      [`${clientHardwareGuidSql("onec_clients")} = lower($1::text)`],
      [input.hardwareManagerId],
    );
  }
  if (input.hardwareManagerMode) {
    filter = mergeSqlFilters(
      filter,
      [extendedRefPresenceClause("onec_clients.extended_snapshot->'hardwareManager'", input.hardwareManagerMode)],
      [],
    );
  }

  if (input.clientManagerMode) {
    filter = mergeSqlFilters(filter, [legacyClientManagerPresenceClause(input.clientManagerMode)], []);
  }

  if (input.ropEmployeeMode) {
    filter = mergeSqlFilters(
      filter,
      [extendedRefPresenceClause("onec_clients.extended_snapshot->'headOfSales'", input.ropEmployeeMode)],
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
  } else if (input.managerIds && input.managerIds.length > 0) {
    filter = mergeSqlFilters(filter, [guidListMatchClause(outletManagerSql, "$1")], [input.managerIds]);
  } else if (manager) {
    filter = mergeSqlFilters(filter, [`${outletManagerSql} = lower($1::text)`], [manager]);
  }

  if (input.regionalManagerIds && input.regionalManagerIds.length > 0 && !orgTeamsRegionalHandled) {
    filter = mergeSqlFilters(filter, [guidListMatchClause(outletRegionalSql, "$1")], [input.regionalManagerIds]);
  } else if (input.regionalManagerId && !orgTeamsRegionalHandled) {
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
      [extendedRefPresenceClause(`${snapshotExpr}->'managers'->'regionalManager'`, "unassigned")],
      [],
    );
  }
  if (input.missingHardware) {
    filter = mergeSqlFilters(
      filter,
      [extendedRefPresenceClause(`${snapshotExpr}->'managers'->'hardwareManager'`, "unassigned")],
      [],
    );
  }

  const outletHardwareSql = outletHardwareGuidSql(snapshotExpr);

  if (input.hardwareManagerIds && input.hardwareManagerIds.length > 0 && !input.hardwareManagerMode) {
    filter = mergeSqlFilters(filter, [guidListMatchClause(outletHardwareSql, "$1")], [input.hardwareManagerIds]);
  } else if (input.hardwareManagerId && !input.hardwareManagerMode) {
    filter = mergeSqlFilters(filter, [`${outletHardwareSql} = lower($1::text)`], [input.hardwareManagerId]);
  }
  if (input.hardwareManagerMode) {
    filter = mergeSqlFilters(
      filter,
      [extendedRefPresenceClause(`${snapshotExpr}->'managers'->'hardwareManager'`, input.hardwareManagerMode)],
      [],
    );
  }

  if (input.regionalManagerMode) {
    filter = mergeSqlFilters(
      filter,
      [extendedRefPresenceClause(`${snapshotExpr}->'managers'->'regionalManager'`, input.regionalManagerMode)],
      [],
    );
  }

  if (input.outletManagerMode) {
    filter = mergeSqlFilters(
      filter,
      [extendedRefPresenceClause(`${snapshotExpr}->'managers'->'manager'`, input.outletManagerMode)],
      [],
    );
  }

  if (input.ropEmployeeMode) {
    filter = mergeSqlFilters(
      filter,
      [extendedRefPresenceClause(`${snapshotExpr}->'managers'->'headOfSales'`, input.ropEmployeeMode)],
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
