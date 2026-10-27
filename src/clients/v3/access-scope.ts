import type { AccessContext } from "../../access/types";
import { ropLegacyTeamEmployeesSubquery } from "../../access/rop-read-scope";
import { v3JsonManagerField } from "./json-paths";

export type V3ScopeSql = { clause: string; params: unknown[] };

/** Deny-all and employee-link gates first — aligned with existing access policy ordering. */
export function v3BaseAccessGate(context: AccessContext): V3ScopeSql | null {
  if (context.explicitlyDeniedAll) {
    return { clause: "FALSE", params: [] };
  }
  if (context.fullClientBase) {
    return null;
  }
  if (context.employeeLinkConflict || !context.hasEmployeeLink) {
    return { clause: "FALSE", params: [] };
  }
  if (!context.hasScopedClientAccess) {
    return { clause: "FALSE", params: [] };
  }
  return null;
}

function managerAssignmentClause(alias: string, employeeParam: string): string {
  return `NULLIF(TRIM(COALESCE(${v3JsonManagerField(alias, "guidManager")}, '')), '')::uuid = ${employeeParam}::uuid`;
}

function regionalAssignmentClause(alias: string, employeeParam: string): string {
  return `NULLIF(TRIM(COALESCE(${v3JsonManagerField(alias, "guidRegionalManager")}, '')), '')::uuid = ${employeeParam}::uuid`;
}

function hardwareAssignmentClause(alias: string, employeeParam: string): string {
  return `NULLIF(TRIM(COALESCE(${v3JsonManagerField(alias, "guidHardwareManager")}, '')), '')::uuid = ${employeeParam}::uuid`;
}

/** ROP-readable employee GUIDs: legacy linked team + wholesale org memberships for teams led by this ROP. */
function v3RopTeamEmployeeGuidsSubquery(ropUserParam: string, ropEmployeeParam: string): string {
  const legacy = ropLegacyTeamEmployeesSubquery(ropUserParam, ropEmployeeParam);
  return `
    SELECT employee_guid::uuid FROM (
      ${legacy}
      UNION
      SELECT m.guid_manager AS employee_guid
      FROM onec_wholesale_team_groups g
      JOIN onec_wholesale_employee_team_memberships m ON m.guid_team = g.guid_team
      WHERE lower(g.guid_team_leader::text) = lower(${ropEmployeeParam}::text)
        AND lower(m.guid_manager::text) <> lower(${ropEmployeeParam}::text)
    ) scoped
    WHERE employee_guid IS NOT NULL
  `;
}

function v3RopTeamAssignmentScopeClause(alias: string, teamEmployeesSubquery: string): string {
  return `(
    NULLIF(TRIM(COALESCE(${v3JsonManagerField(alias, "guidManager")}, '')), '')::uuid IN (${teamEmployeesSubquery})
    OR NULLIF(TRIM(COALESCE(${v3JsonManagerField(alias, "guidRegionalManager")}, '')), '')::uuid IN (${teamEmployeesSubquery})
    OR NULLIF(TRIM(COALESCE(${v3JsonManagerField(alias, "guidHardwareManager")}, '')), '')::uuid IN (${teamEmployeesSubquery})
  )`;
}

function appendObjectDenials(
  innerClause: string,
  params: unknown[],
  context: AccessContext,
  objectGuidSql: string,
): V3ScopeSql {
  const userParam = params.length + 1;
  const denial = `NOT EXISTS (
    SELECT 1
    FROM access_denials ad
    WHERE ad.user_id = $${userParam}::uuid
      AND ad.revoked_at IS NULL
      AND (
        ad.scope_type = 'all_clients'
        OR ad.object_id = ${objectGuidSql}
      )
  )`;
  return {
    clause: `(${innerClause}) AND (${denial})`,
    params: [...params, context.userId],
  };
}

function v3GrantClause(alias: string, objectGuidSql: string, userParam: string): string {
  return `EXISTS (
    SELECT 1
    FROM access_grants g
    WHERE g.user_id = ${userParam}::uuid
      AND g.grant_type = 'client'
      AND g.revoked_at IS NULL
      AND g.object_id = ${objectGuidSql}
  )`;
}

/** Active approved delegation row for assistant (no per-client checks). */
export function v3ActiveDelegationRowSql(delegationAlias: string, assistantUserParam: string): string {
  return `${delegationAlias}.assistant_user_id = ${assistantUserParam}::uuid
      AND ${delegationAlias}.status = 'active'
      AND ${delegationAlias}.approved_by_user_id IS NOT NULL
      AND ${delegationAlias}.revoked_at IS NULL
      AND ${delegationAlias}.starts_at <= NOW()
      AND ${delegationAlias}.ends_at > NOW()
      AND NOT EXISTS (
        SELECT 1
        FROM delegation_change_requests dcr
        WHERE dcr.delegation_id = ${delegationAlias}.id
          AND dcr.status = 'pending_approval'
      )
      AND EXISTS (
        SELECT 1
        FROM user_onec_employee_links uoel
        JOIN users delegator ON delegator.id = ${delegationAlias}.delegator_user_id
        WHERE uoel.user_id = ${delegationAlias}.delegator_user_id
          AND uoel.revoked_at IS NULL
          AND delegator.status = 'active'
          AND delegator.role IN ('manager', 'rop')
      )`;
}

/** Delegator and assistant denials for one client guid under a specific delegation row. */
export function v3DelegationClientGrantDenialsSql(
  delegationAlias: string,
  clientGuidSql: string,
  assistantUserParam: string,
): string {
  return `NOT EXISTS (
        SELECT 1
        FROM access_denials ad
        WHERE ad.user_id = ${delegationAlias}.delegator_user_id
          AND ad.revoked_at IS NULL
          AND (
            ad.scope_type = 'all_clients'
            OR ad.object_id = ${clientGuidSql}
          )
      )
      AND NOT EXISTS (
        SELECT 1
        FROM access_denials ad
        WHERE ad.user_id = ${assistantUserParam}::uuid
          AND ad.revoked_at IS NULL
          AND (
            ad.scope_type = 'all_clients'
            OR ad.object_id = ${clientGuidSql}
          )
      )`;
}

/** Client guid is assigned to this delegation and both sides may access it. */
export function v3DelegationClientGrantSql(
  delegationAlias: string,
  clientGuidSql: string,
  assistantUserParam: string,
): string {
  return `EXISTS (
    SELECT 1
    FROM delegation_clients dc
    WHERE dc.delegation_id = ${delegationAlias}.id
      AND dc.guid_client = ${clientGuidSql}
      AND EXISTS (
        SELECT 1 FROM onec_v3_legal_entities owned
        JOIN user_onec_employee_links owner_link
          ON owner_link.user_id=${delegationAlias}.delegator_user_id AND owner_link.revoked_at IS NULL
        WHERE owned.guid_client=dc.guid_client
          AND lower(${v3JsonManagerField("owned", "guidManager")})=lower(owner_link.employee_id::text)
      )
      AND ${v3DelegationClientGrantDenialsSql(delegationAlias, clientGuidSql, assistantUserParam)}
  )`;
}

function v3AssistantDelegationClause(alias: string, objectGuidSql: string, userParam: string, kind: V3EntityKind = "legal"): string {
  if (kind === "retail") {
    return `EXISTS (
      SELECT 1 FROM delegations d
      JOIN user_onec_employee_links owner_link ON owner_link.user_id=d.delegator_user_id AND owner_link.revoked_at IS NULL
      WHERE ${v3ActiveDelegationRowSql("d", userParam)}
        AND ${managerAssignmentClause(alias, "owner_link.employee_id")}
        AND (
          EXISTS(SELECT 1 FROM delegation_clients dc WHERE dc.delegation_id=d.id AND dc.guid_client=${objectGuidSql})
          OR EXISTS(SELECT 1 FROM onec_v3_legal_entities assigned_le
            WHERE assigned_le.guid_holding=${alias}.guid_holding
              AND ${v3DelegationClientGrantSql("d", "assigned_le.guid_client", userParam)})
        )
        AND ${v3DelegationClientGrantDenialsSql("d", objectGuidSql, userParam)}
    )`;
  }
  return `EXISTS (
    SELECT 1
    FROM delegations d
    WHERE ${v3ActiveDelegationRowSql("d", userParam)}
      AND ${v3DelegationClientGrantSql("d", objectGuidSql, userParam)}
  )`;
}

export type V3EntityKind = "legal" | "retail" | "holding";

function objectGuidColumn(alias: string, kind: V3EntityKind): string {
  if (kind === "legal") {
    return `${alias}.guid_client`;
  }
  if (kind === "retail") {
    return `${alias}.guid_store`;
  }
  return `${alias}.guid_holding`;
}

/** Legal entity, retail outlet, or holding row visibility from v3 assignment JSON and access matrix. */
export function v3EntityAssignmentScope(
  context: AccessContext,
  alias: string,
  kind: V3EntityKind = "legal",
): V3ScopeSql {
  const gate = v3BaseAccessGate(context);
  if (gate) {
    return gate;
  }

  const objectGuid = objectGuidColumn(alias, kind);

  if (context.fullClientBase) {
    return appendObjectDenials("TRUE", [], context, objectGuid);
  }

  const employeeId = context.employeeId!;
  const userId = context.userId;

  let base: V3ScopeSql;
  switch (context.role) {
    case "manager":
      base = {
        clause: managerAssignmentClause(alias, "$1"),
        params: [employeeId],
      };
      break;
    case "regional_manager":
      base = {
        clause: `(${regionalAssignmentClause(alias, "$1")} OR ${v3GrantClause(alias, objectGuid, "$2")})`,
        params: [employeeId, userId],
      };
      break;
    case "rop": {
      const teamEmployees = v3RopTeamEmployeeGuidsSubquery("$1", "$2");
      base = {
        clause: v3RopTeamAssignmentScopeClause(alias, teamEmployees),
        params: [userId, employeeId],
      };
      break;
    }
    case "assistant":
      base = {
        clause: v3AssistantDelegationClause(alias, objectGuid, "$1", kind),
        params: [userId],
      };
      break;
    default:
      return { clause: "FALSE", params: [] };
  }

  return appendObjectDenials(base.clause, base.params, context, objectGuid);
}

/** Holding visible when at least one legal or retail member is visible under the same rules. */
export function v3HoldingVisibilityScope(context: AccessContext, holdingAlias: string): V3ScopeSql {
  const gate = v3BaseAccessGate(context);
  if (gate) {
    return gate;
  }

  if (context.fullClientBase) {
    return appendObjectDenials("TRUE", [], context, `${holdingAlias}.guid_holding`);
  }

  const legalScope = v3EntityAssignmentScope(context, "le", "legal");
  const retailScope = v3EntityAssignmentScope(context, "ro", "retail");
  const params = [...legalScope.params];
  let retailClause = retailScope.clause;
  if (retailScope.params.length > 0) {
    const offset = legalScope.params.length;
    retailClause = retailClause.replace(/\$(\d+)/g, (_m, index) => `$${Number(index) + offset}`);
    params.push(...retailScope.params);
  }

  const visibility = {
    clause: `EXISTS (
      SELECT 1 FROM onec_v3_legal_entities le
      WHERE le.guid_holding = ${holdingAlias}.guid_holding AND (${legalScope.clause})
    ) OR EXISTS (
      SELECT 1 FROM onec_v3_retail_outlets ro
      WHERE ro.guid_holding = ${holdingAlias}.guid_holding AND (${retailClause})
    )`,
    params,
  };

  return appendObjectDenials(visibility.clause, visibility.params, context, `${holdingAlias}.guid_holding`);
}

/** Members returned inside an accessible holding — same assignment/denial rules, no hidden neighbors. */
export function v3HoldingMemberLegalScope(context: AccessContext, legalAlias: string): V3ScopeSql {
  return v3EntityAssignmentScope(context, legalAlias, "legal");
}

export function v3HoldingMemberRetailScope(context: AccessContext, retailAlias: string): V3ScopeSql {
  return v3EntityAssignmentScope(context, retailAlias, "retail");
}
