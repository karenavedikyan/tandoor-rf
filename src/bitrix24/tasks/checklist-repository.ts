import type { PoolClient } from "pg";
import type { Bitrix24ObjectType } from "../labels/format";
import type { NormalizedChecklistItem } from "../normalize-checklist";
import { computeChecklistProgress } from "../normalize-checklist";
import { requirePool } from "../../db/pool";

export type ChecklistLoadStatus = "loaded" | "empty" | "error" | "partial";

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
  };
}

export async function upsertChecklistSnapshot(
  input: ChecklistSnapshotInput,
  client: PoolClient,
): Promise<void> {
  const progress =
    input.loadStatus === "loaded" || input.loadStatus === "empty"
      ? computeChecklistProgress(input.items)
      : null;

  await client.query(
    `INSERT INTO bitrix24_task_checklist_snapshots (
       portal_id, task_id, object_type, object_guid,
       load_status, sync_complete, error_code, items_json,
       progress_completed, progress_total, synced_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, NOW())
     ON CONFLICT (portal_id, task_id) DO UPDATE SET
       object_type = EXCLUDED.object_type,
       object_guid = EXCLUDED.object_guid,
       load_status = EXCLUDED.load_status,
       sync_complete = EXCLUDED.sync_complete,
       error_code = EXCLUDED.error_code,
       items_json = EXCLUDED.items_json,
       progress_completed = EXCLUDED.progress_completed,
       progress_total = EXCLUDED.progress_total,
       synced_at = NOW()`,
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
    ],
  );
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
  }>(
    `SELECT portal_id, task_id, object_type, object_guid, load_status, sync_complete,
            error_code, items_json, progress_completed, progress_total, synced_at
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
