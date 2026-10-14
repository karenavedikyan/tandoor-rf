import { query } from "../db/pool";

export type AssistantDelegationContext = {
  delegatorName: string;
  clientCount: number;
};

export async function loadAssistantDelegationContext(
  assistantUserId: string,
): Promise<AssistantDelegationContext | null> {
  const result = await query<{ delegator_name: string; client_count: string }>(
    `
      SELECT
        COALESCE(NULLIF(BTRIM(u.full_name), ''), u.email, 'Менеджер') AS delegator_name,
        COUNT(dc.guid_client)::text AS client_count
      FROM delegations d
      JOIN users u ON u.id = d.delegator_user_id
      LEFT JOIN delegation_clients dc ON dc.delegation_id = d.id
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
      GROUP BY u.id, u.full_name, u.email, d.starts_at
      ORDER BY d.starts_at DESC
      LIMIT 1
    `,
    [assistantUserId],
  );
  const row = result.rows[0];
  if (!row) {
    return null;
  }
  return {
    delegatorName: row.delegator_name,
    clientCount: Number(row.client_count) || 0,
  };
}
