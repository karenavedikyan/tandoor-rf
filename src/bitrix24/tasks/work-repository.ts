import type { Pool, PoolClient } from "pg";
import { requirePool } from "../../db/pool";
import type { Bitrix24ObjectType } from "../labels/format";

export type SummaryPublicationRow = {
  briefText: string;
  confirmedAt: string;
};

export type ContactActionRow = {
  id: string;
  markedAt: string;
  commentText: string | null;
};

export async function findActiveSummaryPublication(
  portalId: string,
  taskId: string,
  client: Pool | PoolClient = requirePool(),
): Promise<SummaryPublicationRow | null> {
  const result = await client.query<{
    brief_text: string;
    confirmed_at: Date;
  }>(
    `SELECT brief_text, confirmed_at
     FROM bitrix24_task_summary_publications
     WHERE portal_id = $1 AND task_id = $2 AND revoked_at IS NULL
     LIMIT 1`,
    [portalId, taskId],
  );
  const row = result.rows[0];
  if (!row) {
    return null;
  }
  return {
    briefText: row.brief_text,
    confirmedAt: row.confirmed_at.toISOString(),
  };
}

export async function findActiveContactAction(
  portalId: string,
  taskId: string,
  objectType: Bitrix24ObjectType,
  objectGuid: string,
  actorUserId: string,
  client: Pool | PoolClient = requirePool(),
): Promise<ContactActionRow | null> {
  const result = await client.query<{
    id: string;
    marked_at: Date;
    comment_text: string | null;
  }>(
    `SELECT id, marked_at, comment_text
     FROM bitrix24_task_contact_actions
     WHERE portal_id = $1
       AND task_id = $2
       AND object_type = $3::bitrix24_object_type
       AND object_guid = $4::uuid
       AND actor_user_id = $5::uuid
       AND action_type = 'contact_responsible'
       AND revoked_at IS NULL
     LIMIT 1`,
    [portalId, taskId, objectType, objectGuid, actorUserId],
  );
  const row = result.rows[0];
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    markedAt: row.marked_at.toISOString(),
    commentText: row.comment_text,
  };
}

export async function setContactActionMarked(
  input: {
    portalId: string;
    taskId: string;
    objectType: Bitrix24ObjectType;
    objectGuid: string;
    actorUserId: string;
    commentText?: string | null;
  },
  client: Pool | PoolClient = requirePool(),
): Promise<ContactActionRow> {
  const existing = await findActiveContactAction(
    input.portalId,
    input.taskId,
    input.objectType,
    input.objectGuid,
    input.actorUserId,
    client,
  );
  if (existing) {
    const normalizedComment =
      input.commentText === undefined ? existing.commentText : input.commentText;
    if (normalizedComment !== existing.commentText) {
      await client.query(
        `UPDATE bitrix24_task_contact_actions
         SET comment_text = $2
         WHERE id = $1::uuid`,
        [existing.id, normalizedComment],
      );
      await client.query(
        `INSERT INTO bitrix24_task_contact_action_history (
           action_id, event_type, actor_user_id, comment_text
         ) VALUES ($1::uuid, 'comment_updated', $2::uuid, $3)`,
        [existing.id, input.actorUserId, normalizedComment],
      );
    }
    return {
      id: existing.id,
      markedAt: existing.markedAt,
      commentText: normalizedComment,
    };
  }

  const inserted = await client.query<{ id: string; marked_at: Date }>(
    `INSERT INTO bitrix24_task_contact_actions (
       portal_id, task_id, object_type, object_guid, actor_user_id, comment_text
     ) VALUES ($1, $2, $3::bitrix24_object_type, $4::uuid, $5::uuid, $6)
     RETURNING id::text AS id, marked_at`,
    [
      input.portalId,
      input.taskId,
      input.objectType,
      input.objectGuid,
      input.actorUserId,
      input.commentText ?? null,
    ],
  );
  const row = inserted.rows[0]!;
  await client.query(
    `INSERT INTO bitrix24_task_contact_action_history (
       action_id, event_type, actor_user_id, comment_text
     ) VALUES ($1::uuid, 'marked', $2::uuid, $3)`,
    [row.id, input.actorUserId, input.commentText ?? null],
  );
  return {
    id: row.id,
    markedAt: row.marked_at.toISOString(),
    commentText: input.commentText ?? null,
  };
}

export async function revokeContactAction(
  input: {
    portalId: string;
    taskId: string;
    objectType: Bitrix24ObjectType;
    objectGuid: string;
    actorUserId: string;
  },
  client: Pool | PoolClient = requirePool(),
): Promise<boolean> {
  const existing = await findActiveContactAction(
    input.portalId,
    input.taskId,
    input.objectType,
    input.objectGuid,
    input.actorUserId,
    client,
  );
  if (!existing) {
    return false;
  }
  await client.query(
    `UPDATE bitrix24_task_contact_actions
     SET revoked_at = NOW()
     WHERE id = $1::uuid AND actor_user_id = $2::uuid AND revoked_at IS NULL`,
    [existing.id, input.actorUserId],
  );
  await client.query(
    `INSERT INTO bitrix24_task_contact_action_history (
       action_id, event_type, actor_user_id, comment_text
     ) VALUES ($1::uuid, 'revoked', $2::uuid, $3)`,
    [existing.id, input.actorUserId, existing.commentText],
  );
  return true;
}
