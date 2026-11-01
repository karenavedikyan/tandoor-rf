import type { Pool, PoolClient } from "pg";
import type { TanTrackerOrderDto, TanTrackerPersonalRecipientViewDto } from "./types";

export const TT_PERSONAL_RECIPIENT_LABEL_SET = "personal_recipient_label_set";
export const TT_PERSONAL_RECIPIENT_LABEL_RESET = "personal_recipient_label_reset";

const PRIVATE_ACTIONS = [TT_PERSONAL_RECIPIENT_LABEL_SET, TT_PERSONAL_RECIPIENT_LABEL_RESET] as const;

export type PersonalRecipientLabelDetail = {
  recipientPartyId: string;
  personalName?: string;
  editorUserId?: string | null;
  editorDisplayName?: string | null;
};

export class PersonalRecipientNameValidationError extends Error {
  http = 400;
  constructor(message: string) {
    super(message);
    this.name = "PersonalRecipientNameValidationError";
  }
}

/** Trim, collapse spaces, 1..120 chars, no ASCII control chars. */
export function validatePersonalRecipientName(raw: unknown): string {
  const collapsed = String(raw ?? "")
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .trim()
    .replace(/\s+/g, " ");
  if (!collapsed) {
    throw new PersonalRecipientNameValidationError("Укажите имя получателя (от 1 до 120 символов).");
  }
  if (collapsed.length > 120) {
    throw new PersonalRecipientNameValidationError("Имя получателя не длиннее 120 символов.");
  }
  return collapsed;
}

type Db = Pool | PoolClient;

export async function insertPersonalRecipientLabelSet(
  client: PoolClient,
  input: {
    transferId: string;
    ownerPartyId: string;
    actorUserId: string | null;
    recipientPartyId: string;
    personalName: string;
    editorDisplayName: string;
  },
): Promise<void> {
  const personalName = validatePersonalRecipientName(input.personalName);
  const detail: PersonalRecipientLabelDetail = {
    recipientPartyId: input.recipientPartyId,
    personalName,
    editorUserId: input.actorUserId,
    editorDisplayName: input.editorDisplayName.slice(0, 200),
  };
  await client.query(
    `INSERT INTO tt_audit_log (transfer_id, actor_user_id, acting_party_id, action, detail)
     VALUES ($1, $2::uuid, $3::uuid, $4, $5::jsonb)`,
    [
      input.transferId,
      input.actorUserId,
      input.ownerPartyId,
      TT_PERSONAL_RECIPIENT_LABEL_SET,
      JSON.stringify(detail),
    ],
  );
}

export async function insertPersonalRecipientLabelReset(
  client: PoolClient,
  input: {
    transferId: string;
    ownerPartyId: string;
    actorUserId: string | null;
    recipientPartyId: string;
    editorDisplayName: string;
  },
): Promise<void> {
  const detail: PersonalRecipientLabelDetail = {
    recipientPartyId: input.recipientPartyId,
    editorUserId: input.actorUserId,
    editorDisplayName: input.editorDisplayName.slice(0, 200),
  };
  await client.query(
    `INSERT INTO tt_audit_log (transfer_id, actor_user_id, acting_party_id, action, detail)
     VALUES ($1, $2::uuid, $3::uuid, $4, $5::jsonb)`,
    [
      input.transferId,
      input.actorUserId,
      input.ownerPartyId,
      TT_PERSONAL_RECIPIENT_LABEL_RESET,
      JSON.stringify(detail),
    ],
  );
}

export async function loadPartyDisplayName(client: Db, partyId: string): Promise<string | null> {
  const res = await client.query<{ display_name: string }>(
    `SELECT display_name FROM tt_parties WHERE id = $1::uuid`,
    [partyId],
  );
  return res.rows[0]?.display_name ?? null;
}

export type ResolvedPersonalRecipientLabel = {
  recipientPartyId: string;
  personalName: string | null;
  editedAt: Date | null;
  editorUserId: string | null;
  editorDisplayName: string | null;
};

/** Latest label per recipient party for one owner on one transfer. */
export async function loadPersonalRecipientLabelsForTransfer(
  client: Db,
  transferId: string,
  ownerPartyId: string,
): Promise<Map<string, ResolvedPersonalRecipientLabel>> {
  const res = await client.query<{
    action: string;
    detail: PersonalRecipientLabelDetail;
    created_at: Date;
    actor_user_id: string | null;
  }>(
    `SELECT action, detail, created_at, actor_user_id::text
     FROM tt_audit_log
     WHERE transfer_id = $1 AND acting_party_id = $2::uuid
       AND action = ANY($3::text[])
     ORDER BY created_at DESC, id DESC`,
    [transferId, ownerPartyId, PRIVATE_ACTIONS],
  );
  const byRecipient = new Map<string, ResolvedPersonalRecipientLabel>();
  for (const row of res.rows) {
    const rid = String(row.detail?.recipientPartyId ?? "").trim();
    if (!rid || byRecipient.has(rid)) continue;
    if (row.action === TT_PERSONAL_RECIPIENT_LABEL_RESET) {
      byRecipient.set(rid, {
        recipientPartyId: rid,
        personalName: null,
        editedAt: row.created_at,
        editorUserId: row.detail.editorUserId ?? row.actor_user_id,
        editorDisplayName: row.detail.editorDisplayName ?? null,
      });
      continue;
    }
    const name = row.detail.personalName?.trim();
    if (!name) continue;
    byRecipient.set(rid, {
      recipientPartyId: rid,
      personalName: name,
      editedAt: row.created_at,
      editorUserId: row.detail.editorUserId ?? row.actor_user_id,
      editorDisplayName: row.detail.editorDisplayName ?? null,
    });
  }
  return byRecipient;
}

export async function loadPersonalRecipientLabelsForTransfers(
  client: Db,
  ownerPartyId: string,
  transferIds: string[],
): Promise<Map<string, Map<string, ResolvedPersonalRecipientLabel>>> {
  const out = new Map<string, Map<string, ResolvedPersonalRecipientLabel>>();
  if (!transferIds.length) return out;
  const res = await client.query<{
    transfer_id: string;
    action: string;
    detail: PersonalRecipientLabelDetail;
    created_at: Date;
    actor_user_id: string | null;
  }>(
    `SELECT transfer_id, action, detail, created_at, actor_user_id::text
     FROM tt_audit_log
     WHERE acting_party_id = $1::uuid
       AND transfer_id = ANY($2::text[])
       AND action = ANY($3::text[])
     ORDER BY transfer_id, created_at DESC, id DESC`,
    [ownerPartyId, transferIds, PRIVATE_ACTIONS],
  );
  const seen = new Map<string, Set<string>>();
  for (const row of res.rows) {
    const tid = row.transfer_id;
    const rid = String(row.detail?.recipientPartyId ?? "").trim();
    if (!tid || !rid) continue;
    let seenRecipients = seen.get(tid);
    if (!seenRecipients) {
      seenRecipients = new Set();
      seen.set(tid, seenRecipients);
    }
    if (seenRecipients.has(rid)) continue;
    seenRecipients.add(rid);
    let transferMap = out.get(tid);
    if (!transferMap) {
      transferMap = new Map();
      out.set(tid, transferMap);
    }
    if (row.action === TT_PERSONAL_RECIPIENT_LABEL_RESET) {
      transferMap.set(rid, {
        recipientPartyId: rid,
        personalName: null,
        editedAt: row.created_at,
        editorUserId: row.detail.editorUserId ?? row.actor_user_id,
        editorDisplayName: row.detail.editorDisplayName ?? null,
      });
      continue;
    }
    const name = row.detail.personalName?.trim();
    if (!name) continue;
    transferMap.set(rid, {
      recipientPartyId: rid,
      personalName: name,
      editedAt: row.created_at,
      editorUserId: row.detail.editorUserId ?? row.actor_user_id,
      editorDisplayName: row.detail.editorDisplayName ?? null,
    });
  }
  return out;
}

export function recipientPartyIdsForOrder(dto: TanTrackerOrderDto): string[] {
  const ids = new Set<string>();
  if (dto.finalRecipientId) ids.add(dto.finalRecipientId);
  if (dto.pendingId) ids.add(dto.pendingId);
  return [...ids];
}

export function attachPersonalRecipientViewsToOrder(
  dto: TanTrackerOrderDto,
  labels: Map<string, ResolvedPersonalRecipientLabel>,
  canonicalNames: Map<string, string>,
): void {
  const views: Record<string, TanTrackerPersonalRecipientViewDto> = {};
  for (const partyId of recipientPartyIdsForOrder(dto)) {
    const canonical = canonicalNames.get(partyId)?.trim() || "—";
    const label = labels.get(partyId);
    if (!label?.personalName) {
      if (label?.editedAt && label.personalName === null) {
        views[partyId] = {
          recipientPartyId: partyId,
          canonicalName: canonical,
          personalName: null,
          editedAt: label.editedAt.getTime(),
          editedByUserId: label.editorUserId,
          editedByDisplayName: label.editorDisplayName,
        };
      }
      continue;
    }
    views[partyId] = {
      recipientPartyId: partyId,
      canonicalName: canonical,
      personalName: label.personalName,
      editedAt: label.editedAt?.getTime() ?? null,
      editedByUserId: label.editorUserId,
      editedByDisplayName: label.editorDisplayName,
    };
  }
  if (Object.keys(views).length) {
    dto.personalRecipientViews = views;
  } else {
    delete dto.personalRecipientViews;
  }
}

export async function enrichOrdersWithPersonalRecipientLabels(
  client: Db,
  ownerPartyId: string | null,
  previewReadOnly: boolean,
  orders: TanTrackerOrderDto[],
  contactNameByPartyId: Map<string, string>,
): Promise<void> {
  if (!ownerPartyId || previewReadOnly || !orders.length) return;
  const transferIds = orders.map((o) => o.id);
  const labelMaps = await loadPersonalRecipientLabelsForTransfers(client, ownerPartyId, transferIds);
  for (const dto of orders) {
    const labels = labelMaps.get(dto.id) ?? new Map<string, ResolvedPersonalRecipientLabel>();
    const canonicalNames = new Map<string, string>();
    for (const pid of recipientPartyIdsForOrder(dto)) {
      canonicalNames.set(pid, contactNameByPartyId.get(pid)?.trim() || "—");
    }
    attachPersonalRecipientViewsToOrder(dto, labels, canonicalNames);
  }
}

export async function maybeSavePersonalRecipientLabelOnCreate(
  client: PoolClient,
  input: {
    transferId: string;
    ownerPartyId: string;
    actorUserId: string | null;
    actorDisplayName: string;
    recipientPartyId: string;
    personalNameRaw: string | null | undefined;
  },
): Promise<void> {
  const raw = input.personalNameRaw?.trim();
  if (!raw) return;
  await insertPersonalRecipientLabelSet(client, {
    transferId: input.transferId,
    ownerPartyId: input.ownerPartyId,
    actorUserId: input.actorUserId,
    recipientPartyId: input.recipientPartyId,
    personalName: raw,
    editorDisplayName: input.actorDisplayName,
  });
}
