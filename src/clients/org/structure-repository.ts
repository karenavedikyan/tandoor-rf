import { combineScopeAndFilter } from "../../access/combine-filters";
import { buildClientScopeSql } from "../../access/scope-sql";
import type { AccessContext } from "../../access/types";
import { query } from "../../db/pool";
import {
  ACTIVE_BASELINE_CLIENT_SQL,
  ACTIVE_BASELINE_OC_SQL,
} from "../../onec-clients/baseline-active-scope";
import { shortUuidLabel } from "../uuid-param";
import {
  clientAssignedToRopClause,
  clientNotAssignedToRopClause,
  clientHardwareGuidSql,
  clientHeadOfSalesGuidSql,
  clientHeadOfSalesNameSql,
  clientRegionalGuidSql,
  outletAssignedToRopClause,
  outletHardwareGuidSql,
  outletHeadOfSalesGuidSql,
  outletManagerGuidSql,
  outletRegionalGuidSql,
  outletStoreGuidSql,
  RETAIL_OUTLETS_JSON,
} from "./assignment-sql";
import { ORG_DIRECTOR_EMPLOYEE_GUID, ROSTER_ROP_POST_LABEL } from "./constants";

export type OrgDirectorSummary = {
  employeeGuid: string;
  name: string;
  shortId: string;
  rosterPost: string | null;
  hasLinkedAccount: boolean;
  note: string;
};

export type OrgRopSummary = {
  employeeGuid: string;
  name: string;
  shortId: string;
  rosterPost: string | null;
  hasLinkedAccount: boolean;
  hasAssignedPortfolio: boolean;
  portfolioNote: string | null;
  /** Distinct managers (client + outlet level) in the branch, excluding the ROP. */
  managerCount: number;
  /** Distinct regionals (client + outlet level) in the branch, excluding the ROP. */
  regionalCount: number;
  /** Distinct responsibles across manager/regional/hardware kinds, excluding the ROP. */
  teamMemberCount: number;
  /** Clients with client-level headOfSales matching this ROP. */
  uniqueClientCount: number;
  /** Outlets with outlet-level headOfSales matching this ROP. */
  uniqueOutletCount: number;
  /** Parent clients of outlet-only assignments (not directly assigned to this ROP). */
  parentClientCount: number;
  sources: Array<"roster" | "assignment">;
};

export type OrgResponsibleSummary = {
  kind: "manager" | "regional" | "hardware";
  employeeGuid: string;
  name: string;
  shortId: string;
  hasLinkedAccount: boolean;
  rosterInOpt: boolean | null;
  clientCount: number;
  outletCount: number;
};

export type OrgUndefinedTeamMember = {
  employeeGuid: string;
  name: string;
  shortId: string;
  rosterPost: string | null;
  hasLinkedAccount: boolean;
};

export type OrgStructureOverview = {
  director: OrgDirectorSummary | null;
  rops: OrgRopSummary[];
  undefinedTeam: OrgUndefinedTeamMember[];
  rosterLoaded: boolean;
  limitationNote: string;
};

function assertOrgStructureAccess(context: AccessContext): void {
  if (context.status !== "active") {
    throw new OrgStructureAccessError("Аккаунт неактивен.", "FORBIDDEN");
  }
  if (context.employeeLinkConflict) {
    throw new OrgStructureAccessError("Конфликт привязки сотрудника 1С.", "FORBIDDEN");
  }
  if (context.role === "admin" || context.fullClientBase) {
    return;
  }
  if (
    context.role === "rop" &&
    context.employeeId &&
    context.hasEmployeeLink &&
    !context.employeeLinkConflict
  ) {
    return;
  }
  throw new OrgStructureAccessError("Структура по назначениям недоступна для вашей роли.", "FORBIDDEN");
}

export class OrgStructureAccessError extends Error {
  code: "FORBIDDEN" | "NOT_FOUND";

  constructor(message: string, code: "FORBIDDEN" | "NOT_FOUND") {
    super(message);
    this.code = code;
  }
}

async function loadRosterLoaded(): Promise<boolean> {
  const result = await query<{ employee_count: number }>(
    `SELECT employee_count FROM onec_wholesale_roster_state WHERE id = 1`,
  );
  return Number(result.rows[0]?.employee_count ?? 0) > 0;
}

export async function loadLinkedAccountGuids(): Promise<Set<string>> {
  const result = await query<{ employee_id: string }>(
    `SELECT employee_id::text FROM user_onec_employee_links WHERE revoked_at IS NULL`,
  );
  return new Set(result.rows.map((row) => row.employee_id.toLowerCase()));
}

export async function loadDirectorSummary(linked: Set<string>): Promise<OrgDirectorSummary | null> {
  const result = await query<{ guid_manager: string; name_manager: string; post: string | null }>(
    `
      SELECT guid_manager::text, name_manager, post
      FROM onec_wholesale_employee_roster
      WHERE lower(guid_manager::text) = $1
      LIMIT 1
    `,
    [ORG_DIRECTOR_EMPLOYEE_GUID],
  );
  const row = result.rows[0];
  const name =
    row?.name_manager ??
    (
      await query<{ name: string | null }>(
        `
          SELECT MAX(${clientHeadOfSalesNameSql()}) AS name
          FROM onec_clients
          WHERE ${ACTIVE_BASELINE_CLIENT_SQL.trim()}
            AND lower(guid_manager::text) = $1
        `,
        [ORG_DIRECTOR_EMPLOYEE_GUID],
      )
    ).rows[0]?.name ??
    "Директор";
  return {
    employeeGuid: ORG_DIRECTOR_EMPLOYEE_GUID,
    name,
    shortId: shortUuidLabel(ORG_DIRECTOR_EMPLOYEE_GUID),
    rosterPost: row?.post ?? null,
    hasLinkedAccount: linked.has(ORG_DIRECTOR_EMPLOYEE_GUID),
    note: "Организационная роль директора задаётся по GUID 1С и не дублируется в списке РОП.",
  };
}

type RopCandidateRow = {
  employee_guid: string;
  name: string;
  roster_post: string | null;
  from_roster: boolean;
  from_assignment: boolean;
};

async function loadRopCandidates(): Promise<RopCandidateRow[]> {
  const result = await query<RopCandidateRow>(
    `
      WITH roster_rops AS (
        SELECT
          lower(guid_manager::text) AS employee_guid,
          name_manager AS name,
          post AS roster_post,
          TRUE AS from_roster,
          FALSE AS from_assignment
        FROM onec_wholesale_employee_roster
        WHERE post = $2
      ),
      assignment_rops AS (
        SELECT DISTINCT
          ${clientHeadOfSalesGuidSql()} AS employee_guid,
          MAX(${clientHeadOfSalesNameSql()}) AS name,
          NULL::text AS roster_post,
          FALSE AS from_roster,
          TRUE AS from_assignment
        FROM onec_clients
        WHERE ${ACTIVE_BASELINE_CLIENT_SQL.trim()}
          AND ${clientHeadOfSalesGuidSql()} IS NOT NULL
        GROUP BY 1
        UNION
        SELECT DISTINCT
          ${outletHeadOfSalesGuidSql("outlet.elem")} AS employee_guid,
          MAX(NULLIF(BTRIM(outlet.elem->'managers'->'headOfSales'->>'name'), '')) AS name,
          NULL::text AS roster_post,
          FALSE AS from_roster,
          TRUE AS from_assignment
        FROM onec_clients
        CROSS JOIN LATERAL jsonb_array_elements(${RETAIL_OUTLETS_JSON}) outlet(elem)
        WHERE ${ACTIVE_BASELINE_CLIENT_SQL.trim()}
          AND ${outletHeadOfSalesGuidSql("outlet.elem")} IS NOT NULL
        GROUP BY 1
      ),
      merged AS (
        SELECT * FROM roster_rops
        UNION ALL
        SELECT * FROM assignment_rops
      )
      SELECT
        employee_guid,
        MAX(name) AS name,
        MAX(roster_post) AS roster_post,
        BOOL_OR(from_roster) AS from_roster,
        BOOL_OR(from_assignment) AS from_assignment
      FROM merged
      WHERE employee_guid IS NOT NULL
        AND employee_guid <> $1
      GROUP BY employee_guid
      ORDER BY MAX(name) ASC NULLS LAST, employee_guid ASC
    `,
    [ORG_DIRECTOR_EMPLOYEE_GUID, ROSTER_ROP_POST_LABEL],
  );
  return result.rows;
}

function activeBaselineForAlias(clientAlias: string): string {
  return `COALESCE(${clientAlias}.baseline_status, 'active') = 'active'`;
}

function scopedClientFilter(
  context: AccessContext,
  clientAlias = "onec_clients",
): { whereSql: string; params: unknown[]; denied: boolean } {
  const scope = buildClientScopeSql(context);
  const scopedForAlias = {
    whereSql: scope.whereSql.replaceAll("onec_clients.", `${clientAlias}.`),
    params: scope.params,
  };
  const filter = combineScopeAndFilter(scopedForAlias, {
    whereSql: `WHERE ${activeBaselineForAlias(clientAlias)}`,
    params: [],
  });
  if (filter.whereSql === "WHERE FALSE") {
    return { whereSql: "WHERE FALSE", params: [], denied: true };
  }
  return { whereSql: filter.whereSql, params: filter.params, denied: false };
}

async function countAssignedClients(context: AccessContext, ropGuid: string): Promise<number> {
  const scoped = scopedClientFilter(context, "onec_clients");
  if (scoped.denied) {
    return 0;
  }
  const ropParamIndex = scoped.params.length + 1;
  const result = await query<{ count: string }>(
    `
      SELECT COUNT(DISTINCT onec_clients.guid_client)::text AS count
      FROM onec_clients
      ${scoped.whereSql}
        AND ${clientAssignedToRopClause(`$${ropParamIndex}`, "onec_clients")}
    `,
    [...scoped.params, ropGuid.toLowerCase()],
  );
  return Number(result.rows[0]?.count ?? "0");
}

async function countAssignedOutlets(context: AccessContext, ropGuid: string): Promise<number> {
  const scoped = scopedClientFilter(context, "oc");
  if (scoped.denied) {
    return 0;
  }
  const ropParamIndex = scoped.params.length + 1;
  const result = await query<{ count: string }>(
    `
      SELECT COUNT(DISTINCT ro.guid_store)::text AS count
      FROM onec_retail_outlets ro
      JOIN onec_clients oc ON oc.guid_client = ro.guid_client
      CROSS JOIN LATERAL jsonb_array_elements(${RETAIL_OUTLETS_JSON.replaceAll("onec_clients", "oc")}) outlet(elem)
      ${scoped.whereSql.replaceAll("onec_clients.", "oc.")}
        AND ${outletStoreGuidSql("outlet.elem")} = lower(ro.guid_store::text)
        AND ${outletAssignedToRopClause(`$${ropParamIndex}`, "outlet.elem")}
    `,
    [...scoped.params, ropGuid.toLowerCase()],
  );
  return Number(result.rows[0]?.count ?? "0");
}

async function countParentClientsOfAssignedOutlets(context: AccessContext, ropGuid: string): Promise<number> {
  const scoped = scopedClientFilter(context, "oc");
  if (scoped.denied) {
    return 0;
  }
  const ropParamIndex = scoped.params.length + 1;
  const result = await query<{ count: string }>(
    `
      SELECT COUNT(DISTINCT oc.guid_client)::text AS count
      FROM onec_clients oc
      CROSS JOIN LATERAL jsonb_array_elements(${RETAIL_OUTLETS_JSON.replaceAll("onec_clients", "oc")}) outlet(elem)
      ${scoped.whereSql.replaceAll("onec_clients.", "oc.")}
        AND ${outletAssignedToRopClause(`$${ropParamIndex}`, "outlet.elem")}
        AND ${clientNotAssignedToRopClause(`$${ropParamIndex}`, "oc")}
    `,
    [...scoped.params, ropGuid.toLowerCase()],
  );
  return Number(result.rows[0]?.count ?? "0");
}

type TeamCountRow = {
  manager_count: string;
  regional_count: string;
  team_member_count: string;
};

async function countTeamMembersForRop(context: AccessContext, ropGuid: string): Promise<TeamCountRow> {
  const scoped = scopedClientFilter(context, "oc");
  if (scoped.denied) {
    return { manager_count: "0", regional_count: "0", team_member_count: "0" };
  }
  const ropLower = ropGuid.toLowerCase();
  const ropParamIndex = scoped.params.length + 1;
  const ropExcludeParamIndex = scoped.params.length + 2;
  const outletsJson = RETAIL_OUTLETS_JSON.replaceAll("onec_clients", "oc");
  const result = await query<TeamCountRow>(
    `
      WITH scoped_clients AS (
        SELECT oc.guid_client, oc.guid_manager, oc.name_manager, oc.extended_snapshot
        FROM onec_clients oc
        ${scoped.whereSql.replaceAll("onec_clients.", "oc.")}
      ),
      client_assigned AS (
        SELECT sc.*
        FROM scoped_clients sc
        WHERE ${clientAssignedToRopClause(`$${ropParamIndex}`, "sc")}
      ),
      client_managers AS (
        SELECT DISTINCT lower(guid_manager::text) AS employee_guid
        FROM client_assigned
        WHERE lower(guid_manager::text) IS NOT NULL
          AND lower(guid_manager::text) <> lower($${ropExcludeParamIndex}::text)
      ),
      client_regionals AS (
        SELECT DISTINCT ${clientRegionalGuidSql("client_assigned")} AS employee_guid
        FROM client_assigned
        WHERE ${clientRegionalGuidSql("client_assigned")} IS NOT NULL
          AND ${clientRegionalGuidSql("client_assigned")} <> lower($${ropExcludeParamIndex}::text)
      ),
      client_hardware AS (
        SELECT DISTINCT ${clientHardwareGuidSql("client_assigned")} AS employee_guid
        FROM client_assigned
        WHERE ${clientHardwareGuidSql("client_assigned")} IS NOT NULL
          AND ${clientHardwareGuidSql("client_assigned")} <> lower($${ropExcludeParamIndex}::text)
      ),
      outlet_rows AS (
        SELECT
          ${outletManagerGuidSql("outlet.elem")} AS manager_guid,
          ${outletRegionalGuidSql("outlet.elem")} AS regional_guid,
          ${outletHardwareGuidSql("outlet.elem")} AS hardware_guid
        FROM scoped_clients sc
        JOIN onec_clients oc ON oc.guid_client = sc.guid_client
        CROSS JOIN LATERAL jsonb_array_elements(${outletsJson}) outlet(elem)
        WHERE ${outletAssignedToRopClause(`$${ropParamIndex}`, "outlet.elem")}
      ),
      outlet_managers AS (
        SELECT DISTINCT manager_guid AS employee_guid
        FROM outlet_rows
        WHERE manager_guid IS NOT NULL
          AND manager_guid <> lower($${ropExcludeParamIndex}::text)
      ),
      outlet_regionals AS (
        SELECT DISTINCT regional_guid AS employee_guid
        FROM outlet_rows
        WHERE regional_guid IS NOT NULL
          AND regional_guid <> lower($${ropExcludeParamIndex}::text)
      ),
      outlet_hardware AS (
        SELECT DISTINCT hardware_guid AS employee_guid
        FROM outlet_rows
        WHERE hardware_guid IS NOT NULL
          AND hardware_guid <> lower($${ropExcludeParamIndex}::text)
      ),
      managers AS (
        SELECT employee_guid FROM client_managers
        UNION
        SELECT employee_guid FROM outlet_managers
      ),
      regionals AS (
        SELECT employee_guid FROM client_regionals
        UNION
        SELECT employee_guid FROM outlet_regionals
      ),
      hardware AS (
        SELECT employee_guid FROM client_hardware
        UNION
        SELECT employee_guid FROM outlet_hardware
      ),
      team_members AS (
        SELECT employee_guid FROM managers
        UNION
        SELECT employee_guid FROM regionals
        UNION
        SELECT employee_guid FROM hardware
      )
      SELECT
        (SELECT COUNT(*)::text FROM managers) AS manager_count,
        (SELECT COUNT(*)::text FROM regionals) AS regional_count,
        (SELECT COUNT(*)::text FROM team_members) AS team_member_count
    `,
    [...scoped.params, ropLower, ropLower],
  );
  return (
    result.rows[0] ?? { manager_count: "0", regional_count: "0", team_member_count: "0" }
  );
}

async function loadUndefinedTeamMembers(linked: Set<string>): Promise<OrgUndefinedTeamMember[]> {
  const outletsJson = RETAIL_OUTLETS_JSON.replaceAll("onec_clients", "oc");
  const result = await query<{ employee_guid: string; name: string; post: string | null }>(
    `
      SELECT
        lower(r.guid_manager::text) AS employee_guid,
        r.name_manager AS name,
        r.post
      FROM onec_wholesale_employee_roster r
      WHERE lower(r.guid_manager::text) <> $1
        AND r.post IS DISTINCT FROM $2
        AND NOT (
          EXISTS (
            SELECT 1 FROM onec_clients oc
            WHERE ${ACTIVE_BASELINE_OC_SQL.replaceAll("onec_clients.", "oc.")}
              AND (
                ${clientHeadOfSalesGuidSql("oc")} = lower(r.guid_manager::text)
                OR EXISTS (
                  SELECT 1
                  FROM jsonb_array_elements(${outletsJson}) outlet(elem)
                  WHERE ${outletHeadOfSalesGuidSql("outlet.elem")} = lower(r.guid_manager::text)
                )
              )
          )
          OR EXISTS (
            SELECT 1 FROM onec_clients oc
            WHERE ${ACTIVE_BASELINE_OC_SQL.replaceAll("onec_clients.", "oc.")}
              AND ${clientHeadOfSalesGuidSql("oc")} IS NOT NULL
              AND (
                lower(oc.guid_manager::text) = lower(r.guid_manager::text)
                OR ${clientRegionalGuidSql("oc")} = lower(r.guid_manager::text)
                OR ${clientHardwareGuidSql("oc")} = lower(r.guid_manager::text)
              )
          )
          OR EXISTS (
            SELECT 1 FROM onec_clients oc
            CROSS JOIN LATERAL jsonb_array_elements(${outletsJson}) outlet(elem)
            WHERE ${ACTIVE_BASELINE_OC_SQL.replaceAll("onec_clients.", "oc.")}
              AND ${outletHeadOfSalesGuidSql("outlet.elem")} IS NOT NULL
              AND (
                ${outletManagerGuidSql("outlet.elem")} = lower(r.guid_manager::text)
                OR ${outletRegionalGuidSql("outlet.elem")} = lower(r.guid_manager::text)
                OR ${outletHardwareGuidSql("outlet.elem")} = lower(r.guid_manager::text)
              )
          )
        )
      ORDER BY r.name_manager ASC, r.guid_manager ASC
    `,
    [ORG_DIRECTOR_EMPLOYEE_GUID, ROSTER_ROP_POST_LABEL],
  );
  return result.rows.map((row) => ({
    employeeGuid: row.employee_guid,
    name: row.name,
    shortId: shortUuidLabel(row.employee_guid),
    rosterPost: row.post,
    hasLinkedAccount: linked.has(row.employee_guid),
  }));
}

export async function getOrgStructureOverview(context: AccessContext): Promise<OrgStructureOverview> {
  assertOrgStructureAccess(context);
  const rosterLoaded = await loadRosterLoaded();
  const linked = await loadLinkedAccountGuids();
  const director = await loadDirectorSummary(linked);
  const candidates = await loadRopCandidates();

  let visibleRops = candidates;
  if (context.role === "rop" && context.employeeId) {
    const own = context.employeeId.toLowerCase();
    visibleRops = candidates.filter((row) => row.employee_guid === own);
  }

  const rops: OrgRopSummary[] = [];
  for (const row of visibleRops) {
    const clientCount = await countAssignedClients(context, row.employee_guid);
    const outletCount = await countAssignedOutlets(context, row.employee_guid);
    const parentClientCount = await countParentClientsOfAssignedOutlets(context, row.employee_guid);
    const teamCounts = await countTeamMembersForRop(context, row.employee_guid);
    const hasPortfolio = clientCount > 0 || outletCount > 0;
    rops.push({
      employeeGuid: row.employee_guid,
      name: row.name || shortUuidLabel(row.employee_guid),
      shortId: shortUuidLabel(row.employee_guid),
      rosterPost: row.roster_post,
      hasLinkedAccount: linked.has(row.employee_guid),
      hasAssignedPortfolio: hasPortfolio,
      portfolioNote: hasPortfolio ? null : "Нет назначенного портфеля",
      managerCount: Number(teamCounts.manager_count),
      regionalCount: Number(teamCounts.regional_count),
      teamMemberCount: Number(teamCounts.team_member_count),
      uniqueClientCount: clientCount,
      uniqueOutletCount: outletCount,
      parentClientCount,
      sources: [
        ...(row.from_roster ? (["roster"] as const) : []),
        ...(row.from_assignment ? (["assignment"] as const) : []),
      ],
    });
  }

  const undefinedTeam =
    context.role === "admin" || context.fullClientBase
      ? await loadUndefinedTeamMembers(linked)
      : [];

  return {
    director: context.role === "admin" || context.fullClientBase ? director : null,
    rops,
    undefinedTeam,
    rosterLoaded,
    limitationNote: rosterLoaded
      ? "Структура построена по назначениям 1С и справочнику ОПТ. Отсутствие аккаунта ЛК не скрывает сотрудника."
      : "Справочник ОПТ не загружен: часть признаков roster недоступна, назначения 1С показываются по имеющимся данным.",
  };
}

export async function listOrgRopResponsibles(
  context: AccessContext,
  ropEmployeeGuid: string,
): Promise<OrgResponsibleSummary[]> {
  assertOrgStructureAccess(context);
  if (context.role === "rop" && context.employeeId?.toLowerCase() !== ropEmployeeGuid.toLowerCase()) {
    throw new OrgStructureAccessError("Нет доступа к ветке РОП.", "FORBIDDEN");
  }

  const scoped = scopedClientFilter(context, "oc");
  if (scoped.denied) {
    return [];
  }

  const linked = await loadLinkedAccountGuids();
  const rosterRows = await query<{ guid_manager: string; name_manager: string }>(
    `SELECT guid_manager::text, name_manager FROM onec_wholesale_employee_roster`,
  );
  const rosterNames = new Map(
    rosterRows.rows.map((row) => [row.guid_manager.toLowerCase(), row.name_manager]),
  );

  const ropLower = ropEmployeeGuid.toLowerCase();
  const ropParamIndex = scoped.params.length + 1;
  const ropExcludeParamIndex = scoped.params.length + 2;
  const outletsJson = RETAIL_OUTLETS_JSON.replaceAll("onec_clients", "oc");
  const rows = await query<{
    kind: "manager" | "regional" | "hardware";
    employee_guid: string;
    name: string | null;
    client_count: string;
    outlet_count: string;
  }>(
    `
      WITH scoped_clients AS (
        SELECT oc.guid_client, oc.guid_manager, oc.name_manager, oc.extended_snapshot
        FROM onec_clients oc
        ${scoped.whereSql.replaceAll("onec_clients.", "oc.")}
      ),
      client_assigned AS (
        SELECT sc.*
        FROM scoped_clients sc
        WHERE ${clientAssignedToRopClause(`$${ropParamIndex}`, "sc")}
      ),
      client_managers AS (
        SELECT
          'manager'::text AS kind,
          lower(guid_manager::text) AS employee_guid,
          MAX(name_manager) AS name,
          COUNT(DISTINCT guid_client)::text AS client_count,
          '0'::text AS outlet_count
        FROM client_assigned
        WHERE lower(guid_manager::text) IS NOT NULL
          AND lower(guid_manager::text) <> lower($${ropExcludeParamIndex}::text)
        GROUP BY lower(guid_manager::text)
      ),
      client_regionals AS (
        SELECT
          'regional'::text AS kind,
          ${clientRegionalGuidSql("client_assigned")} AS employee_guid,
          MAX(NULLIF(BTRIM(client_assigned.extended_snapshot->'regionalManager'->>'name'), '')) AS name,
          COUNT(DISTINCT guid_client)::text AS client_count,
          '0'::text AS outlet_count
        FROM client_assigned
        WHERE ${clientRegionalGuidSql("client_assigned")} IS NOT NULL
          AND ${clientRegionalGuidSql("client_assigned")} <> lower($${ropExcludeParamIndex}::text)
        GROUP BY ${clientRegionalGuidSql("client_assigned")}
      ),
      client_hardware AS (
        SELECT
          'hardware'::text AS kind,
          ${clientHardwareGuidSql("client_assigned")} AS employee_guid,
          MAX(NULLIF(BTRIM(client_assigned.extended_snapshot->'hardwareManager'->>'name'), '')) AS name,
          COUNT(DISTINCT guid_client)::text AS client_count,
          '0'::text AS outlet_count
        FROM client_assigned
        WHERE ${clientHardwareGuidSql("client_assigned")} IS NOT NULL
          AND ${clientHardwareGuidSql("client_assigned")} <> lower($${ropExcludeParamIndex}::text)
        GROUP BY ${clientHardwareGuidSql("client_assigned")}
      ),
      outlet_managers AS (
        SELECT
          'manager'::text AS kind,
          ${outletManagerGuidSql("outlet.elem")} AS employee_guid,
          MAX(NULLIF(BTRIM(outlet.elem->'managers'->'manager'->>'name'), '')) AS name,
          '0'::text AS client_count,
          COUNT(*)::text AS outlet_count
        FROM scoped_clients sc
        JOIN onec_clients oc ON oc.guid_client = sc.guid_client
        CROSS JOIN LATERAL jsonb_array_elements(${outletsJson}) outlet(elem)
        WHERE ${outletAssignedToRopClause(`$${ropParamIndex}`, "outlet.elem")}
          AND ${outletManagerGuidSql("outlet.elem")} IS NOT NULL
          AND ${outletManagerGuidSql("outlet.elem")} <> lower($${ropExcludeParamIndex}::text)
        GROUP BY ${outletManagerGuidSql("outlet.elem")}
      ),
      outlet_regionals AS (
        SELECT
          'regional'::text AS kind,
          ${outletRegionalGuidSql("outlet.elem")} AS employee_guid,
          MAX(NULLIF(BTRIM(outlet.elem->'managers'->'regionalManager'->>'name'), '')) AS name,
          '0'::text AS client_count,
          COUNT(*)::text AS outlet_count
        FROM scoped_clients sc
        JOIN onec_clients oc ON oc.guid_client = sc.guid_client
        CROSS JOIN LATERAL jsonb_array_elements(${outletsJson}) outlet(elem)
        WHERE ${outletAssignedToRopClause(`$${ropParamIndex}`, "outlet.elem")}
          AND ${outletRegionalGuidSql("outlet.elem")} IS NOT NULL
          AND ${outletRegionalGuidSql("outlet.elem")} <> lower($${ropExcludeParamIndex}::text)
        GROUP BY ${outletRegionalGuidSql("outlet.elem")}
      ),
      outlet_hardware AS (
        SELECT
          'hardware'::text AS kind,
          ${outletHardwareGuidSql("outlet.elem")} AS employee_guid,
          MAX(NULLIF(BTRIM(outlet.elem->'managers'->'hardwareManager'->>'name'), '')) AS name,
          '0'::text AS client_count,
          COUNT(*)::text AS outlet_count
        FROM scoped_clients sc
        JOIN onec_clients oc ON oc.guid_client = sc.guid_client
        CROSS JOIN LATERAL jsonb_array_elements(${outletsJson}) outlet(elem)
        WHERE ${outletAssignedToRopClause(`$${ropParamIndex}`, "outlet.elem")}
          AND ${outletHardwareGuidSql("outlet.elem")} IS NOT NULL
          AND ${outletHardwareGuidSql("outlet.elem")} <> lower($${ropExcludeParamIndex}::text)
        GROUP BY ${outletHardwareGuidSql("outlet.elem")}
      )
      SELECT kind, employee_guid, name, client_count, outlet_count FROM client_managers
      UNION ALL
      SELECT kind, employee_guid, name, client_count, outlet_count FROM client_regionals
      UNION ALL
      SELECT kind, employee_guid, name, client_count, outlet_count FROM client_hardware
      UNION ALL
      SELECT kind, employee_guid, name, client_count, outlet_count FROM outlet_managers
      UNION ALL
      SELECT kind, employee_guid, name, client_count, outlet_count FROM outlet_regionals
      UNION ALL
      SELECT kind, employee_guid, name, client_count, outlet_count FROM outlet_hardware
      ORDER BY kind ASC, name ASC NULLS LAST, employee_guid ASC
    `,
    [...scoped.params, ropLower, ropLower],
  );

  const merged = new Map<string, OrgResponsibleSummary>();
  for (const row of rows.rows) {
    const key = `${row.kind}:${row.employee_guid}`;
    const existing = merged.get(key);
    const name = row.name ?? rosterNames.get(row.employee_guid) ?? row.employee_guid.slice(0, 8).toUpperCase();
    if (!existing) {
      merged.set(key, {
        kind: row.kind,
        employeeGuid: row.employee_guid,
        name,
        shortId: shortUuidLabel(row.employee_guid),
        hasLinkedAccount: linked.has(row.employee_guid),
        rosterInOpt: rosterNames.has(row.employee_guid),
        clientCount: Number(row.client_count),
        outletCount: Number(row.outlet_count),
      });
    } else {
      existing.clientCount += Number(row.client_count);
      existing.outletCount += Number(row.outlet_count);
      if (!existing.name && name) {
        existing.name = name;
      }
    }
  }
  return [...merged.values()];
}
