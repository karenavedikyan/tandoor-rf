import { Pool } from "pg";
import { assertTestDatabaseUrl } from "../../src/shared/test-database-guard";
import type { Bitrix24ObjectType } from "../../src/bitrix24/labels/format";

export async function insertSummaryPublication(input: {
  databaseUrl: string;
  portalId: string;
  taskId: string;
  objectType: Bitrix24ObjectType;
  objectGuid: string;
  briefText: string;
  publishedByUserId: string;
}): Promise<void> {
  assertTestDatabaseUrl(input.databaseUrl, "insertSummaryPublication");
  const pool = new Pool({ connectionString: input.databaseUrl, max: 1 });
  await pool.query(
    `INSERT INTO bitrix24_task_summary_publications (
       portal_id, task_id, object_type, object_guid, brief_text, published_by_user_id
     ) VALUES ($1, $2, $3::bitrix24_object_type, $4::uuid, $5, $6::uuid)`,
    [
      input.portalId,
      input.taskId,
      input.objectType,
      input.objectGuid,
      input.briefText,
      input.publishedByUserId,
    ],
  );
  await pool.end();
}
