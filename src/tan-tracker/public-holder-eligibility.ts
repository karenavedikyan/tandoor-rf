import type { Pool, PoolClient } from "pg";
import { isUuid } from "./phone-normalize";
import {
  resolveExternalRecipientPartyId,
  type ExternalRecipientInput,
} from "./party-eligibility";
import { resolvePublicHolderPendingPartyByPhoneForExternalActor } from "../tanbot/native-create/native-external-recipient-by-phone";

type Db = Pool | PoolClient;

export async function loadPublicHolderCreatorUserId(
  client: Db,
  transferId: string,
): Promise<string | null> {
  const row = (
    await client.query<{ user_id: string | null }>(
      `SELECT p.user_id::text
       FROM tt_transfers t
       JOIN tt_parties p ON p.id = t.creator_party_id
       WHERE t.id = $1
       LIMIT 1`,
      [transferId],
    )
  ).rows[0];
  return row?.user_id ?? null;
}

export async function assertPublicHolderPendingEligible(
  client: Db,
  transferId: string,
  holderPartyId: string,
  pendingPartyId: string,
): Promise<void> {
  if (!isUuid(pendingPartyId)) {
    throw Object.assign(new Error("Некорректный получатель."), { http: 400 });
  }
  if (pendingPartyId === holderPartyId) {
    throw Object.assign(new Error("Нельзя передать самому себе."), { http: 400 });
  }
  const transfer = (
    await client.query<{
      final_recipient_party_id: string | null;
      creator_party_id: string;
      pending_party_id: string | null;
    }>(
      `SELECT final_recipient_party_id, creator_party_id, pending_party_id FROM tt_transfers WHERE id = $1 LIMIT 1`,
      [transferId],
    )
  ).rows[0];
  if (!transfer) {
    throw Object.assign(new Error("Передача не найдена."), { http: 404 });
  }
  const allowed = new Set<string>(
    [transfer.final_recipient_party_id, transfer.creator_party_id, transfer.pending_party_id].filter(
      Boolean,
    ) as string[],
  );
  const timeline = await client.query<{ from_party_id: string | null; to_party_id: string | null }>(
    `SELECT from_party_id, to_party_id FROM tt_transfer_timeline WHERE transfer_id = $1`,
    [transferId],
  );
  for (const t of timeline.rows) {
    if (t.from_party_id) allowed.add(t.from_party_id);
    if (t.to_party_id) allowed.add(t.to_party_id);
  }
  if (allowed.has(pendingPartyId)) return;

  const creatorUserId = await loadPublicHolderCreatorUserId(client, transferId);
  if (!creatorUserId) {
    throw Object.assign(new Error("Получатель недоступен для этой передачи."), { http: 403 });
  }
  const ext = (
    await client.query<{ id: string }>(
      `SELECT id::text FROM tt_parties WHERE id = $1::uuid AND kind = 'external' LIMIT 1`,
      [pendingPartyId],
    )
  ).rows[0];
  if (ext) return;

  throw Object.assign(new Error("Получатель недоступен для этой передачи."), { http: 403 });
}

/** After phone resolver for external creator (no staff user): pending from scoped phone match only. */
export async function assertNullCreatorPhoneResolvedPending(
  client: Db,
  holderPartyId: string,
  pendingPartyId: string,
): Promise<void> {
  if (!isUuid(pendingPartyId)) {
    throw Object.assign(new Error("Некорректный получатель."), { http: 400 });
  }
  if (pendingPartyId === holderPartyId) {
    throw Object.assign(new Error("Нельзя передать самому себе."), { http: 400 });
  }
  const row = (
    await client.query<{ kind: string }>(
      `SELECT kind FROM tt_parties WHERE id = $1::uuid LIMIT 1`,
      [pendingPartyId],
    )
  ).rows[0];
  if (row?.kind !== "external" && row?.kind !== "user") {
    throw Object.assign(new Error("Получатель недоступен для этой передачи."), { http: 403 });
  }
}

export async function resolvePublicHolderPendingPartyId(
  client: Db,
  transferId: string,
  holderPartyId: string,
  pendingPartyId: string | undefined,
  external: ExternalRecipientInput | undefined,
): Promise<string> {
  if (external && (external.name || external.phone)) {
    const creatorUserId = await loadPublicHolderCreatorUserId(client, transferId);
    const id = creatorUserId
      ? await resolveExternalRecipientPartyId(client, creatorUserId, external)
      : await resolvePublicHolderPendingPartyByPhoneForExternalActor(client, {
          holderPartyId,
          phoneE164: external.phone,
          externalRecipient: external,
        });
    if (creatorUserId) {
      await assertPublicHolderPendingEligible(client, transferId, holderPartyId, id);
    } else {
      await assertNullCreatorPhoneResolvedPending(client, holderPartyId, id);
    }
    return id;
  }
  const resolved = String(pendingPartyId ?? "").trim();
  if (!resolved) {
    throw Object.assign(new Error("Выберите получателя."), { http: 400 });
  }
  await assertPublicHolderPendingEligible(client, transferId, holderPartyId, resolved);
  return resolved;
}
