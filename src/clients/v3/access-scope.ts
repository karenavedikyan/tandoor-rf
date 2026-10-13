import type { AccessContext } from "../../access/types";
import { ropLegacyTeamEmployeesSubquery } from "../../access/rop-read-scope";

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
  return `(${alias}.managers->>'guidManager')::uuid = ${employeeParam}::uuid`;
}

function regionalAssignmentClause(alias: string, employeeParam: string): string {
  return `(${alias}.managers->>'guidRegionalManager')::uuid = ${employeeParam}::uuid`;
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

function v3AssistantDelegationClause(alias: string, objectGuidSql: string, userParam: string): string {
  return `EXISTS (
    SELECT 1
    FROM delegations d
    JOIN delegation_clients dc ON dc.delegation_id = d.id
    WHERE d.assistant_user_id = ${userParam}::uuid
      AND d.status = 'active'
      AND d.approved_by_user_id IS NOT NULL
      AND d.revoked_at IS NULL
      AND d.starts_at <= NOW()
      AND d.ends_at > NOW()
      AND dc.guid_client = ${objectGuidSql}
      AND NOT EXISTS (
        SELECT 1
        FROM delegation_change_requests dcr
        WHERE dcr.delegation_id = d.id
          AND dcr.status = 'pending_approval'
      )
      AND EXISTS (
        SELECT 1
        FROM user_onec_employee_links uoel
        JOIN users delegator ON delegator.id = d.delegator_user_id
        WHERE uoel.user_id = d.delegator_user_id
          AND uoel.revoked_at IS NULL
          AND delegator.status = 'active'
          AND delegator.role IN ('manager', 'rop')
          AND NOT EXISTS (
            SELECT 1
            FROM access_denials ad
            WHERE ad.user_id = d.delegator_user_id
              AND ad.revoked_at IS NULL
              AND (
                ad.scope_type = 'all_clients'
                OR ad.object_id = ${objectGuidSql}
              )
          )
      )
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
      const teamEmployees = ropLegacyTeamEmployeesSubquery("$1", "$2");
      base = {
        clause: `(${alias}.managers->>'guidManager')::uuid IN (${teamEmployees})`,
        params: [userId, employeeId],
      };
      break;
    }
    case "assistant":
      base = {
        clause: v3AssistantDelegationClause(alias, objectGuid, "$1"),
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
