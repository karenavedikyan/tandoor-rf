import type { Pool, PoolClient } from "pg";
import { requirePool } from "../../db/pool";
import type { Bitrix24ObjectType } from "../labels/format";
import { bitrixChangedAtToDate } from "../parse-changed-at";
import { isCachePublishAllowed, loadBitrix24TasksRuntimeConfig } from "./config";

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

export type TaskSnapshotInput = {
  portalId: string;
  taskId: string;
  responsibleBitrixUserId: string | null;
  title: string;
  statusLabel: string;
  deadline: string | null;
  changedAt: string;
  descriptionHash: string;
  published: boolean;
  objectType: Bitrix24ObjectType | null;
  objectGuid: string | null;
  labelCode: string | null;
  bindingStatus: string;
  conflictReason: string | null;
  linkedAt: string | null;
};

function resolveAccessExpiresAt(explicit: string | null | undefined): string | null {
  if (explicit !== undefined) {
    return explicit;
  }
  const runtime = loadBitrix24TasksRuntimeConfig();
  if (!isCachePublishAllowed(runtime)) {
    return null;
  }
  return new Date(Date.now() + runtime.cacheAccessTtlMs).toISOString();
}

export async function upsertTaskSnapshot(
  row: TaskSnapshotInput,
  client: Pool | PoolClient = requirePool(),
): Promise<{ cacheUpdated: boolean }> {
  const changedAtDate = bitrixChangedAtToDate(row.changedAt);
  if (!changedAtDate) {
    return { cacheUpdated: false };
  }

  const cacheResult = await client.query<{ task_id: string }>(
    `INSERT INTO bitrix24_task_cache (
       portal_id, task_id, responsible_bitrix_user_id, title, status_label,
       deadline, changed_at, description_hash, published
     ) VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz, $8, $9)
     ON CONFLICT (portal_id, task_id) DO UPDATE SET
       responsible_bitrix_user_id = EXCLUDED.responsible_bitrix_user_id,
       title = EXCLUDED.title,
       status_label = EXCLUDED.status_label,
       deadline = EXCLUDED.deadline,
       changed_at = EXCLUDED.changed_at,
       description_hash = EXCLUDED.description_hash,
       synced_at = NOW(),
       cache_version = bitrix24_task_cache.cache_version + 1,
       published = EXCLUDED.published
     WHERE bitrix24_task_cache.changed_at <= EXCLUDED.changed_at
     RETURNING task_id`,
    [
      row.portalId,
      row.taskId,
      row.responsibleBitrixUserId,
      row.title,
      row.statusLabel,
      row.deadline,
      changedAtDate.toISOString(),
      row.descriptionHash,
      row.published,
    ],
  );

  if ((cacheResult.rowCount ?? 0) === 0) {
    return { cacheUpdated: false };
  }

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

  return { cacheUpdated: true };
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
       AND b.binding_status = 'confirmed'
       AND c.published = TRUE
       AND (
         (b.object_type = $2::bitrix24_object_type AND b.object_guid = $3::uuid)
         OR (
           $2::text = 'holding'
           AND EXISTS (
             SELECT 1
             FROM bitrix24_object_hierarchy h
             WHERE h.parent_type = 'holding'
               AND h.parent_guid = $3::uuid
               AND h.child_type = b.object_type
               AND h.child_guid = b.object_guid
           )
         )
       )
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
    changedAt: row.changed_at instanceof Date ? row.changed_at.toISOString() : String(row.changed_at),
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
  const accessExpiresAt = resolveAccessExpiresAt(input.accessExpiresAt);
  await client.query(
    `INSERT INTO bitrix24_employee_portal_links (user_id, portal_id, bitrix_user_id, access_expires_at)
     VALUES ($1::uuid, $2, $3, $4::timestamptz)
     ON CONFLICT (user_id, portal_id) DO UPDATE SET
       bitrix_user_id = EXCLUDED.bitrix_user_id,
       confirmed_at = NOW(),
       access_expires_at = EXCLUDED.access_expires_at`,
    [input.userId, input.portalId, input.bitrixUserId, accessExpiresAt],
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

export async function findLatestSyncJournalEntry(
  portalId: string,
  client: Pool | PoolClient = requirePool(),
): Promise<{
  finishedAt: string | null;
  status: string;
  runMode: string;
} | null> {
  const result = await client.query<{
    finished_at: Date | null;
    status: string;
    run_mode: string;
  }>(
    `SELECT finished_at, status, run_mode
     FROM bitrix24_sync_journal
     WHERE scope_summary LIKE $1
     ORDER BY finished_at DESC NULLS LAST, started_at DESC
     LIMIT 1`,
    [`%portal_id=${portalId}%`],
  );
  const row = result.rows[0];
  if (!row) {
    return null;
  }
  return {
    finishedAt: row.finished_at ? row.finished_at.toISOString() : null,
    status: row.status,
    runMode: row.run_mode,
  };
}

export async function invalidateBindingsForLabel(
  portalId: string,
  labelCode: string,
  reason: string,
  client: Pool | PoolClient = requirePool(),
): Promise<void> {
  await client.query(
    `UPDATE bitrix24_task_bindings
     SET binding_status = 'label_revoked',
         conflict_reason = $3,
         updated_at = NOW()
     WHERE portal_id = $1 AND label_code = $2 AND binding_status = 'confirmed'`,
    [portalId, labelCode, reason],
  );
}

export async function invalidateBindingsForObject(
  portalId: string,
  objectType: Bitrix24ObjectType,
  objectGuid: string,
  reason: string,
  client: Pool | PoolClient = requirePool(),
): Promise<void> {
  await client.query(
    `UPDATE bitrix24_task_bindings
     SET binding_status = 'object_unconfirmed',
         conflict_reason = $4,
         updated_at = NOW()
     WHERE portal_id = $1
       AND object_type = $2::bitrix24_object_type
       AND object_guid = $3::uuid
       AND binding_status = 'confirmed'`,
    [portalId, objectType, objectGuid, reason],
  );
}

export async function confirmObjectHierarchyLink(
  parentGuid: string,
  childType: Bitrix24ObjectType,
  childGuid: string,
  client: Pool | PoolClient = requirePool(),
): Promise<void> {
  await client.query(
    `INSERT INTO bitrix24_object_hierarchy (parent_type, parent_guid, child_type, child_guid)
     VALUES ('holding', $1::uuid, $2::bitrix24_object_type, $3::uuid)
     ON CONFLICT (parent_type, parent_guid, child_type, child_guid) DO NOTHING`,
    [parentGuid, childType, childGuid],
  );
}
