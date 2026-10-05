import { query } from "../db/pool";

export type WholesaleEmployeeListItem = {
  guidManager: string;
  nameManager: string;
  post: string | null;
  email: string | null;
  telephone: string | null;
  importedAt: string | null;
  linkedUserId: string | null;
};

export async function listWholesaleEmployees(): Promise<WholesaleEmployeeListItem[]> {
  const result = await query<{
    guid_manager: string;
    name_manager: string;
    post: string | null;
    email: string | null;
    telephone: string | null;
    imported_at: Date | null;
    linked_user_id: string | null;
  }>(
    `
      SELECT
        r.guid_manager::text,
        r.name_manager,
        r.post,
        r.email,
        r.telephone,
        r.imported_at,
        l.user_id::text AS linked_user_id
      FROM onec_wholesale_employee_roster r
      LEFT JOIN user_onec_employee_links l
        ON l.employee_id = r.guid_manager
       AND l.revoked_at IS NULL
      ORDER BY r.name_manager, r.guid_manager
    `,
  );

  return result.rows.map((row) => ({
    guidManager: row.guid_manager,
    nameManager: row.name_manager,
    post: row.post,
    email: row.email,
    telephone: row.telephone,
    importedAt: row.imported_at?.toISOString() ?? null,
    linkedUserId: row.linked_user_id,
  }));
}
