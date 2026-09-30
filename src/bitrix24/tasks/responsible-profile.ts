import { requirePool } from "../../db/pool";

export type ResponsibleProfileState =
  | {
      state: "confirmed";
      displayName: string;
      lkUserId: string;
      email: string;
    }
  | {
      state: "unknown";
      displayName: null;
      lkUserId: null;
      email: null;
    };

export async function resolveConfirmedResponsibleProfile(
  portalId: string,
  bitrixUserId: string | null | undefined,
): Promise<ResponsibleProfileState> {
  if (!bitrixUserId) {
    return { state: "unknown", displayName: null, lkUserId: null, email: null };
  }
  const pool = requirePool();
  const result = await pool.query<{
    user_id: string;
    full_name: string;
    email: string;
    access_expires_at: Date | null;
  }>(
    `SELECT u.id::text AS user_id, u.full_name, u.email, l.access_expires_at
     FROM bitrix24_employee_portal_links l
     JOIN users u ON u.id = l.user_id
     WHERE l.portal_id = $1
       AND l.bitrix_user_id = $2
       AND u.status = 'active'
     LIMIT 1`,
    [portalId, bitrixUserId],
  );
  const row = result.rows[0];
  if (!row) {
    return { state: "unknown", displayName: null, lkUserId: null, email: null };
  }
  if (row.access_expires_at && row.access_expires_at.getTime() < Date.now()) {
    return { state: "unknown", displayName: null, lkUserId: null, email: null };
  }
  return {
    state: "confirmed",
    displayName: row.full_name,
    lkUserId: row.user_id,
    email: row.email,
  };
}
