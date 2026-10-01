import type { Pool, PoolClient } from "pg";
import { combineScopeAndFilter } from "../access/combine-filters";
import { buildClientScopeSql } from "../access/scope-sql";
import type { AccessContext } from "../access/types";
import type { Bitrix24ObjectType } from "../bitrix24/labels/format";
import type { TaskBindingRow, TaskCacheRow } from "../bitrix24/tasks/repository";
import { requirePool } from "../db/pool";

export type CandidateWorkTaskRow = TaskCacheRow &
  TaskBindingRow & {
    cardGuid: string;
    clientName: string;
  };

type CandidateRow = {
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
  object_type: Bitrix24ObjectType;
  object_guid: string;
  label_code: string | null;
  binding_status: string;
  conflict_reason: string | null;
  linked_at: Date | null;
  updated_at: Date;
  card_guid: string;
  client_name: string;
};

function mapCandidateRow(row: CandidateRow): CandidateWorkTaskRow {
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
    cardGuid: row.card_guid,
    clientName: row.client_name,
  };
}

export async function listCandidateWorkTasksForScope(
  context: AccessContext,
  client: Pool | PoolClient = requirePool(),
): Promise<CandidateWorkTaskRow[]> {
  const scope = combineScopeAndFilter(buildClientScopeSql(context), {
    whereSql: "",
    params: [],
  });
  if (scope.whereSql === "WHERE FALSE") {
    return [];
  }

  const scopedCards = await client.query<{ guid_client: string }>(
    `SELECT guid_client::text FROM onec_clients ${scope.whereSql}`,
    scope.params,
  );
  const cardGuids = scopedCards.rows.map((row) => row.guid_client);
  if (cardGuids.length === 0) {
    return [];
  }

  const result = await client.query<CandidateRow>(
    `
      SELECT DISTINCT ON (c.portal_id, c.task_id)
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
        b.updated_at,
        oc.guid_client::text AS card_guid,
        oc.name_client AS client_name
      FROM onec_clients oc
      JOIN bitrix24_client_card_objects cco
        ON cco.card_guid = oc.guid_client
      JOIN bitrix24_task_bindings b
        ON b.binding_status = 'confirmed'
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
         (b.object_type = cco.object_type AND b.object_guid = cco.object_guid)
         OR (
           cco.object_type = 'holding'
           AND EXISTS (
             SELECT 1
             FROM bitrix24_object_hierarchy h
             WHERE h.parent_type = 'holding'
               AND h.parent_guid = cco.object_guid
               AND h.child_type = b.object_type
               AND h.child_guid = b.object_guid
           )
         )
       )
      JOIN bitrix24_task_cache c
        ON c.portal_id = b.portal_id
       AND c.task_id = b.task_id
       AND c.published = TRUE
       AND c.changed_at IS NOT NULL
      WHERE oc.guid_client = ANY($1::uuid[])
      ORDER BY c.portal_id ASC, c.task_id ASC, oc.guid_client ASC
    `,
    [cardGuids],
  );

  return result.rows.map(mapCandidateRow);
}
