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
  clientHeadOfSalesGuidSql,
  clientHeadOfSalesNameSql,
  outletHeadOfSalesGuidSql,
  outletManagerGuidSql,
  outletRegionalGuidSql,
  ropPortfolioClause,
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
  managerCount: number;
  regionalCount: number;
  uniqueClientCount: number;
  uniqueOutletCount: number;
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
  if (context.role === "admin" || context.fullClientBase) {
    return;
  }
  if (context.role === "rop" && context.employeeId) {
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

async function loadLinkedAccountGuids(): Promise<Set<string>> {
  const result = await query<{ employee_id: string }>(
    `SELECT employee_id::text FROM user_onec_employee_links WHERE revoked_at IS NULL`,
  );
  return new Set(result.rows.map((row) => row.employee_id.toLowerCase()));
}

async function loadDirectorSummary(linked: Set<string>): Promise<OrgDirectorSummary | null> {
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

async function countScopedClients(context: AccessContext, extraWhere: string, params: unknown[]): Promise<number> {
  const scope = buildClientScopeSql(context);
  const filter = combineScopeAndFilter(scope, {
    whereSql: extraWhere ? `WHERE ${extraWhere}` : "",
    params,
  });
  if (filter.whereSql === "WHERE FALSE") {
    return 0;
  }
  const result = await query<{ count: string }>(
    `SELECT COUNT(DISTINCT onec_clients.guid_client)::text AS count FROM onec_clients ${filter.whereSql}`,
    filter.params,
  );
  return Number(result.rows[0]?.count ?? "0");
}

async function countScopedOutlets(context: AccessContext, ropGuid: string): Promise<number> {
  const scope = buildClientScopeSql(context);
  const filter = combineScopeAndFilter(scope, {
    whereSql: `WHERE ${ropPortfolioClause("$1")}`,
    params: [ropGuid],
  });
  if (filter.whereSql === "WHERE FALSE") {
    return 0;
  }
  const result = await query<{ count: string }>(
    `
      SELECT COUNT(*)::text AS count
      FROM onec_retail_outlets ro
      JOIN onec_clients oc ON oc.guid_client = ro.guid_client
      ${filter.whereSql.replaceAll("onec_clients.", "oc.")}
    `,
    filter.params,
  );
  return Number(result.rows[0]?.count ?? "0");
}

async function countManagersForRop(context: AccessContext, ropGuid: string): Promise<number> {
  const result = await query<{ count: string }>(
    `
      WITH scoped AS (
        SELECT oc.guid_client, oc.guid_manager, oc.extended_snapshot
        FROM onec_clients oc
        WHERE ${ACTIVE_BASELINE_OC_SQL.replaceAll("onec_clients.", "oc.")}
          AND ${ropPortfolioClause("$1", "oc")}
      ),
      client_mgr AS (
        SELECT DISTINCT lower(guid_manager::text) AS guid FROM scoped
      ),
      outlet_mgr AS (
        SELECT DISTINCT ${outletHeadOfSalesGuidSql("outlet.elem")} AS rop_guid,
               NULLIF(BTRIM(lower(outlet.elem->'managers'->'manager'->>'guid')), '') AS guid
        FROM scoped s
        JOIN onec_clients oc ON oc.guid_client = s.guid_client
        CROSS JOIN LATERAL jsonb_array_elements(${RETAIL_OUTLETS_JSON.replaceAll("onec_clients", "oc")}) outlet(elem)
        WHERE ${outletHeadOfSalesGuidSql("outlet.elem")} = lower($1::text)
      )
      SELECT COUNT(DISTINCT guid)::text AS count
      FROM (
        SELECT guid FROM client_mgr WHERE guid IS NOT NULL
        UNION
        SELECT guid FROM outlet_mgr WHERE guid IS NOT NULL
      ) all_mgr
    `,
    [ropGuid],
  );
  return Number(result.rows[0]?.count ?? "0");
}

async function countRegionalsForRop(context: AccessContext, ropGuid: string): Promise<number> {
  const result = await query<{ count: string }>(
    `
      SELECT COUNT(DISTINCT NULLIF(BTRIM(lower(outlet.elem->'managers'->'regionalManager'->>'guid')), ''))::text AS count
      FROM onec_clients oc
      CROSS JOIN LATERAL jsonb_array_elements(${RETAIL_OUTLETS_JSON.replaceAll("onec_clients", "oc")}) outlet(elem)
      WHERE ${ACTIVE_BASELINE_OC_SQL.replaceAll("onec_clients.", "oc.")}
        AND ${outletHeadOfSalesGuidSql("outlet.elem")} = lower($1::text)
    `,
    [ropGuid],
  );
  return Number(result.rows[0]?.count ?? "0");
}

async function loadUndefinedTeamMembers(linked: Set<string>): Promise<OrgUndefinedTeamMember[]> {
  const result = await query<{ employee_guid: string; name: string; post: string | null }>(
    `
      SELECT
        lower(r.guid_manager::text) AS employee_guid,
        r.name_manager AS name,
        r.post
      FROM onec_wholesale_employee_roster r
      WHERE lower(r.guid_manager::text) <> $1
        AND NOT (
          r.post = $2
          OR EXISTS (
            SELECT 1 FROM onec_clients oc
            WHERE ${ACTIVE_BASELINE_OC_SQL.replaceAll("onec_clients.", "oc.")}
              AND (
                ${clientHeadOfSalesGuidSql("oc")} = lower(r.guid_manager::text)
                OR EXISTS (
                  SELECT 1
                  FROM jsonb_array_elements(${RETAIL_OUTLETS_JSON.replaceAll("onec_clients", "oc")}) outlet(elem)
                  WHERE ${outletHeadOfSalesGuidSql("outlet.elem")} = lower(r.guid_manager::text)
                )
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
    const clientCount = await countScopedClients(context, ropPortfolioClause("$1"), [row.employee_guid]);
    const outletCount = await countScopedOutlets(context, row.employee_guid);
    const hasPortfolio = clientCount > 0 || outletCount > 0;
    rops.push({
      employeeGuid: row.employee_guid,
      name: row.name || shortUuidLabel(row.employee_guid),
      shortId: shortUuidLabel(row.employee_guid),
      rosterPost: row.roster_post,
      hasLinkedAccount: linked.has(row.employee_guid),
      hasAssignedPortfolio: hasPortfolio,
      portfolioNote: hasPortfolio ? null : "Нет назначенного портфеля",
      managerCount: await countManagersForRop(context, row.employee_guid),
      regionalCount: await countRegionalsForRop(context, row.employee_guid),
      uniqueClientCount: clientCount,
      uniqueOutletCount: outletCount,
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

  const linked = await loadLinkedAccountGuids();
  const rosterRows = await query<{ guid_manager: string; name_manager: string }>(
    `SELECT guid_manager::text, name_manager FROM onec_wholesale_employee_roster`,
  );
  const rosterNames = new Map(
    rosterRows.rows.map((row) => [row.guid_manager.toLowerCase(), row.name_manager]),
  );

  const rows = await query<{
    kind: "manager" | "regional";
    employee_guid: string;
    name: string | null;
    client_count: string;
    outlet_count: string;
  }>(
    `
      WITH scoped_clients AS (
        SELECT oc.guid_client, oc.guid_manager, oc.name_manager, oc.extended_snapshot
        FROM onec_clients oc
        WHERE ${ACTIVE_BASELINE_OC_SQL.replaceAll("onec_clients.", "oc.")}
          AND ${ropPortfolioClause("$1", "oc")}
      ),
      client_managers AS (
        SELECT
          'manager'::text AS kind,
          lower(guid_manager::text) AS employee_guid,
          MAX(name_manager) AS name,
          COUNT(DISTINCT guid_client)::text AS client_count,
          '0'::text AS outlet_count
        FROM scoped_clients
        GROUP BY lower(guid_manager::text)
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
        CROSS JOIN LATERAL jsonb_array_elements(${RETAIL_OUTLETS_JSON.replaceAll("onec_clients", "oc")}) outlet(elem)
        WHERE ${outletHeadOfSalesGuidSql("outlet.elem")} = lower($1::text)
          AND ${outletManagerGuidSql("outlet.elem")} IS NOT NULL
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
        CROSS JOIN LATERAL jsonb_array_elements(${RETAIL_OUTLETS_JSON.replaceAll("onec_clients", "oc")}) outlet(elem)
        WHERE ${outletHeadOfSalesGuidSql("outlet.elem")} = lower($1::text)
          AND ${outletRegionalGuidSql("outlet.elem")} IS NOT NULL
        GROUP BY ${outletRegionalGuidSql("outlet.elem")}
      ),
      outlet_responsibles AS (
        SELECT * FROM outlet_managers
        UNION ALL
        SELECT * FROM outlet_regionals
      )
      SELECT kind, employee_guid, name, client_count, outlet_count
      FROM client_managers
      WHERE employee_guid IS NOT NULL
      UNION ALL
      SELECT kind, employee_guid, name, client_count, outlet_count
      FROM outlet_responsibles
      WHERE employee_guid IS NOT NULL
      ORDER BY kind ASC, name ASC NULLS LAST, employee_guid ASC
    `,
    [ropEmployeeGuid.toLowerCase()],
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
