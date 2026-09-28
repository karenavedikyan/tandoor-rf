import type { AccessContext } from "./types";
import type { ClientScopeSql } from "./types";

const DENY_SCOPE: ClientScopeSql = {
  whereSql: "WHERE FALSE",
  params: [],
};

function scopedWhere(innerSql: string, params: unknown[]): ClientScopeSql {
  return {
    whereSql: `WHERE onec_clients.guid_client IN (${innerSql})`,
    params,
  };
}

export function buildClientScopeSql(context: AccessContext): ClientScopeSql {
  if (context.fullClientBase) {
    return { whereSql: "", params: [] };
  }

  if (!context.hasScopedClientAccess || context.employeeLinkConflict) {
    return DENY_SCOPE;
  }

  const userParam = context.userId;

  switch (context.role) {
    case "manager": {
      if (!context.employeeId) {
        return DENY_SCOPE;
      }
      return scopedWhere(
        `
          SELECT guid_client
          FROM onec_clients
          WHERE guid_manager = $1::uuid
        `,
        [context.employeeId],
      );
    }

    case "rop": {
      if (!context.employeeId) {
        return DENY_SCOPE;
      }
      return scopedWhere(
        `
          SELECT oc.guid_client
          FROM onec_clients oc
          WHERE oc.guid_manager IN (
            SELECT uoel.employee_id
            FROM rop_team_members rtm
            JOIN user_onec_employee_links uoel
              ON uoel.user_id = rtm.member_user_id AND uoel.revoked_at IS NULL
            WHERE rtm.rop_user_id = $1::uuid AND rtm.revoked_at IS NULL
            UNION
            SELECT $2::uuid
          )
        `,
        [userParam, context.employeeId],
      );
    }

    case "regional_manager":
      return scopedWhere(
        `
          SELECT object_id AS guid_client
          FROM access_grants
          WHERE user_id = $1::uuid
            AND grant_type = 'client'
            AND revoked_at IS NULL
        `,
        [userParam],
      );

    case "assistant":
      return scopedWhere(
        `
          SELECT dc.guid_client
          FROM delegations d
          JOIN delegation_clients dc ON dc.delegation_id = d.id
          WHERE d.assistant_user_id = $1::uuid
            AND d.status = 'active'
            AND d.approved_by_user_id IS NOT NULL
            AND d.revoked_at IS NULL
            AND d.starts_at <= NOW()
            AND d.ends_at > NOW()
            AND EXISTS (
              SELECT 1
              FROM onec_clients oc
              JOIN user_onec_employee_links uoel
                ON uoel.user_id = d.delegator_user_id AND uoel.revoked_at IS NULL
              WHERE oc.guid_client = dc.guid_client
                AND oc.guid_manager = uoel.employee_id
            )
        `,
        [userParam],
      );

    default:
      return DENY_SCOPE;
  }
}

export function mergeScopeWithFilter(
  scope: ClientScopeSql,
  filterWhereSql: string,
  filterParams: unknown[],
): ClientScopeSql {
  if (scope.whereSql === "WHERE FALSE") {
    return scope;
  }

  const scopeOffset = filterParams.length;
  const scopeParams = scope.params.map((_, index) => `$${scopeOffset + index + 1}`);
  const scopeInner = scope.whereSql.replace(/^WHERE onec_clients\.guid_client IN \(/, "").replace(/\)$/, "");
  const rebasedInner = scopeInner.replace(/\$(\d+)/g, (_match, num) => `$${scopeOffset + Number(num)}`);

  const filterClause = filterWhereSql.startsWith("WHERE ")
    ? filterWhereSql.slice(7)
    : filterWhereSql;

  if (!scope.whereSql) {
    return {
      whereSql: filterWhereSql,
      params: filterParams,
    };
  }

  if (!filterClause) {
    return scope;
  }

  return {
    whereSql: `WHERE onec_clients.guid_client IN (${rebasedInner}) AND (${filterClause})`,
    params: [...filterParams, ...scope.params],
  };
}
