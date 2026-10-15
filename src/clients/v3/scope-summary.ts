import { query } from "../../db/pool";
import type { AccessContext } from "../../access/types";
import { v3EntityAssignmentScope } from "./access-scope";
import { countV3LegalGroups } from "./list-legal-grouped";
import { appendAssignmentFilters, type V3ListQuery, type V3ResponsibleKind } from "./list";

export type V3TerritoryQuery = {
  ropBranchGuid?: string;
  responsibleGuid?: string;
  responsibleKind?: V3ResponsibleKind;
  managerGuid?: string;
};

function territoryListInput(territory: V3TerritoryQuery): V3ListQuery {
  return {
    entity: "legal",
    page: 1,
    pageSize: 1,
    q: "",
    ropBranchGuid: territory.ropBranchGuid,
    responsibleGuid: territory.responsibleGuid,
    responsibleKind: territory.responsibleKind,
    managerGuid: territory.managerGuid,
  };
}

async function countInScope(
  context: AccessContext,
  table: string,
  alias: string,
  kind: "legal" | "retail",
  orphanOnly: boolean,
  territory: V3TerritoryQuery,
): Promise<number> {
  const scope = v3EntityAssignmentScope(context, alias, kind);
  const orphanSql = orphanOnly ? ` AND ${alias}.guid_holding IS NULL` : "";
  const params = [...scope.params];
  const filters = appendAssignmentFilters(territoryListInput(territory), alias, params);
  const result = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM ${table} AS ${alias} WHERE (${scope.clause})${orphanSql}${filters}`,
    params,
  );
  return Number(result.rows[0]?.count ?? 0);
}

export async function loadV3ScopeSummary(
  context: AccessContext,
  territory: V3TerritoryQuery,
): Promise<{ legal: number; retail: number }> {
  const [legal, retail] = await Promise.all([
    countV3LegalGroups(context, territory),
    countInScope(context, "onec_v3_retail_outlets", "ro", "retail", false, territory),
  ]);
  return { legal, retail };
}
