import {
  ACTIVE_BASELINE_CLIENT_SQL,
  ACTIVE_BASELINE_OC_SQL,
  appendActiveBaselineFilter,
} from "../onec-clients/baseline-active-scope";
import {
  managerDirectClientListClause,
  managerFullClientReadClause,
} from "../clients/org/assignment-sql";
import { ropDirectClientListClause, ropFullClientReadClause } from "./rop-read-scope";
import { MANAGER_ROSTER_SCOPE_ALLOWED_SQL } from "../onec-clients/manager-status";
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

export function appendUserDenials(scope: ClientScopeSql, userId: string): ClientScopeSql {
  if (scope.whereSql === "WHERE FALSE") {
    return scope;
  }

  const userParam = scope.params.length + 1;
  const denialClause = `NOT EXISTS (
    SELECT 1
    FROM access_denials ad
    WHERE ad.user_id = $${userParam}::uuid
      AND ad.revoked_at IS NULL
      AND (
        ad.scope_type = 'all_clients'
        OR ad.object_id = onec_clients.guid_client
      )
  )`;

  if (!scope.whereSql) {
    return {
      whereSql: `WHERE ${denialClause}`,
      params: [...scope.params, userId],
    };
  }

  const scopeClause = scope.whereSql.replace(/^WHERE\s+/, "");
  return {
    whereSql: `WHERE (${scopeClause}) AND (${denialClause})`,
    params: [...scope.params, userId],
  };
}

export type BuildClientScopeOptions = {
  /** ROP client list: exclude parents reachable only via outlet-level 1C assignment. */
  ropDirectClientList?: boolean;
  /** Manager client list: exclude parents reachable only via outlet-level assignment. */
  managerDirectClientList?: boolean;
};

export function buildClientScopeSql(
  context: AccessContext,
  options: BuildClientScopeOptions = {},
): ClientScopeSql {
  if (context.explicitlyDeniedAll) {
    return DENY_SCOPE;
  }

  if (context.fullClientBase) {
    return appendActiveBaselineFilter(appendUserDenials({ whereSql: "", params: [] }, context.userId));
  }

  if (!context.hasScopedClientAccess || context.employeeLinkConflict || !context.hasEmployeeLink) {
    return DENY_SCOPE;
  }

  const userParam = context.userId;

  let scope: ClientScopeSql;
  switch (context.role) {
    case "manager": {
      const managerClause = options.managerDirectClientList
        ? managerDirectClientListClause("$1::uuid")
        : managerFullClientReadClause("$1::uuid");
      scope = scopedWhere(
        `
          SELECT guid_client
          FROM onec_clients
          WHERE ${managerClause}
            AND ${ACTIVE_BASELINE_CLIENT_SQL.trim()}
        `,
        [context.employeeId!],
      );
      break;
    }

    case "rop": {
      const ropReadClause = options.ropDirectClientList
        ? ropDirectClientListClause("$1", "$2", "oc")
        : ropFullClientReadClause("$1", "$2", "oc");
      scope = scopedWhere(
        `
          SELECT oc.guid_client
          FROM onec_clients oc
          WHERE ${MANAGER_ROSTER_SCOPE_ALLOWED_SQL.replaceAll("onec_clients.", "oc.")}
            AND ${ACTIVE_BASELINE_OC_SQL.trim()}
            AND ${ropReadClause}
        `,
        [userParam, context.employeeId!],
      );
      break;
    }

    case "regional_manager":
      scope = scopedWhere(
        `
          SELECT g.object_id AS guid_client
          FROM access_grants g
          JOIN onec_clients oc ON oc.guid_client = g.object_id
          WHERE g.user_id = $1::uuid
            AND g.grant_type = 'client'
            AND g.revoked_at IS NULL
            AND ${ACTIVE_BASELINE_OC_SQL.trim()}
        `,
        [userParam],
      );
      break;

    case "assistant":
      scope = scopedWhere(
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
            AND NOT EXISTS (
              SELECT 1
              FROM delegation_change_requests dcr
              WHERE dcr.delegation_id = d.id
                AND dcr.status = 'pending_approval'
            )
            AND EXISTS (
              SELECT 1
              FROM onec_clients oc
              JOIN user_onec_employee_links uoel
                ON uoel.user_id = d.delegator_user_id
               AND uoel.revoked_at IS NULL
              JOIN users delegator ON delegator.id = d.delegator_user_id
              WHERE oc.guid_client = dc.guid_client
                AND oc.guid_manager = uoel.employee_id
                AND ${ACTIVE_BASELINE_OC_SQL.trim()}
                AND COALESCE(oc.manager_roster_state, 'in_wholesale_roster') <> 'outside_wholesale_roster'
                AND delegator.status = 'active'
                AND delegator.role IN ('manager', 'rop')
                AND NOT EXISTS (
                  SELECT 1
                  FROM access_denials ad
                  WHERE ad.user_id = d.delegator_user_id
                    AND ad.revoked_at IS NULL
                    AND (
                      ad.scope_type = 'all_clients'
                      OR ad.object_id = dc.guid_client
                    )
                )
            )
        `,
        [userParam],
      );
      break;

    default:
      return DENY_SCOPE;
  }

  return appendActiveBaselineFilter(appendUserDenials(scope, context.userId));
}
