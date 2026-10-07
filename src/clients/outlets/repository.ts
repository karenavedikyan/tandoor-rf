import { mergeSqlFilters } from "../../access/combine-filters";
import type { AccessContext } from "../../access/types";
import { query } from "../../db/pool";
import type { RetailOutletsListResponse } from "../dto";
import { toRetailOutletListItem } from "../dto";
import type { ClientsListQuery } from "../query";
import { buildClientsFilter } from "../query";
import { buildClientsOrderBy } from "../sort";
import {
  buildOutletsListFilter,
  outletSortExpressions,
  outletSnapshotSubquery,
  outletStoreAddressSql,
} from "./list-filter";
import { applyOrgTeamsOutletFilter } from "../org/teams-list-filters";
import { applyOutletListAssignmentFilters } from "../list-assignment-filters";
import { ListClientsError } from "../repository";
import { buildOutletScope, scopedHasOutletsClause } from "./scope-sql";

type CountRow = { count: string };

type OutletRow = {
  guid_store: string;
  guid_client: string;
  client_name: string;
  is_closed: boolean;
  store_address: string | null;
  name_holding: string;
  guid_manager: string;
  name_manager: string;
  outlet_snapshot: unknown;
};

export async function listRetailOutlets(
  context: AccessContext,
  input: ClientsListQuery,
): Promise<RetailOutletsListResponse> {
  const ropEmployeeGuid =
    input.ropEmployeeGuid ??
    (input.view === "teams" &&
    context.role === "rop" &&
    context.employeeId &&
    !input.ropUserId
      ? context.employeeId.toLowerCase()
      : undefined);

  if (input.view === "teams" && ropEmployeeGuid) {
    if (context.role === "rop" && context.employeeId?.toLowerCase() !== ropEmployeeGuid.toLowerCase()) {
      throw new ListClientsError("Нет доступа к ветке РОП.", "FORBIDDEN");
    }
  } else if (input.view !== "all") {
    return {
      items: [],
      total: 0,
      page: input.page,
      pageSize: input.pageSize,
      totalPages: 0,
      isEmptyDatabase: false,
    };
  }

  const outletScope = buildOutletScope(context);
  const userFilter = buildClientsFilter({ ...input, q: "" });
  const filterClause = userFilter.whereSql
    ? userFilter.whereSql.replace(/^WHERE\s+/, "").replaceAll("onec_clients.", "oc.")
    : "";

  let combinedWhere = mergeSqlFilters(
    outletScope,
    filterClause ? [filterClause] : [],
    userFilter.params,
  );

  let regionalEmployeeParam: string | undefined;
  if (context.role === "regional_manager" && context.employeeId) {
    const existingEmployeeIndex = combinedWhere.params.findIndex(
      (param) => typeof param === "string" && param.toLowerCase() === context.employeeId!.toLowerCase(),
    );
    if (existingEmployeeIndex >= 0) {
      regionalEmployeeParam = `$${existingEmployeeIndex + 1}::text`;
    } else {
      regionalEmployeeParam = `$${combinedWhere.params.length + 1}::text`;
      combinedWhere = {
        whereSql: combinedWhere.whereSql,
        params: [...combinedWhere.params, context.employeeId],
      };
    }
  }

  if (input.hasOutlets === "yes" || input.hasOutlets === "no") {
    combinedWhere = mergeSqlFilters(
      combinedWhere,
      [scopedHasOutletsClause(context, input.hasOutlets, "oc", regionalEmployeeParam)],
      [],
    );
  }

  const outletListFilter = buildOutletsListFilter(input);
  if (outletListFilter.whereSql) {
    const outletClause = outletListFilter.whereSql.replace(/^WHERE\s+/, "");
    combinedWhere = mergeSqlFilters(combinedWhere, [outletClause], outletListFilter.params);
  }

  if (input.view === "teams" && ropEmployeeGuid) {
    const orgFilter = applyOrgTeamsOutletFilter({ whereSql: "", params: [] }, input, ropEmployeeGuid);
    if (orgFilter.whereSql) {
      const orgClause = orgFilter.whereSql.replace(/^WHERE\s+/, "");
      combinedWhere = mergeSqlFilters(combinedWhere, [orgClause], orgFilter.params);
    }
  } else if (input.view === "all") {
    combinedWhere = applyOutletListAssignmentFilters(combinedWhere, input);
  }

  const fromSql = `
    FROM onec_retail_outlets ro
    JOIN onec_clients oc ON oc.guid_client = ro.guid_client
  `;

  const totalResult = await query<CountRow>(
    `SELECT COUNT(*)::text AS count ${fromSql} ${combinedWhere.whereSql}`,
    combinedWhere.params,
  );
  const total = Number(totalResult.rows[0]?.count ?? "0");
  const totalPages = total === 0 ? 0 : Math.ceil(total / input.pageSize);
  const offset = (input.page - 1) * input.pageSize;
  const listParams = [...combinedWhere.params, input.pageSize, offset];
  const limitParam = `$${combinedWhere.params.length + 1}`;
  const offsetParam = `$${combinedWhere.params.length + 2}`;

  const sortExprs = outletSortExpressions();
  const orderBy = buildClientsOrderBy(input, {
    includeTeamSort: false,
    outletStoreAddressExpr: sortExprs.storeAddress,
    outletManagerNameExpr: sortExprs.managerName,
    outletRegionalNameExpr: sortExprs.regionalName,
    outletWarehouseExpr: sortExprs.warehouseSortKey,
    outletTandoorClubExpr: sortExprs.tandoorClub,
  });

  const snapshotExpr = outletSnapshotSubquery("ro", "oc");

  const rows = await query<OutletRow>(
    `
      SELECT
        ro.guid_store::text,
        ro.guid_client::text,
        oc.name_client AS client_name,
        ro.is_closed,
        ${outletStoreAddressSql("ro", "oc")} AS store_address,
        oc.name_holding,
        oc.guid_manager::text,
        oc.name_manager,
        ${snapshotExpr} AS outlet_snapshot
      ${fromSql}
      ${combinedWhere.whereSql}
      ${orderBy}
      LIMIT ${limitParam}
      OFFSET ${offsetParam}
    `,
    listParams,
  );

  return {
    items: rows.rows.map((row) => toRetailOutletListItem(row)),
    total,
    page: input.page,
    pageSize: input.pageSize,
    totalPages,
    isEmptyDatabase: false,
  };
}
