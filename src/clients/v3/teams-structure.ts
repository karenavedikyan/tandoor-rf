import { query } from "../../db/pool";
import type { AccessContext } from "../../access/types";
import { shortUuidLabel } from "../uuid-param";
import { ROSTER_ROP_POST_LABEL } from "../org/constants";
import {
  OrgStructureAccessError,
  type OrgResponsibleSummary,
  type OrgStructureOverview,
  type OrgRopSummary,
} from "../org/structure-repository";
import { selfRopEmployeeGuidFromContext } from "../self-rop-identity";
import { v3EntityAssignmentScope } from "./access-scope";
import { readableGroupKey } from "./list-legal-grouped";
import { v3JsonManagerField } from "./json-paths";

function assertAccess(context: AccessContext): void {
  if (context.status !== "active") {
    throw new OrgStructureAccessError("Аккаунт неактивен.", "FORBIDDEN");
  }
  if (context.role === "admin" || context.fullClientBase) {
    return;
  }
  if (context.role === "rop" && context.employeeId && context.hasEmployeeLink && !context.employeeLinkConflict) {
    return;
  }
  throw new OrgStructureAccessError("Структура по назначениям недоступна для вашей роли.", "FORBIDDEN");
}

function v3HeadOfSalesClause(alias: string, ropParam: string): string {
  return `NULLIF(TRIM(COALESCE(${v3JsonManagerField(alias, "guidHeadOfSales")}, '')), '')::uuid = ${ropParam}::uuid`;
}

function teamCountsFromResponsibles(items: OrgResponsibleSummary[]): {
  managerCount: number;
  regionalCount: number;
  teamMemberCount: number;
} {
  const managers = new Set<string>();
  const regionals = new Set<string>();
  const allMembers = new Set<string>();
  for (const item of items) {
    const guid = item.employeeGuid.toLowerCase();
    allMembers.add(guid);
    if (item.kind === "manager") {
      managers.add(guid);
    } else if (item.kind === "regional") {
      regionals.add(guid);
    }
  }
  return {
    managerCount: managers.size,
    regionalCount: regionals.size,
    teamMemberCount: allMembers.size,
  };
}

async function countBranch(context: AccessContext, ropGuid: string): Promise<{ legal: number; retail: number }> {
  const leScope = v3EntityAssignmentScope(context, "le", "legal");
  const roScope = v3EntityAssignmentScope(context, "ro", "retail");
  const leParams = [...leScope.params];
  const groupKey = readableGroupKey(context, leParams);
  const ropIdxLe = leParams.length + 1;
  leParams.push(ropGuid);
  const ropIdxRo = roScope.params.length + 1;
  const [legal, retail] = await Promise.all([
    query<{ count: string }>(
      `SELECT COUNT(DISTINCT ${groupKey})::text AS count FROM onec_v3_legal_entities le
       WHERE (${leScope.clause}) AND ${v3HeadOfSalesClause("le", `$${ropIdxLe}`)}`,
      leParams,
    ),
    query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM onec_v3_retail_outlets ro
       WHERE (${roScope.clause}) AND ${v3HeadOfSalesClause("ro", `$${ropIdxRo}`)}`,
      [...roScope.params, ropGuid],
    ),
  ]);
  return {
    legal: Number(legal.rows[0]?.count ?? 0),
    retail: Number(retail.rows[0]?.count ?? 0),
  };
}

export async function getV3OrgStructureOverview(context: AccessContext): Promise<OrgStructureOverview> {
  assertAccess(context);
  const rosterLoaded =
    Number(
      (
        await query<{ employee_count: number }>(
          `SELECT employee_count FROM onec_wholesale_roster_state WHERE id = 1`,
        )
      ).rows[0]?.employee_count ?? 0,
    ) > 0;
  const linked = new Set(
    (
      await query<{ employee_id: string }>(
        `SELECT employee_id::text FROM user_onec_employee_links WHERE revoked_at IS NULL`,
      )
    ).rows.map((r) => r.employee_id.toLowerCase()),
  );
  const rosterRops = await query<{ guid_manager: string; name_manager: string; post: string | null }>(
    `SELECT guid_manager::text, name_manager, post FROM onec_wholesale_employee_roster WHERE post = $1`,
    [ROSTER_ROP_POST_LABEL],
  );
  const rops: OrgRopSummary[] = [];
  for (const row of rosterRops.rows) {
    const counts = await countBranch(context, row.guid_manager);
    const hasPortfolio = counts.legal + counts.retail > 0;
    let managerCount = 0;
    let regionalCount = 0;
    let teamMemberCount = 0;
    if (hasPortfolio && rosterLoaded) {
      const responsibles = await listV3RopResponsibles(context, row.guid_manager);
      const teamCounts = teamCountsFromResponsibles(responsibles);
      managerCount = teamCounts.managerCount;
      regionalCount = teamCounts.regionalCount;
      teamMemberCount = teamCounts.teamMemberCount;
    }
    rops.push({
      employeeGuid: row.guid_manager,
      name: row.name_manager,
      shortId: shortUuidLabel(row.guid_manager),
      rosterPost: row.post,
      hasLinkedAccount: linked.has(row.guid_manager.toLowerCase()),
      hasAssignedPortfolio: hasPortfolio,
      portfolioNote: hasPortfolio ? null : "Нет объектов v3 в ветке РОП",
      managerCount,
      regionalCount,
      teamMemberCount,
      uniqueClientCount: counts.legal,
      uniqueOutletCount: counts.retail,
      parentClientCount: 0,
      sources: ["roster"],
    });
  }
  return {
    director: null,
    rops,
    undefinedTeam: [],
    rosterLoaded,
    limitationNote:
      "Структура команд построена по объектам exchange v3 и справочнику ОПТ (без legacy onec_clients).",
    selfRopEmployeeGuid: selfRopEmployeeGuidFromContext(context),
  };
}

export async function listV3RopResponsibles(
  context: AccessContext,
  ropEmployeeGuid: string,
): Promise<OrgResponsibleSummary[]> {
  assertAccess(context);
  if (context.role === "rop" && context.employeeId?.toLowerCase() !== ropEmployeeGuid.toLowerCase()) {
    throw new OrgStructureAccessError("Нет доступа к ветке РОП.", "FORBIDDEN");
  }
  const leScope = v3EntityAssignmentScope(context, "le", "legal");
  const roScope = v3EntityAssignmentScope(context, "ro", "retail");
  const leParams = [...leScope.params];
  const legalGroupKey = readableGroupKey(context, leParams);
  const leLen = leParams.length;
  const roLen = roScope.params.length;
  const roScopeOffset = leLen + 2;
  let roScopeClause = roScope.clause;
  if (roLen > 0) {
    roScopeClause = roScopeClause.replace(/\$(\d+)/g, (_match, index: string) => `$${Number(index) + roScopeOffset}`);
  }
  const ropLe = leLen + 1;
  const ropExLe = leLen + 2;
  const ropRo = leLen + 2 + roLen + 1;
  const ropExRo = leLen + 2 + roLen + 2;
  const sqlParams = [...leParams, ropEmployeeGuid, ropEmployeeGuid, ...roScope.params, ropEmployeeGuid, ropEmployeeGuid];
  const linked = new Set(
    (
      await query<{ employee_id: string }>(
        `SELECT employee_id::text FROM user_onec_employee_links WHERE revoked_at IS NULL`,
      )
    ).rows.map((r) => r.employee_id.toLowerCase()),
  );

  const rows = await query<{
    kind: "manager" | "regional" | "hardware";
    employee_guid: string;
    name: string | null;
    client_count: string;
    outlet_count: string;
  }>(
    `
      WITH branch_legal AS (
        SELECT le.*, ${legalGroupKey} AS group_key FROM onec_v3_legal_entities le
        WHERE (${leScope.clause}) AND ${v3HeadOfSalesClause("le", `$${ropLe}`)}
      ),
      branch_retail AS (
        SELECT ro.* FROM onec_v3_retail_outlets ro
        WHERE (${roScopeClause}) AND ${v3HeadOfSalesClause("ro", `$${ropRo}`)}
      ),
      legal_mgr AS (
        SELECT 'manager'::text AS kind,
          lower(${v3JsonManagerField("branch_legal", "guidManager")}) AS employee_guid,
          MAX(${v3JsonManagerField("branch_legal", "nameManager")}) AS name,
          COUNT(DISTINCT group_key)::text AS client_count, '0'::text AS outlet_count
        FROM branch_legal
        WHERE NULLIF(TRIM(${v3JsonManagerField("branch_legal", "guidManager")}), '') IS NOT NULL
          AND NULLIF(TRIM(${v3JsonManagerField("branch_legal", "guidManager")}), '')::uuid IS DISTINCT FROM $${ropExLe}::uuid
        GROUP BY 2
      ),
      legal_reg AS (
        SELECT 'regional'::text AS kind,
          lower(${v3JsonManagerField("branch_legal", "guidRegionalManager")}) AS employee_guid,
          MAX(${v3JsonManagerField("branch_legal", "nameRegionalManager")}) AS name,
          COUNT(DISTINCT group_key)::text AS client_count, '0'::text AS outlet_count
        FROM branch_legal
        WHERE NULLIF(TRIM(${v3JsonManagerField("branch_legal", "guidRegionalManager")}), '') IS NOT NULL
          AND NULLIF(TRIM(${v3JsonManagerField("branch_legal", "guidRegionalManager")}), '')::uuid IS DISTINCT FROM $${ropExLe}::uuid
        GROUP BY 2
      ),
      legal_hw AS (
        SELECT 'hardware'::text AS kind,
          lower(${v3JsonManagerField("branch_legal", "guidHardwareManager")}) AS employee_guid,
          MAX(${v3JsonManagerField("branch_legal", "nameHardwareManager")}) AS name,
          COUNT(DISTINCT group_key)::text AS client_count, '0'::text AS outlet_count
        FROM branch_legal
        WHERE NULLIF(TRIM(${v3JsonManagerField("branch_legal", "guidHardwareManager")}), '') IS NOT NULL
          AND NULLIF(TRIM(${v3JsonManagerField("branch_legal", "guidHardwareManager")}), '')::uuid IS DISTINCT FROM $${ropExLe}::uuid
        GROUP BY 2
      ),
      retail_mgr AS (
        SELECT 'manager'::text AS kind,
          lower(${v3JsonManagerField("branch_retail", "guidManager")}) AS employee_guid,
          MAX(${v3JsonManagerField("branch_retail", "nameManager")}) AS name,
          '0'::text AS client_count, COUNT(*)::text AS outlet_count
        FROM branch_retail
        WHERE NULLIF(TRIM(${v3JsonManagerField("branch_retail", "guidManager")}), '') IS NOT NULL
          AND NULLIF(TRIM(${v3JsonManagerField("branch_retail", "guidManager")}), '')::uuid IS DISTINCT FROM $${ropExRo}::uuid
        GROUP BY 2
      ),
      retail_reg AS (
        SELECT 'regional'::text AS kind,
          lower(${v3JsonManagerField("branch_retail", "guidRegionalManager")}) AS employee_guid,
          MAX(${v3JsonManagerField("branch_retail", "nameRegionalManager")}) AS name,
          '0'::text AS client_count, COUNT(*)::text AS outlet_count
        FROM branch_retail
        WHERE NULLIF(TRIM(${v3JsonManagerField("branch_retail", "guidRegionalManager")}), '') IS NOT NULL
          AND NULLIF(TRIM(${v3JsonManagerField("branch_retail", "guidRegionalManager")}), '')::uuid IS DISTINCT FROM $${ropExRo}::uuid
        GROUP BY 2
      ),
      retail_hw AS (
        SELECT 'hardware'::text AS kind,
          lower(${v3JsonManagerField("branch_retail", "guidHardwareManager")}) AS employee_guid,
          MAX(${v3JsonManagerField("branch_retail", "nameHardwareManager")}) AS name,
          '0'::text AS client_count, COUNT(*)::text AS outlet_count
        FROM branch_retail
        WHERE NULLIF(TRIM(${v3JsonManagerField("branch_retail", "guidHardwareManager")}), '') IS NOT NULL
          AND NULLIF(TRIM(${v3JsonManagerField("branch_retail", "guidHardwareManager")}), '')::uuid IS DISTINCT FROM $${ropExRo}::uuid
        GROUP BY 2
      ),
      merged AS (
        SELECT * FROM legal_mgr UNION ALL SELECT * FROM legal_reg UNION ALL SELECT * FROM legal_hw
        UNION ALL SELECT * FROM retail_mgr UNION ALL SELECT * FROM retail_reg UNION ALL SELECT * FROM retail_hw
      )
      SELECT kind, employee_guid, MAX(name) AS name,
        SUM(client_count::int)::text AS client_count,
        SUM(outlet_count::int)::text AS outlet_count
      FROM merged
      GROUP BY kind, employee_guid
      ORDER BY kind, name
    `,
    sqlParams,
  );

  return rows.rows.map((row) => ({
    kind: row.kind,
    employeeGuid: row.employee_guid,
    name: row.name || row.employee_guid.slice(0, 8),
    shortId: shortUuidLabel(row.employee_guid),
    hasLinkedAccount: linked.has(row.employee_guid.toLowerCase()),
    rosterInOpt: null,
    clientCount: Number(row.client_count),
    outletCount: Number(row.outlet_count),
  }));
}
