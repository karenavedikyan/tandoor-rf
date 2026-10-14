import type { AccessContext } from "../access/types";
import { query } from "../db/pool";
import {
  v3ActiveDelegationRowSql,
  v3DelegationClientGrantDenialsSql,
  v3EntityAssignmentScope,
} from "./v3/access-scope";
import { isExchangeV3Active } from "./v3/list";

export type AssistantDelegationContext =
  | {
      mode: "single";
      delegatorName: string;
      clientCount: number;
    }
  | {
      mode: "multiple";
      delegatorCount: number;
      clientCount: number;
    };

const ACTIVE_DELEGATION_SQL = `
  d.assistant_user_id = $1::uuid
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
    FROM user_onec_employee_links uoel
    JOIN users delegator ON delegator.id = d.delegator_user_id
    WHERE uoel.user_id = d.delegator_user_id
      AND uoel.revoked_at IS NULL
      AND delegator.status = 'active'
      AND delegator.role IN ('manager', 'rop')
  )
`;

async function countAccessibleLegalClientsV3(context: AccessContext): Promise<number> {
  const scope = v3EntityAssignmentScope(context, "le", "legal");
  const result = await query<{ count: string }>(
    `
      SELECT COUNT(DISTINCT le.guid_client)::text AS count
      FROM onec_v3_legal_entities le
      WHERE (${scope.clause})
    `,
    scope.params,
  );
  return Number(result.rows[0]?.count ?? 0);
}

async function countAccessibleLegalClientsLegacy(assistantUserId: string): Promise<number> {
  const result = await query<{ count: string }>(
    `
      SELECT COUNT(DISTINCT dc.guid_client)::text AS count
      FROM delegations d
      JOIN delegation_clients dc ON dc.delegation_id = d.id
      WHERE ${ACTIVE_DELEGATION_SQL}
        AND EXISTS (
          SELECT 1
          FROM onec_clients oc
          JOIN user_onec_employee_links uoel
            ON uoel.user_id = d.delegator_user_id
           AND uoel.revoked_at IS NULL
          JOIN users delegator ON delegator.id = d.delegator_user_id
          WHERE oc.guid_client = dc.guid_client
            AND oc.guid_manager = uoel.employee_id
            AND COALESCE(oc.baseline_status, 'active') = 'active'
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
        AND NOT EXISTS (
          SELECT 1
          FROM access_denials ad
          WHERE ad.user_id = $1::uuid
            AND ad.revoked_at IS NULL
            AND (
              ad.scope_type = 'all_clients'
              OR ad.object_id = dc.guid_client
            )
        )
    `,
    [assistantUserId],
  );
  return Number(result.rows[0]?.count ?? 0);
}

async function delegatorsWithAccessibleClients(
  assistantUserId: string,
  v3Active: boolean,
): Promise<{ id: string; name: string }[]> {
  if (v3Active) {
    const assistantParam = "$1";
    const result = await query<{ id: string; name: string }>(
      `
        SELECT DISTINCT
          u.id::text AS id,
          COALESCE(NULLIF(BTRIM(u.full_name), ''), u.email, 'Менеджер') AS name
        FROM delegations d
        JOIN users u ON u.id = d.delegator_user_id
        WHERE ${v3ActiveDelegationRowSql("d", assistantParam)}
          AND EXISTS (
            SELECT 1
            FROM delegation_clients dc
            JOIN onec_v3_legal_entities le ON le.guid_client = dc.guid_client
            WHERE dc.delegation_id = d.id
              AND ${v3DelegationClientGrantDenialsSql("d", "le.guid_client", assistantParam)}
          )
        ORDER BY name ASC
      `,
      [assistantUserId],
    );
    return result.rows;
  }

  const result = await query<{ id: string; name: string }>(
    `
      SELECT DISTINCT
        u.id::text AS id,
        COALESCE(NULLIF(BTRIM(u.full_name), ''), u.email, 'Менеджер') AS name
      FROM delegations d
      JOIN users u ON u.id = d.delegator_user_id
      WHERE ${ACTIVE_DELEGATION_SQL}
        AND EXISTS (
          SELECT 1
          FROM delegation_clients dc
          JOIN onec_clients oc ON oc.guid_client = dc.guid_client
          JOIN user_onec_employee_links uoel
            ON uoel.user_id = d.delegator_user_id
           AND uoel.revoked_at IS NULL
          JOIN users delegator ON delegator.id = d.delegator_user_id
          WHERE dc.delegation_id = d.id
            AND oc.guid_manager = uoel.employee_id
            AND COALESCE(oc.baseline_status, 'active') = 'active'
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
            AND NOT EXISTS (
              SELECT 1
              FROM access_denials ad
              WHERE ad.user_id = $1::uuid
                AND ad.revoked_at IS NULL
                AND (
                  ad.scope_type = 'all_clients'
                  OR ad.object_id = dc.guid_client
                )
            )
        )
      ORDER BY name ASC
    `,
    [assistantUserId],
  );
  return result.rows;
}

export async function loadAssistantDelegationContext(
  context: AccessContext,
): Promise<AssistantDelegationContext | null> {
  if (context.role !== "assistant") {
    return null;
  }

  const v3Active = await isExchangeV3Active();
  const clientCount = v3Active
    ? await countAccessibleLegalClientsV3(context)
    : await countAccessibleLegalClientsLegacy(context.userId);

  if (clientCount <= 0) {
    return null;
  }

  const delegators = await delegatorsWithAccessibleClients(context.userId, v3Active);
  if (delegators.length === 0) {
    return null;
  }

  if (delegators.length === 1) {
    return {
      mode: "single",
      delegatorName: delegators[0]!.name,
      clientCount,
    };
  }

  return {
    mode: "multiple",
    delegatorCount: delegators.length,
    clientCount,
  };
}
