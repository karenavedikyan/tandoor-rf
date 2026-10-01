import type { Pool, PoolClient } from "pg";
import { requirePool } from "../../db/pool";
import type { Bitrix24ObjectType } from "../labels/format";
import { bitrixChangedAtToDate } from "../parse-changed-at";
import { isCachePublishAllowed, loadBitrix24TasksRuntimeConfig } from "./config";
import { fingerprintSourceContent, sourceContentFromSnapshot } from "./snapshot-content";

export function buildSyncScopeSummary(portalId: string, bitrixUserId: string): string {
  return `portal_id=${portalId};bitrix_user_id=${bitrixUserId}`;
}

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

export async function recordBindingDiagnostic(
  portalId: string,
  taskId: string,
  reason: string,
  detail: string | null,
  client: Pool | PoolClient = requirePool(),
): Promise<void> {
  await client.query(
    `INSERT INTO bitrix24_binding_diagnostics (portal_id, task_id, reason, detail)
     VALUES ($1, $2, $3, $4)`,
    [portalId, taskId, reason, detail],
  );
}

function isPoolClient(value: Pool | PoolClient): value is PoolClient {
  return typeof (value as PoolClient).release === "function";
}

async function withSnapshotTransaction<T>(
  client: Pool | PoolClient,
  fn: (db: PoolClient) => Promise<T>,
): Promise<T> {
  if (isPoolClient(client)) {
    return fn(client);
  }
  const pool = client as Pool;
  const leased = await pool.connect();
  try {
    await leased.query("BEGIN");
    const result = await fn(leased);
    await leased.query("COMMIT");
    return result;
  } catch (error) {
    await leased.query("ROLLBACK");
    throw error;
  } finally {
    leased.release();
  }
}

export type TaskSnapshotWriteResult = {
  cacheUpdated: boolean;
  versionConflict?: boolean;
  staleRejected?: boolean;
  cacheVersion?: number;
  syncedAt?: string;
};

async function readTaskCacheMeta(
  db: PoolClient,
  portalId: string,
  taskId: string,
): Promise<{ cacheVersion: number; syncedAt: string } | null> {
  const result = await db.query<{ cache_version: number; synced_at: Date }>(
    `SELECT cache_version, synced_at
     FROM bitrix24_task_cache
     WHERE portal_id = $1 AND task_id = $2`,
    [portalId, taskId],
  );
  const row = result.rows[0];
  if (!row) {
    return null;
  }
  return {
    cacheVersion: Number(row.cache_version),
    syncedAt: row.synced_at.toISOString(),
  };
}

export async function upsertTaskSnapshot(
  row: TaskSnapshotInput,
  client: Pool | PoolClient = requirePool(),
): Promise<TaskSnapshotWriteResult> {
  const changedAtDate = bitrixChangedAtToDate(row.changedAt);
  if (!changedAtDate || changedAtDate.getTime() > Date.now()) {
    return { cacheUpdated: false };
  }

  const sourceFingerprint = fingerprintSourceContent(sourceContentFromSnapshot(row));

  return withSnapshotTransaction(client, async (db) => {
    await db.query(`SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))`, [
      row.portalId,
      row.taskId,
    ]);

    const existing = await db.query<{
      changed_at: Date | null;
      content_fingerprint: string | null;
      synced_at: Date;
    }>(
      `SELECT changed_at, content_fingerprint, synced_at
       FROM bitrix24_task_cache
       WHERE portal_id = $1 AND task_id = $2
       FOR UPDATE`,
      [row.portalId, row.taskId],
    );

    const prior = existing.rows[0];
    const incomingChangedAt = changedAtDate.toISOString();

    if (prior?.changed_at) {
      const priorMs = prior.changed_at.getTime();
      const incomingMs = changedAtDate.getTime();
      if (incomingMs < priorMs) {
        return { cacheUpdated: false, staleRejected: true };
      }
      if (incomingMs === priorMs) {
        if (prior.content_fingerprint !== sourceFingerprint) {
          return { cacheUpdated: false, versionConflict: true };
        }
        await db.query(
          `UPDATE bitrix24_task_cache
           SET published = $3,
               synced_at = NOW(),
               cache_version = bitrix24_task_cache.cache_version + 1
           WHERE portal_id = $1 AND task_id = $2`,
          [row.portalId, row.taskId, row.published],
        );
        await db.query(
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
        const meta = await readTaskCacheMeta(db, row.portalId, row.taskId);
        return meta
          ? { cacheUpdated: true, cacheVersion: meta.cacheVersion, syncedAt: meta.syncedAt }
          : { cacheUpdated: true };
      }
    }

    const cacheResult = await db.query<{ task_id: string }>(
      `INSERT INTO bitrix24_task_cache (
         portal_id, task_id, responsible_bitrix_user_id, title, status_label,
         deadline, changed_at, description_hash, published, content_fingerprint
       ) VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz, $8, $9, $10)
       ON CONFLICT (portal_id, task_id) DO UPDATE SET
         responsible_bitrix_user_id = EXCLUDED.responsible_bitrix_user_id,
         title = EXCLUDED.title,
         status_label = EXCLUDED.status_label,
         deadline = EXCLUDED.deadline,
         changed_at = EXCLUDED.changed_at,
         description_hash = EXCLUDED.description_hash,
         synced_at = NOW(),
         cache_version = bitrix24_task_cache.cache_version + 1,
         published = EXCLUDED.published,
         content_fingerprint = EXCLUDED.content_fingerprint
       WHERE bitrix24_task_cache.changed_at IS NULL
          OR bitrix24_task_cache.changed_at < EXCLUDED.changed_at
       RETURNING task_id`,
      [
        row.portalId,
        row.taskId,
        row.responsibleBitrixUserId,
        row.title,
        row.statusLabel,
        row.deadline,
        incomingChangedAt,
        row.descriptionHash,
        row.published,
        sourceFingerprint,
      ],
    );

    if ((cacheResult.rowCount ?? 0) === 0) {
      return { cacheUpdated: false, versionConflict: true };
    }

    await db.query(
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

    const meta = await readTaskCacheMeta(db, row.portalId, row.taskId);
    return meta
      ? { cacheUpdated: true, cacheVersion: meta.cacheVersion, syncedAt: meta.syncedAt }
      : { cacheUpdated: true };
  });
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
       AND c.changed_at IS NOT NULL
       AND EXISTS (
         SELECT 1 FROM bitrix24_confirmed_objects co
         WHERE co.object_type = b.object_type
           AND co.object_guid = b.object_guid
       )
       AND (
         b.label_code IS NULL
         OR EXISTS (
           SELECT 1 FROM bitrix24_object_labels ol
           WHERE ol.label_code = b.label_code AND ol.revoked_at IS NULL
         )
       )
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

function mapTaskSnapshotRow(row: {
  portal_id: string;
  task_id: string;
  responsible_bitrix_user_id: string | null;
  title: string;
  status_label: string;
  deadline: string | null;
  changed_at: Date | string;
  description_hash: string;
  synced_at: Date;
  cache_version: number | string;
  published: boolean;
  object_type: Bitrix24ObjectType | null;
  object_guid: string | null;
  label_code: string | null;
  binding_status: string;
  conflict_reason: string | null;
  linked_at: Date | null;
  updated_at: Date;
}): TaskCacheRow & TaskBindingRow {
  return {
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
  };
}

export async function findTaskSnapshotById(
  portalId: string,
  taskId: string,
  client: Pool | PoolClient = requirePool(),
): Promise<(TaskCacheRow & TaskBindingRow) | null> {
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
     FROM bitrix24_task_cache c
     JOIN bitrix24_task_bindings b
       ON c.portal_id = b.portal_id AND c.task_id = b.task_id
     WHERE c.portal_id = $1
       AND c.task_id = $2
     LIMIT 1`,
    [portalId, taskId],
  );
  const row = result.rows[0];
  if (!row) {
    return null;
  }
  return mapTaskSnapshotRow(row);
}

export async function findPublishedTaskById(
  portalId: string,
  taskId: string,
  client: Pool | PoolClient = requirePool(),
): Promise<(TaskCacheRow & TaskBindingRow) | null> {
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
       AND b.task_id = $2
       AND b.binding_status = 'confirmed'
       AND c.published = TRUE
       AND c.changed_at IS NOT NULL
     LIMIT 1`,
    [portalId, taskId],
  );
  const row = result.rows[0];
  if (!row) {
    return null;
  }
  return mapTaskSnapshotRow(row);
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
    `INSERT INTO bitrix24_employee_portal_links (user_id, portal_id, bitrix_user_id, access_expires_at, last_verified_at)
     VALUES ($1::uuid, $2, $3, $4::timestamptz, NOW())
     ON CONFLICT (user_id, portal_id) DO UPDATE SET
       bitrix_user_id = EXCLUDED.bitrix_user_id,
       confirmed_at = CASE
         WHEN bitrix24_employee_portal_links.bitrix_user_id IS DISTINCT FROM EXCLUDED.bitrix_user_id
           THEN NOW()
         ELSE bitrix24_employee_portal_links.confirmed_at
       END,
       last_verified_at = CASE
         WHEN bitrix24_employee_portal_links.bitrix_user_id IS DISTINCT FROM EXCLUDED.bitrix_user_id
           THEN NULL
         ELSE bitrix24_employee_portal_links.last_verified_at
       END,
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
  confirmedAtMs: number;
  verificationVersion: string | null;
  accessExpiresAt: string | null;
  lastVerifiedAt: string | null;
} | null> {
  const result = await client.query<{
    bitrix_user_id: string;
    confirmed_at: Date;
    confirmed_at_ms: string;
    verification_version: string | null;
    access_expires_at: Date | null;
    last_verified_at: Date | null;
  }>(
    `SELECT bitrix_user_id,
            confirmed_at,
            (extract(epoch from confirmed_at) * 1000)::bigint AS confirmed_at_ms,
            last_verified_at::text AS verification_version,
            access_expires_at,
            last_verified_at
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
    confirmedAtMs: Number(row.confirmed_at_ms),
    verificationVersion: row.verification_version,
    accessExpiresAt: row.access_expires_at ? row.access_expires_at.toISOString() : null,
    lastVerifiedAt: row.last_verified_at ? row.last_verified_at.toISOString() : null,
  };
}

export type EmployeePortalLinkIdentity = {
  bitrixUserId: string;
  confirmedAtMs: number;
  verificationVersion: string | null;
};

export async function recordEmployeePortalVerification(
  userId: string,
  portalId: string,
  identity: EmployeePortalLinkIdentity,
  client: Pool | PoolClient = requirePool(),
): Promise<boolean> {
  const result = await client.query(
    `UPDATE bitrix24_employee_portal_links
     SET last_verified_at = NOW()
     WHERE user_id = $1::uuid
       AND portal_id = $2
       AND bitrix_user_id = $3
       AND (extract(epoch from confirmed_at) * 1000)::bigint = $4::bigint
       AND last_verified_at IS NOT DISTINCT FROM $5::timestamptz
       AND (access_expires_at IS NULL OR access_expires_at > clock_timestamp())
       AND EXISTS (SELECT 1 FROM users u WHERE u.id = user_id AND u.status = 'active')`,
    [userId, portalId, identity.bitrixUserId, Math.round(identity.confirmedAtMs), identity.verificationVersion],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function clearEmployeePortalVerification(
  userId: string,
  portalId: string,
  identity: EmployeePortalLinkIdentity,
  client: Pool | PoolClient = requirePool(),
): Promise<boolean> {
  const result = await client.query(
    `UPDATE bitrix24_employee_portal_links
     SET last_verified_at = NULL
     WHERE user_id = $1::uuid
       AND portal_id = $2
       AND bitrix_user_id = $3
       AND (extract(epoch from confirmed_at) * 1000)::bigint = $4::bigint
       AND last_verified_at IS NOT DISTINCT FROM $5::timestamptz`,
    [userId, portalId, identity.bitrixUserId, Math.round(identity.confirmedAtMs), identity.verificationVersion],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function isPortalBitrixUserConfirmed(
  portalId: string,
  bitrixUserId: string,
  client: Pool | PoolClient = requirePool(),
): Promise<boolean> {
  const result = await client.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM bitrix24_employee_portal_links
       WHERE portal_id = $1 AND bitrix_user_id = $2
     ) AS exists`,
    [portalId, bitrixUserId],
  );
  return result.rows[0]?.exists ?? false;
}

export async function insertSyncJournalEntry(
  input: {
    runMode: "dry_run" | "apply";
    scopeSummary: string;
    status: string;
    summary: Record<string, unknown>;
    finishedAt?: Date | null;
  },
  client: Pool | PoolClient = requirePool(),
): Promise<string> {
  const result = await client.query<{ id: string }>(
    `INSERT INTO bitrix24_sync_journal (run_mode, scope_summary, started_at, finished_at, status, summary)
     VALUES ($1, $2, NOW(), $3, $4, $5::jsonb)
     RETURNING id::text AS id`,
    [
      input.runMode,
      input.scopeSummary,
      input.finishedAt ?? new Date(),
      input.status,
      JSON.stringify(input.summary),
    ],
  );
  return result.rows[0]!.id;
}

export async function listBindingDiagnostics(
  portalId: string,
  limit = 50,
  client: Pool | PoolClient = requirePool(),
): Promise<
  Array<{ taskId: string; reason: string; detail: string | null; recordedAt: string }>
> {
  const result = await client.query<{
    task_id: string;
    reason: string;
    detail: string | null;
    recorded_at: Date;
  }>(
    `SELECT task_id, reason, detail, recorded_at
     FROM bitrix24_binding_diagnostics
     WHERE portal_id = $1
     ORDER BY recorded_at DESC
     LIMIT $2`,
    [portalId, limit],
  );
  return result.rows.map((row) => ({
    taskId: row.task_id,
    reason: row.reason,
    detail: row.detail,
    recordedAt: row.recorded_at.toISOString(),
  }));
}

export async function findLatestSyncJournalEntry(
  portalId: string,
  bitrixUserId?: string,
  client: Pool | PoolClient = requirePool(),
): Promise<{
  finishedAt: string | null;
  status: string;
  runMode: string;
  summary: Record<string, unknown>;
} | null> {
  if (!bitrixUserId) {
    return null;
  }
  const scopeSummary = buildSyncScopeSummary(portalId, bitrixUserId);
  const result = await client.query<{
    finished_at: Date | null;
    status: string;
    run_mode: string;
    summary: Record<string, unknown>;
  }>(
    `SELECT finished_at, status, run_mode, summary
     FROM bitrix24_sync_journal
     WHERE scope_summary = $1
     ORDER BY finished_at DESC NULLS LAST, started_at DESC
     LIMIT 1`,
    [scopeSummary],
  );
  const row = result.rows[0];
  if (!row) {
    return null;
  }
  return {
    finishedAt: row.finished_at ? row.finished_at.toISOString() : null,
    status: row.status,
    runMode: row.run_mode,
    summary: row.summary ?? {},
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
  portalId: string | null,
  objectType: Bitrix24ObjectType,
  objectGuid: string,
  reason: string,
  client: Pool | PoolClient = requirePool(),
): Promise<void> {
  if (portalId) {
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
    return;
  }
  await client.query(
    `UPDATE bitrix24_task_bindings
     SET binding_status = 'object_unconfirmed',
         conflict_reason = $3,
         updated_at = NOW()
     WHERE object_type = $1::bitrix24_object_type
       AND object_guid = $2::uuid
       AND binding_status = 'confirmed'`,
    [objectType, objectGuid, reason],
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

export type PublishedTaskSnapshotEntry = {
  taskId: string;
  cacheVersion: number;
  syncedAt: string;
  syncedAtVersion: string;
  objectType: Bitrix24ObjectType;
  objectGuid: string;
};

export async function listPublishedTaskSnapshotForResponsibleScope(input: {
  portalId: string;
  bitrixUserId: string;
  objectType: Bitrix24ObjectType;
  objectGuid: string;
  holdingGuid: string;
  client?: Pool | PoolClient;
}): Promise<PublishedTaskSnapshotEntry[]> {
  const client = input.client ?? requirePool();
  const result = await client.query<{
    task_id: string;
    cache_version: number;
    synced_at: Date;
    synced_at_version: string;
    object_type: Bitrix24ObjectType;
    object_guid: string;
  }>(
    `SELECT c.task_id, c.cache_version, c.synced_at, c.synced_at::text AS synced_at_version,
            b.object_type, b.object_guid::text
     FROM bitrix24_task_cache c
     JOIN bitrix24_task_bindings b
       ON c.portal_id = b.portal_id AND c.task_id = b.task_id
     WHERE c.portal_id = $1
       AND c.responsible_bitrix_user_id = $2
       AND b.binding_status = 'confirmed'
       AND c.published = TRUE
       AND (
         (b.object_type = $3::bitrix24_object_type AND b.object_guid = $4::uuid)
         OR (
           $3::text = 'holding'
           AND EXISTS (
             SELECT 1 FROM bitrix24_object_hierarchy h
             WHERE h.parent_type = 'holding'
               AND h.parent_guid = $5::uuid
               AND h.child_type = b.object_type
               AND h.child_guid = b.object_guid
           )
         )
       )`,
    [
      input.portalId,
      input.bitrixUserId,
      input.objectType,
      input.objectGuid,
      input.holdingGuid,
    ],
  );
  return result.rows.map((row) => ({
    taskId: row.task_id,
    cacheVersion: Number(row.cache_version),
    syncedAt: row.synced_at.toISOString(),
    syncedAtVersion: row.synced_at_version,
    objectType: row.object_type,
    objectGuid: row.object_guid,
  }));
}

export async function unpublishResponsibleTasksNotInSet(input: {
  portalId: string;
  bitrixUserId: string;
  objectType: Bitrix24ObjectType;
  objectGuid: string;
  holdingGuid: string;
  /** Tasks proven present after a complete successful sync. */
  keepTaskIds: string[];
  /** Pre-sync generation entries eligible for CAS unpublish. */
  snapshotEntries: PublishedTaskSnapshotEntry[];
  client?: Pool | PoolClient;
}): Promise<number> {
  const client = input.client ?? requirePool();
  if (input.snapshotEntries.length === 0) {
    return 0;
  }
  const keep = new Set(input.keepTaskIds);
  let unpublished = 0;
  for (const entry of input.snapshotEntries) {
    if (keep.has(entry.taskId)) {
      continue;
    }
    const result = await client.query(
      `UPDATE bitrix24_task_cache c
       SET published = FALSE, cache_version = c.cache_version + 1
       FROM bitrix24_task_bindings b
       WHERE c.portal_id = b.portal_id AND c.task_id = b.task_id
         AND c.portal_id = $1
         AND c.task_id = $2
         AND c.cache_version = $3
         AND c.synced_at = $8::timestamptz
         AND b.object_type = $9::bitrix24_object_type AND b.object_guid = $10::uuid
         AND c.responsible_bitrix_user_id = $4
         AND b.binding_status = 'confirmed'
         AND c.published = TRUE
         AND (
           (b.object_type = $5::bitrix24_object_type AND b.object_guid = $6::uuid)
           OR (
             $5::text = 'holding'
             AND EXISTS (
               SELECT 1 FROM bitrix24_object_hierarchy h
               WHERE h.parent_type = 'holding'
                 AND h.parent_guid = $7::uuid
                 AND h.child_type = b.object_type
                 AND h.child_guid = b.object_guid
             )
           )
         )`,
      [
        input.portalId,
        entry.taskId,
        entry.cacheVersion,
        input.bitrixUserId,
        input.objectType,
        input.objectGuid,
        input.holdingGuid,
        entry.syncedAtVersion,
        entry.objectType,
        entry.objectGuid,
      ],
    );
    unpublished += result.rowCount ?? 0;
  }
  return unpublished;
}
