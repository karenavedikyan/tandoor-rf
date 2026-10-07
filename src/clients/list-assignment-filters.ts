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
  const rop = input.ropEmployeeGuid ?? input.clientRopEmployeeGuid;
  const manager = input.clientManagerId ?? input.managerId;

  if (rop && manager) {
    filter = mergeSqlFilters(filter, [managerInRopBranchClause("$1", "$2")], [rop, manager]);
  } else if (rop) {
    filter = mergeSqlFilters(filter, [clientAssignedToRopClause("$1")], [rop]);
  }

  if (input.missingClientRop ?? input.missingRop) {
    filter = mergeSqlFilters(filter, [`${clientHeadOfSalesGuidSql("onec_clients")} IS NULL`], []);
  }
  if (input.missingClientManager ?? input.missingManager) {
    filter = mergeSqlFilters(
      filter,
      [
        `NULLIF(BTRIM(lower(onec_clients.guid_manager::text)), '${ZERO_UUID}') IS NULL`,
      ],
      [],
    );
  }
  if (input.missingClientRegional ?? input.missingRegional) {
    filter = mergeSqlFilters(
      filter,
      [extendedRefPresenceClause("onec_clients.extended_snapshot->'regionalManager'", "unassigned")],
      [],
    );
  }
  if (input.missingClientHardware ?? input.missingHardware) {
    filter = mergeSqlFilters(
      filter,
      [extendedRefPresenceClause("onec_clients.extended_snapshot->'hardwareManager'", "unassigned")],
      [],
    );
  }

  const clientRegionalIds = input.clientRegionalManagerIds ?? input.regionalManagerIds;
  const clientRegionalId = input.clientRegionalManagerId ?? input.regionalManagerId;
  const clientRegionalMode = input.clientRegionalManagerMode ?? input.regionalManagerMode;

  if (clientRegionalIds && clientRegionalIds.length > 0 && !clientRegionalMode) {
    filter = mergeSqlFilters(
      filter,
      [guidListMatchClause(clientRegionalGuidSql("onec_clients"), "$1")],
      [clientRegionalIds],
    );
  } else if (clientRegionalId && !clientRegionalMode) {
    filter = mergeSqlFilters(
      filter,
      [`${clientRegionalGuidSql("onec_clients")} = lower($1::text)`],
      [clientRegionalId],
    );
  }
  if (clientRegionalMode) {
    filter = mergeSqlFilters(
      filter,
      [extendedRefPresenceClause("onec_clients.extended_snapshot->'regionalManager'", clientRegionalMode)],
      [],
    );
  }

  const clientHardwareIds = input.clientHardwareManagerIds ?? input.hardwareManagerIds;
  const clientHardwareId = input.clientHardwareManagerId ?? input.hardwareManagerId;
  const clientHardwareMode = input.clientHardwareManagerMode ?? input.hardwareManagerMode;

  if (clientHardwareIds && clientHardwareIds.length > 0 && !clientHardwareMode) {
    filter = mergeSqlFilters(
      filter,
      [guidListMatchClause(clientHardwareGuidSql("onec_clients"), "$1")],
      [clientHardwareIds],
    );
  } else if (clientHardwareId && !clientHardwareMode) {
    filter = mergeSqlFilters(
      filter,
      [`${clientHardwareGuidSql("onec_clients")} = lower($1::text)`],
      [clientHardwareId],
    );
  }
  if (clientHardwareMode) {
    filter = mergeSqlFilters(
      filter,
      [extendedRefPresenceClause("onec_clients.extended_snapshot->'hardwareManager'", clientHardwareMode)],
      [],
    );
  }

  const clientManagerIds = input.clientManagerIds ?? input.managerIds;
  const clientManagerId = input.clientManagerId ?? input.managerId;
  if (clientManagerIds && clientManagerIds.length > 0 && !input.clientManagerMode) {
    filter = mergeSqlFilters(
      filter,
      [`onec_clients.guid_manager = ANY($1::uuid[])`],
      [clientManagerIds],
    );
  } else if (clientManagerId && !input.clientManagerMode) {
    filter = mergeSqlFilters(filter, [`onec_clients.guid_manager = $1::uuid`], [clientManagerId]);
  }

  if (input.clientManagerMode) {
    filter = mergeSqlFilters(filter, [legacyClientManagerPresenceClause(input.clientManagerMode)], []);
  }

  const clientRopMode = input.clientRopEmployeeMode ?? input.ropEmployeeMode;
  if (clientRopMode) {
    filter = mergeSqlFilters(
      filter,
      [extendedRefPresenceClause("onec_clients.extended_snapshot->'headOfSales'", clientRopMode)],
      [],
    );
  }

  const clientRopGuid = input.clientRopEmployeeGuid;
  if (clientRopGuid && !clientRopMode && !rop) {
    filter = mergeSqlFilters(
      filter,
      [`${clientHeadOfSalesGuidSql("onec_clients")} = lower($1::text)`],
      [clientRopGuid],
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
  const rop = input.ropEmployeeGuid ?? input.outletRopEmployeeGuid;
  const manager = input.outletManagerId ?? input.managerId;
  const orgTeamsRegionalHandled = Boolean(rop) && Boolean(input.outletRegionalManagerId ?? input.regionalManagerId);

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
  } else if (input.outletManagerIds && input.outletManagerIds.length > 0) {
    filter = mergeSqlFilters(filter, [guidListMatchClause(outletManagerSql, "$1")], [input.outletManagerIds]);
  } else if (input.managerIds && input.managerIds.length > 0) {
    filter = mergeSqlFilters(filter, [guidListMatchClause(outletManagerSql, "$1")], [input.managerIds]);
  } else if (manager) {
    filter = mergeSqlFilters(filter, [`${outletManagerSql} = lower($1::text)`], [manager]);
  }

  const outletRegionalIds = input.outletRegionalManagerIds ?? input.regionalManagerIds;
  const outletRegionalId = input.outletRegionalManagerId ?? input.regionalManagerId;
  if (outletRegionalIds && outletRegionalIds.length > 0 && !orgTeamsRegionalHandled) {
    filter = mergeSqlFilters(filter, [guidListMatchClause(outletRegionalSql, "$1")], [outletRegionalIds]);
  } else if (outletRegionalId && !orgTeamsRegionalHandled) {
    filter = mergeSqlFilters(filter, [`${outletRegionalSql} = lower($1::text)`], [outletRegionalId]);
  }

  if (input.missingOutletRop ?? input.missingRop) {
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
  if (input.missingOutletManager ?? input.missingManager) {
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
  if (input.missingOutletRegional ?? input.missingRegional) {
    filter = mergeSqlFilters(
      filter,
      [extendedRefPresenceClause(`${snapshotExpr}->'managers'->'regionalManager'`, "unassigned")],
      [],
    );
  }
  if (input.missingOutletHardware ?? input.missingHardware) {
    filter = mergeSqlFilters(
      filter,
      [extendedRefPresenceClause(`${snapshotExpr}->'managers'->'hardwareManager'`, "unassigned")],
      [],
    );
  }

  const outletHardwareSql = outletHardwareGuidSql(snapshotExpr);
  const outletHardwareIds = input.outletHardwareManagerIds ?? input.hardwareManagerIds;
  const outletHardwareId = input.outletHardwareManagerId ?? input.hardwareManagerId;
  const outletHardwareMode = input.outletHardwareManagerMode ?? input.hardwareManagerMode;

  if (outletHardwareIds && outletHardwareIds.length > 0 && !outletHardwareMode) {
    filter = mergeSqlFilters(filter, [guidListMatchClause(outletHardwareSql, "$1")], [outletHardwareIds]);
  } else if (outletHardwareId && !outletHardwareMode) {
    filter = mergeSqlFilters(filter, [`${outletHardwareSql} = lower($1::text)`], [outletHardwareId]);
  }
  if (outletHardwareMode) {
    filter = mergeSqlFilters(
      filter,
      [extendedRefPresenceClause(`${snapshotExpr}->'managers'->'hardwareManager'`, outletHardwareMode)],
      [],
    );
  }

  const outletRegionalMode = input.outletRegionalManagerMode ?? input.regionalManagerMode;
  if (outletRegionalMode) {
    filter = mergeSqlFilters(
      filter,
      [extendedRefPresenceClause(`${snapshotExpr}->'managers'->'regionalManager'`, outletRegionalMode)],
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

  const outletRopMode = input.outletRopEmployeeMode ?? input.ropEmployeeMode;
  if (outletRopMode) {
    filter = mergeSqlFilters(
      filter,
      [extendedRefPresenceClause(`${snapshotExpr}->'managers'->'headOfSales'`, outletRopMode)],
      [],
    );
  }

  const outletRopGuid = input.outletRopEmployeeGuid;
  if (outletRopGuid && !outletRopMode && !rop) {
    filter = mergeSqlFilters(filter, [`${ropHeadSql} = lower($1::text)`], [outletRopGuid]);
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
