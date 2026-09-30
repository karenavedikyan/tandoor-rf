import type { PoolClient } from "pg";
import type { Bitrix24ObjectType } from "../labels/format";
import type { NormalizedChecklistItem } from "../normalize-checklist";
import { computeChecklistProgress } from "../normalize-checklist";
import { requirePool } from "../../db/pool";

export type ChecklistLoadStatus = "loaded" | "empty" | "error" | "partial";

export type ChecklistSnapshotWriteResult = "written" | "skipped";

export type ChecklistSnapshotRow = {
  portalId: string;
  taskId: string;
  objectType: Bitrix24ObjectType | null;
  objectGuid: string | null;
  loadStatus: ChecklistLoadStatus;
  syncComplete: boolean;
  errorCode: string | null;
  itemsJson: NormalizedChecklistItem[];
  progressCompleted: number | null;
  progressTotal: number | null;
  syncedAt: string;
  taskCacheVersion: number | null;
  taskSyncedAt: string | null;
};

export type ChecklistSnapshotInput = {
  portalId: string;
  taskId: string;
  objectType: Bitrix24ObjectType | null;
  objectGuid: string | null;
  loadStatus: ChecklistLoadStatus;
  syncComplete: boolean;
  errorCode?: string | null;
  items: NormalizedChecklistItem[];
  taskCacheVersion: number;
  taskSyncedAt: string;
};

function mapRow(row: {
  portal_id: string;
  task_id: string;
  object_type: Bitrix24ObjectType | null;
  object_guid: string | null;
  load_status: ChecklistLoadStatus;
  sync_complete: boolean;
  error_code: string | null;
  items_json: unknown;
  progress_completed: number | null;
  progress_total: number | null;
  synced_at: Date;
  task_cache_version: number | null;
  task_synced_at: Date | null;
}): ChecklistSnapshotRow {
  return {
    portalId: row.portal_id,
    taskId: row.task_id,
    objectType: row.object_type,
    objectGuid: row.object_guid,
    loadStatus: row.load_status,
    syncComplete: row.sync_complete,
    errorCode: row.error_code,
    itemsJson: Array.isArray(row.items_json)
      ? (row.items_json as NormalizedChecklistItem[])
      : [],
    progressCompleted: row.progress_completed,
    progressTotal: row.progress_total,
    syncedAt: row.synced_at.toISOString(),
    taskCacheVersion: row.task_cache_version,
    taskSyncedAt: row.task_synced_at?.toISOString() ?? null,
  };
}

export async function upsertChecklistSnapshot(
  input: ChecklistSnapshotInput,
  client: PoolClient,
): Promise<ChecklistSnapshotWriteResult> {
  await client.query(`SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))`, [
    input.portalId,
    input.taskId,
  ]);

  const gate = await client.query<{
    cache_version: number;
    synced_at: Date;
    object_type: Bitrix24ObjectType | null;
    object_guid: string | null;
  }>(
    `SELECT c.cache_version, c.synced_at, b.object_type, b.object_guid
     FROM bitrix24_task_cache c
     JOIN bitrix24_task_bindings b
       ON b.portal_id = c.portal_id AND b.task_id = c.task_id
     WHERE c.portal_id = $1
       AND c.task_id = $2
     FOR UPDATE`,
    [input.portalId, input.taskId],
  );

  const current = gate.rows[0];
  if (
    !current ||
    Number(current.cache_version) !== input.taskCacheVersion ||
    current.synced_at.toISOString() !== input.taskSyncedAt ||
    current.object_type !== input.objectType ||
    String(current.object_guid) !== String(input.objectGuid)
  ) {
    return "skipped";
  }

  const progress =
    input.loadStatus === "loaded" || input.loadStatus === "empty"
      ? computeChecklistProgress(input.items)
      : null;

  const result = await client.query<{ portal_id: string }>(
    `INSERT INTO bitrix24_task_checklist_snapshots (
       portal_id, task_id, object_type, object_guid,
       load_status, sync_complete, error_code, items_json,
       progress_completed, progress_total, synced_at,
       task_cache_version, task_synced_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, NOW(), $11, $12::timestamptz)
     ON CONFLICT (portal_id, task_id) DO UPDATE SET
       object_type = EXCLUDED.object_type,
       object_guid = EXCLUDED.object_guid,
       load_status = EXCLUDED.load_status,
       sync_complete = EXCLUDED.sync_complete,
       error_code = EXCLUDED.error_code,
       items_json = EXCLUDED.items_json,
       progress_completed = EXCLUDED.progress_completed,
       progress_total = EXCLUDED.progress_total,
       synced_at = NOW(),
       task_cache_version = EXCLUDED.task_cache_version,
       task_synced_at = EXCLUDED.task_synced_at
     RETURNING portal_id`,
    [
      input.portalId,
      input.taskId,
      input.objectType,
      input.objectGuid,
      input.loadStatus,
      input.syncComplete,
      input.errorCode ?? null,
      JSON.stringify(input.items),
      progress?.completed ?? null,
      progress?.total ?? null,
      input.taskCacheVersion,
      input.taskSyncedAt,
    ],
  );

  return (result.rowCount ?? 0) > 0 ? "written" : "skipped";
}

export async function findChecklistSnapshot(
  portalId: string,
  taskId: string,
): Promise<ChecklistSnapshotRow | null> {
  const pool = requirePool();
  const result = await pool.query<{
    portal_id: string;
    task_id: string;
    object_type: Bitrix24ObjectType | null;
    object_guid: string | null;
    load_status: ChecklistLoadStatus;
    sync_complete: boolean;
    error_code: string | null;
    items_json: unknown;
    progress_completed: number | null;
    progress_total: number | null;
    synced_at: Date;
    task_cache_version: number | null;
    task_synced_at: Date | null;
  }>(
    `SELECT portal_id, task_id, object_type, object_guid, load_status, sync_complete,
            error_code, items_json, progress_completed, progress_total, synced_at,
            task_cache_version, task_synced_at
     FROM bitrix24_task_checklist_snapshots
     WHERE portal_id = $1 AND task_id = $2`,
    [portalId, taskId],
  );
  const row = result.rows[0];
  return row ? mapRow(row) : null;
}

export function isChecklistBindingMatch(
  snapshot: ChecklistSnapshotRow,
  objectType: Bitrix24ObjectType | null,
  objectGuid: string | null,
): boolean {
  if (!objectType || !objectGuid) {
    return false;
  }
  return snapshot.objectType === objectType && snapshot.objectGuid === objectGuid;
}

export function isChecklistGenerationMatch(
  snapshot: ChecklistSnapshotRow,
  taskCacheVersion: number,
  taskSyncedAt: string,
): boolean {
  if (snapshot.taskCacheVersion === null || snapshot.taskSyncedAt === null) {
    return false;
  }
  return snapshot.taskCacheVersion === taskCacheVersion
    && snapshot.taskSyncedAt === taskSyncedAt;
}
