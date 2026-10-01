import type { Pool, PoolClient } from "pg";
import type { AccessContext } from "../access/types";
import { findEmployeePortalLink } from "../bitrix24/tasks/repository";
import { loadBitrix24TasksRuntimeConfig } from "../bitrix24/tasks/config";
import type { Bitrix24ObjectType } from "../bitrix24/labels/format";
import type { ChecklistSnapshotRow } from "../bitrix24/tasks/checklist-repository";
import { isOrkPublicationAlignedWithTask } from "../bitrix24/claims/ork-publication-visibility";
import type { ContactActionRow, SummaryPublicationRow } from "../bitrix24/tasks/work-repository";
import type { SummaryPublicationOrigin } from "../bitrix24/tasks/work-repository";
import type { ResponsibleProfileState } from "../bitrix24/tasks/responsible-profile";
import { isLinkAccessValid } from "../bitrix24/tasks/access";
import { requirePool } from "../db/pool";
import {
  hierarchyKey,
  publicationKey,
  type WorkAccessBatch,
} from "./access-batch";
import type { CandidateWorkTaskRow } from "./repository";

export type WorkBatchContext = WorkAccessBatch & {
  responsibles: Map<string, ResponsibleProfileState>;
};

export type WorkPageHydration = {
  contacts: Map<string, ContactActionRow>;
  checklists: Map<string, ChecklistSnapshotRow>;
};

function mapChecklistProgressRow(row: {
  portal_id: string;
  task_id: string;
  object_type: Bitrix24ObjectType | null;
  object_guid: string | null;
  load_status: ChecklistSnapshotRow["loadStatus"];
  sync_complete: boolean;
  error_code: string | null;
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
    itemsJson: [],
    progressCompleted: row.progress_completed,
    progressTotal: row.progress_total,
    syncedAt: row.synced_at.toISOString(),
    taskCacheVersion: row.task_cache_version,
    taskSyncedAt: row.task_synced_at?.toISOString() ?? null,
  };
}

export async function loadWorkAccessBatch(input: {
  context: AccessContext;
  portalId: string;
  candidates: CandidateWorkTaskRow[];
  client?: Pool | PoolClient;
}): Promise<WorkBatchContext> {
  const db = input.client ?? requirePool();
  const nowMs = Date.now();
  const runtime = loadBitrix24TasksRuntimeConfig();
  const employeeLink = await findEmployeePortalLink(input.context.userId, input.portalId, db);

  const cardGuids = [...new Set(input.candidates.map((row) => row.cardGuid.toLowerCase()))];
  const taskIds = [...new Set(input.candidates.map((row) => row.taskId))];
  const publicationObjectGuids = [
    ...new Set(
      input.candidates
        .filter((row) => row.objectType && row.objectGuid)
        .map((row) => `${row.taskId}\0${row.objectType}\0${row.objectGuid!.toLowerCase()}`),
    ),
  ];

  const cardHoldings = new Map<string, string>();
  if (cardGuids.length > 0) {
    const holdings = await db.query<{ card_guid: string; object_guid: string }>(
      `SELECT card_guid::text, object_guid::text
       FROM bitrix24_client_card_objects
       WHERE card_guid = ANY($1::uuid[]) AND object_type = 'holding'`,
      [cardGuids],
    );
    for (const row of holdings.rows) {
      cardHoldings.set(row.card_guid.toLowerCase(), row.object_guid.toLowerCase());
    }
  }

  const holdingGuids = [...new Set(cardHoldings.values())];
  const hierarchyLinks = new Set<string>();
  if (holdingGuids.length > 0) {
    const hierarchy = await db.query<{
      parent_guid: string;
      child_type: Bitrix24ObjectType;
      child_guid: string;
    }>(
      `SELECT parent_guid::text, child_type, child_guid::text
       FROM bitrix24_object_hierarchy
       WHERE parent_type = 'holding' AND parent_guid = ANY($1::uuid[])`,
      [holdingGuids],
    );
    for (const row of hierarchy.rows) {
      hierarchyLinks.add(hierarchyKey(row.parent_guid, row.child_type, row.child_guid));
    }
  }

  const [grants, denials] = await Promise.all([
    db.query<{ object_id: string }>(
      `SELECT object_id::text FROM access_grants
       WHERE user_id = $1::uuid AND revoked_at IS NULL`,
      [input.context.userId],
    ),
    db.query<{ scope_type: string; object_id: string | null }>(
      `SELECT scope_type, object_id::text FROM access_denials
       WHERE user_id = $1::uuid AND revoked_at IS NULL`,
      [input.context.userId],
    ),
  ]);

  const grantedObjectIds = new Set(grants.rows.map((row) => row.object_id.toLowerCase()));
  const deniedObjectIds = new Set<string>();
  let deniedAllClients = false;
  for (const row of denials.rows) {
    if (row.scope_type === "all_clients") {
      deniedAllClients = true;
    } else if (row.object_id) {
      deniedObjectIds.add(row.object_id.toLowerCase());
    }
  }

  const publications = new Map<string, SummaryPublicationRow>();
  if (taskIds.length > 0) {
    const summaryRows = await db.query<{
      task_id: string;
      object_type: Bitrix24ObjectType;
      object_guid: string;
      brief_text: string;
      confirmed_at: Date;
      publication_origin: SummaryPublicationOrigin;
      task_cache_version: number | null;
    }>(
      `SELECT task_id, object_type, object_guid::text, brief_text, confirmed_at,
              publication_origin, task_cache_version
       FROM bitrix24_task_summary_publications
       WHERE portal_id = $1 AND task_id = ANY($2::text[]) AND revoked_at IS NULL`,
      [input.portalId, taskIds],
    );
    const candidateByKey = new Map(
      input.candidates.map((row) => [
        publicationKey(row.taskId, row.objectType!, row.objectGuid!),
        row,
      ]),
    );
    for (const row of summaryRows.rows) {
      const key = publicationKey(row.task_id, row.object_type, row.object_guid);
      if (!publicationObjectGuids.includes(key)) {
        continue;
      }
      const candidate = candidateByKey.get(key);
      const publication: SummaryPublicationRow = {
        briefText: row.brief_text,
        confirmedAt: row.confirmed_at.toISOString(),
        publicationOrigin: row.publication_origin,
        taskCacheVersion: row.task_cache_version,
        objectType: row.object_type,
        objectGuid: row.object_guid,
      };
      if (row.publication_origin === "admin") {
        publications.set(key, publication);
        continue;
      }
      if (
        candidate &&
        isOrkPublicationAlignedWithTask(
          {
            cacheVersion: candidate.cacheVersion,
            objectType: candidate.objectType,
            objectGuid: candidate.objectGuid,
            bindingStatus: candidate.bindingStatus,
          },
          publication,
        )
      ) {
        publications.set(key, publication);
      }
    }
  }

  return {
    runtime,
    employeeLink,
    cardHoldings,
    hierarchyLinks,
    deniedObjectIds,
    deniedAllClients,
    grantedObjectIds,
    publications,
    responsibles: new Map(),
    nowMs,
  };
}

export async function loadResponsibleProfiles(
  portalId: string,
  bitrixUserIds: string[],
  nowMs = Date.now(),
  client: Pool | PoolClient = requirePool(),
): Promise<Map<string, ResponsibleProfileState>> {
  const responsibles = new Map<string, ResponsibleProfileState>();
  if (bitrixUserIds.length === 0) {
    return responsibles;
  }
  const runtime = loadBitrix24TasksRuntimeConfig();
  const profileRows = await client.query<{
    bitrix_user_id: string;
    user_id: string;
    full_name: string;
    email: string;
    access_expires_at: Date | null;
    confirmed_at: Date;
    last_verified_at: Date | null;
  }>(
    `SELECT l.bitrix_user_id, u.id::text AS user_id, u.full_name, u.email,
            l.access_expires_at, l.confirmed_at, l.last_verified_at
     FROM bitrix24_employee_portal_links l
     JOIN users u ON u.id = l.user_id
     WHERE l.portal_id = $1
       AND l.bitrix_user_id = ANY($2::text[])
       AND u.status = 'active'`,
    [portalId, bitrixUserIds],
  );
  const grouped = new Map<string, typeof profileRows.rows>();
  for (const row of profileRows.rows) {
    const list = grouped.get(row.bitrix_user_id) ?? [];
    list.push(row);
    grouped.set(row.bitrix_user_id, list);
  }
  for (const bitrixUserId of bitrixUserIds) {
    const rows = grouped.get(bitrixUserId) ?? [];
    if (rows.length !== 1) {
      responsibles.set(bitrixUserId, {
        state: "unknown",
        displayName: null,
        lkUserId: null,
        email: null,
      });
      continue;
    }
    const row = rows[0]!;
    const linkValid = isLinkAccessValid(
      {
        bitrixUserId,
        confirmedAt: row.confirmed_at.toISOString(),
        accessExpiresAt: row.access_expires_at?.toISOString() ?? null,
        lastVerifiedAt: row.last_verified_at?.toISOString() ?? null,
      },
      runtime,
      nowMs,
    );
    responsibles.set(
      bitrixUserId,
      linkValid
        ? {
            state: "confirmed",
            displayName: row.full_name,
            lkUserId: row.user_id,
            email: row.email,
          }
        : {
            state: "unknown",
            displayName: null,
            lkUserId: null,
            email: null,
          },
    );
  }
  return responsibles;
}

export async function loadWorkPageHydration(input: {
  portalId: string;
  actorUserId: string;
  taskIds: string[];
  client?: Pool | PoolClient;
}): Promise<WorkPageHydration> {
  const db = input.client ?? requirePool();
  const contacts = new Map<string, ContactActionRow>();
  const checklists = new Map<string, ChecklistSnapshotRow>();

  if (input.taskIds.length === 0) {
    return { contacts, checklists };
  }

  const contactRows = await db.query<{
    task_id: string;
    object_type: Bitrix24ObjectType;
    object_guid: string;
    id: string;
    marked_at: Date;
    comment_text: string | null;
  }>(
    `SELECT task_id, object_type, object_guid::text, id::text, marked_at, comment_text
     FROM bitrix24_task_contact_actions
     WHERE portal_id = $1
       AND task_id = ANY($2::text[])
       AND actor_user_id = $3::uuid
       AND action_type = 'contact_responsible'
       AND revoked_at IS NULL`,
    [input.portalId, input.taskIds, input.actorUserId],
  );
  for (const row of contactRows.rows) {
    contacts.set(publicationKey(row.task_id, row.object_type, row.object_guid), {
      id: row.id,
      markedAt: row.marked_at.toISOString(),
      commentText: row.comment_text,
    });
  }

  const checklistRows = await db.query<{
    portal_id: string;
    task_id: string;
    object_type: Bitrix24ObjectType | null;
    object_guid: string | null;
    load_status: ChecklistSnapshotRow["loadStatus"];
    sync_complete: boolean;
    error_code: string | null;
    progress_completed: number | null;
    progress_total: number | null;
    synced_at: Date;
    task_cache_version: number | null;
    task_synced_at: Date | null;
  }>(
    `SELECT portal_id, task_id, object_type, object_guid, load_status, sync_complete,
            error_code, progress_completed, progress_total, synced_at,
            task_cache_version, task_synced_at
     FROM bitrix24_task_checklist_snapshots
     WHERE portal_id = $1 AND task_id = ANY($2::text[])`,
    [input.portalId, input.taskIds],
  );
  for (const row of checklistRows.rows) {
    checklists.set(row.task_id, mapChecklistProgressRow(row));
  }

  return { contacts, checklists };
}
