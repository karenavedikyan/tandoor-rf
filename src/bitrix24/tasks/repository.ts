import type { Pool, PoolClient } from "pg";
import { requirePool } from "../../db/pool";
import type { Bitrix24ObjectType } from "../labels/format";

export type TaskCacheRow = {
  portalId: string;
  taskId: string;
  responsibleBitrixUserId: string | null;
  title: string;
  statusLabel: string;
  deadline: string | null;
  changedAt: string;
  descriptionHash: string;
  syncedAt: string;
  cacheVersion: number;
  published: boolean;
};

export type TaskBindingRow = {
  portalId: string;
  taskId: string;
  objectType: Bitrix24ObjectType | null;
  objectGuid: string | null;
  labelCode: string | null;
  bindingStatus: string;
  conflictReason: string | null;
  linkedAt: string | null;
  updatedAt: string;
};

export async function upsertTaskCache(
  row: Omit<TaskCacheRow, "syncedAt" | "cacheVersion" | "published"> & {
    published?: boolean;
  },
  client: Pool | PoolClient = requirePool(),
): Promise<void> {
  await client.query(
    `INSERT INTO bitrix24_task_cache (
       portal_id, task_id, responsible_bitrix_user_id, title, status_label,
       deadline, changed_at, description_hash, published
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE($9, FALSE))
     ON CONFLICT (portal_id, task_id) DO UPDATE SET
       responsible_bitrix_user_id = EXCLUDED.responsible_bitrix_user_id,
       title = EXCLUDED.title,
       status_label = EXCLUDED.status_label,
       deadline = EXCLUDED.deadline,
       changed_at = EXCLUDED.changed_at,
       description_hash = EXCLUDED.description_hash,
       synced_at = NOW(),
       cache_version = bitrix24_task_cache.cache_version + 1,
       published = CASE
         WHEN EXCLUDED.published THEN EXCLUDED.published
         ELSE bitrix24_task_cache.published
       END
     WHERE bitrix24_task_cache.changed_at <= EXCLUDED.changed_at`,
    [
      row.portalId,
      row.taskId,
      row.responsibleBitrixUserId,
      row.title,
      row.statusLabel,
      row.deadline,
      row.changedAt,
      row.descriptionHash,
      row.published ?? false,
    ],
  );
}

export async function upsertTaskBinding(
  row: Omit<TaskBindingRow, "updatedAt">,
  client: Pool | PoolClient = requirePool(),
): Promise<void> {
  await client.query(
    `INSERT INTO bitrix24_task_bindings (
       portal_id, task_id, object_type, object_guid, label_code,
       binding_status, conflict_reason, linked_at
     ) VALUES ($1, $2, $3::bitrix24_object_type, $4::uuid, $5, $6, $7, $8::timestamptz)
     ON CONFLICT (portal_id, task_id) DO UPDATE SET
       object_type = EXCLUDED.object_type,
       object_guid = EXCLUDED.object_guid,
       label_code = EXCLUDED.label_code,
       binding_status = EXCLUDED.binding_status,
       conflict_reason = EXCLUDED.conflict_reason,
       linked_at = EXCLUDED.linked_at,
       updated_at = NOW()`,
    [
      row.portalId,
      row.taskId,
      row.objectType,
      row.objectGuid,
      row.labelCode,
      row.bindingStatus,
      row.conflictReason,
      row.linkedAt,
    ],
  );
}

export async function listPublishedTasksForObject(
  portalId: string,
  objectType: Bitrix24ObjectType,
  objectGuid: string,
  client: Pool | PoolClient = requirePool(),
): Promise<Array<TaskCacheRow & TaskBindingRow>> {
  const result = await client.query(
    `SELECT
       c.portal_id,
       c.task_id,
       c.responsible_bitrix_user_id,
       c.title,
       c.status_label,
       c.deadline,
       c.changed_at,
       c.description_hash,
       c.synced_at,
       c.cache_version,
       c.published,
       b.object_type,
       b.object_guid,
       b.label_code,
       b.binding_status,
       b.conflict_reason,
       b.linked_at,
       b.updated_at
     FROM bitrix24_task_bindings b
     JOIN bitrix24_task_cache c
       ON c.portal_id = b.portal_id AND c.task_id = b.task_id
     WHERE b.portal_id = $1
       AND b.object_type = $2::bitrix24_object_type
       AND b.object_guid = $3::uuid
       AND b.binding_status = 'confirmed'
       AND c.published = TRUE
     ORDER BY c.changed_at DESC`,
    [portalId, objectType, objectGuid],
  );
  return result.rows.map((row) => ({
    portalId: row.portal_id,
    taskId: row.task_id,
    responsibleBitrixUserId: row.responsible_bitrix_user_id,
    title: row.title,
    statusLabel: row.status_label,
    deadline: row.deadline,
    changedAt: row.changed_at,
    descriptionHash: row.description_hash,
    syncedAt: row.synced_at.toISOString(),
    cacheVersion: Number(row.cache_version),
    published: row.published,
    objectType: row.object_type,
    objectGuid: row.object_guid,
    labelCode: row.label_code,
    bindingStatus: row.binding_status,
    conflictReason: row.conflict_reason,
    linkedAt: row.linked_at ? row.linked_at.toISOString() : null,
    updatedAt: row.updated_at.toISOString(),
  }));
}

export async function upsertEmployeePortalLink(
  input: {
    userId: string;
    portalId: string;
    bitrixUserId: string;
    accessExpiresAt?: string | null;
  },
  client: Pool | PoolClient = requirePool(),
): Promise<void> {
  await client.query(
    `INSERT INTO bitrix24_employee_portal_links (user_id, portal_id, bitrix_user_id, access_expires_at)
     VALUES ($1::uuid, $2, $3, $4::timestamptz)
     ON CONFLICT (user_id, portal_id) DO UPDATE SET
       bitrix_user_id = EXCLUDED.bitrix_user_id,
       confirmed_at = NOW(),
       access_expires_at = EXCLUDED.access_expires_at`,
    [input.userId, input.portalId, input.bitrixUserId, input.accessExpiresAt ?? null],
  );
}

export async function findEmployeePortalLink(
  userId: string,
  portalId: string,
  client: Pool | PoolClient = requirePool(),
): Promise<{
  bitrixUserId: string;
  confirmedAt: string;
  accessExpiresAt: string | null;
} | null> {
  const result = await client.query<{
    bitrix_user_id: string;
    confirmed_at: Date;
    access_expires_at: Date | null;
  }>(
    `SELECT bitrix_user_id, confirmed_at, access_expires_at
     FROM bitrix24_employee_portal_links
     WHERE user_id = $1::uuid AND portal_id = $2`,
    [userId, portalId],
  );
  const row = result.rows[0];
  if (!row) {
    return null;
  }
  return {
    bitrixUserId: row.bitrix_user_id,
    confirmedAt: row.confirmed_at.toISOString(),
    accessExpiresAt: row.access_expires_at ? row.access_expires_at.toISOString() : null,
  };
}
