import type { PoolClient } from "pg";
import { saveContactAlias, PRIVATE_EXTERNAL_RECIPIENT_DISPLAY_NAME } from "../../tan-tracker/contact-aliases";
import type { NativeCreateContext, NativeCreateReply } from "./engine";
import { renderDraftPrompt } from "./engine";
import { bumpDraftRevision, ensureNativeBotDraft, loadNativeBotDraft, type NativeCreateDraftPayload } from "./draft-scope";
import { currentParty, appendReceiptEntryChoices } from "./receipt-code-entry";
import { buildNativeMainMenuReply } from "./main-menu";
import { checkTransferCompletionAccess, completeTransferInTransaction } from "../../tan-tracker/legacy-complete-mutation";
import { assignPendingRecipientInTransaction } from "../../tan-tracker/pending-mutations";
import { resolveRecipientPartyId } from "../../tan-tracker/party-eligibility";
import { assertPhoneResolvedHolderPending } from "../../tan-tracker/public-holder-eligibility";
import { resolveNativeExternalPendingPartyByPhone } from "./native-external-recipient-by-phone";
import { loadAccessContext } from "../../access/context";
import type { UserRole } from "../../shared/user";
import { prepareNativeRecipientCodeDelivery } from "./invitation-handoff";
import { automaticReceiptSenderGuidance } from "../../tan-tracker/automatic-receipt-codes";
import { buildForwardInvitationGuidance } from "./forward-invitation-guidance";
import { markPendingObsoleteInTransaction, OBSOLETE_REASON } from "../../tan-tracker/pending-obsolete-mutation";

export type HolderActionTransfer = {
  id: string; public_code: string; item_title: string; status: string; holder_party_id: string;
  pending_party_id: string | null; final_recipient_party_id: string | null;
  handoff_version: number; row_version: number; allow_legacy_complete: boolean;
};

export function holderCompletionPermission(row: Pick<HolderActionTransfer,
  "status" | "holder_party_id" | "pending_party_id" | "final_recipient_party_id" | "allow_legacy_complete">) {
  return checkTransferCompletionAccess({
    status: row.status, actingPartyId: row.holder_party_id, holderPartyId: row.holder_party_id,
    pendingPartyId: row.pending_party_id, finalRecipientPartyId: row.final_recipient_party_id,
    allowLegacyComplete: row.allow_legacy_complete,
  });
}

export async function startNativeHolderAction(
  client: PoolClient, ctx: NativeCreateContext, row: HolderActionTransfer,
  kind: NonNullable<NativeCreateDraftPayload["holderAction"]>["kind"],
): Promise<NativeCreateReply> {
  const pendingAction = kind === "replace" || kind === "obsolete";
  if (pendingAction ? !row.pending_party_id : row.pending_party_id != null) {
    return { text: pendingAction ? "Ожидающий получатель уже изменился. Откройте трек заново."
      : "Сначала подтвердите текущую передачу получателю." };
  }
  if (kind === "complete") {
    const permission = holderCompletionPermission(row);
    if (!permission.ok) return { text: permission.message };
  }
  const actor = ctx.isLinkedStaff ? "staff" : "external";
  const existing = await loadNativeBotDraft(client, ctx.channel, ctx.messengerChatId, actor, { forUpdate: true });
  if (existing) return buildNativeMainMenuReply(client, ctx, {
    prefix: "У вас есть незаконченный черновик. Продолжите или отмените его через меню, затем откройте нужный трек.", lock: false,
  });
  const step = kind === "complete" || kind === "obsolete" ? "summary" : "recipient";
  const draft = await ensureNativeBotDraft(client, {
    channel: ctx.channel, messengerChatId: ctx.messengerChatId, actor,
    personId: ctx.personId, staffUserId: ctx.staffUserId ?? undefined, step,
  });
  const payload = await bumpDraftRevision(client, draft.id, step, {
    ...(draft.payload as NativeCreateDraftPayload), item: row.item_title, editReturnStep: "summary",
    holderAction: {
      kind, transferId: row.id, publicCode: row.public_code,
      handoffVersion: row.handoff_version, rowVersion: row.row_version,
    },
  });
  return renderDraftPrompt(client, ctx.channel, draft.id, step, payload, { telegramClearKeyboard: true });
}

/** Only a caller-bound persisted summary can confirm; every mutation is in the same savepoint. */
export async function confirmNativeHolderAction(
  client: PoolClient, ctx: NativeCreateContext, draftId: string, payload: NativeCreateDraftPayload,
): Promise<NativeCreateReply> {
  const action = payload.holderAction!;
  const partyId = await currentParty(client, ctx);
  if (!partyId) return { text: "Доступ изменился. Откройте главное меню и подтвердите профиль." };
  const row = (await client.query<HolderActionTransfer>(
    `SELECT * FROM tt_transfers WHERE id=$1 AND holder_party_id=$2::uuid
       AND handoff_version=$3 AND row_version=$4 AND status IN ('active','waiting','delivered')
       AND deleted_at IS NULL AND general_archived_at IS NULL FOR UPDATE`,
    [action.transferId, partyId, action.handoffVersion, action.rowVersion],
  )).rows[0];
  const pendingAction = action.kind === "replace" || action.kind === "obsolete";
  if (!row || (pendingAction ? !row.pending_party_id : row.pending_party_id != null)) return {
    text: "Передача уже изменилась или недоступна. Ничего не изменено. Отмените черновик и выберите актуальный трек в «Моих передачах».",
  };
  await client.query("SAVEPOINT native_holder_action");
  let forwardInvitationText: string | null = null;
  let automaticReceipt = false;
  try {
    if (action.kind === "obsolete") {
      await markPendingObsoleteInTransaction(client, {
        transferId: row.id, actorPartyId: partyId, auditUserId: ctx.isLinkedStaff ? ctx.staffUserId : null,
        expectedHandoffVersion: action.handoffVersion, expectedRowVersion: action.rowVersion,
      });
    } else if (action.kind === "complete") {
      const outcome = await completeTransferInTransaction(client, {
        transferId: row.id, actingPartyId: partyId, auditUserId: ctx.isLinkedStaff ? ctx.staffUserId : null,
        expectedHandoffVersion: action.handoffVersion, expectedRowVersion: action.rowVersion,
      });
      if (!outcome.ok) throw Object.assign(new Error(outcome.message), { http: outcome.http });
    } else {
      let pendingPartyId: string;
      if (ctx.isLinkedStaff && ctx.staffUserId) {
        const user = (await client.query<{ role: UserRole }>(
          `SELECT role FROM users WHERE id=$1::uuid AND status='active'`, [ctx.staffUserId],
        )).rows[0];
        if (!user) throw new Error("Профиль недоступен.");
        const access = await loadAccessContext(ctx.staffUserId, user.role, client);
        pendingPartyId = await resolveRecipientPartyId(client, access, ctx.staffUserId,
          payload.recipientPartyId ?? payload.recipientUserId, payload.recipientExternal);
      } else {
        const resolved = await resolveNativeExternalPendingPartyByPhone(client, {
          senderExternalPartyId: partyId, phoneE164: payload.externalRecipientPhone ?? "",
          externalRecipient: {
            name: payload.externalRecipientDisplayName?.trim() ? PRIVATE_EXTERNAL_RECIPIENT_DISPLAY_NAME : "",
            phone: payload.externalRecipientPhone ?? "",
          },
        });
        pendingPartyId = resolved.pendingPartyId;
        await assertPhoneResolvedHolderPending(client, partyId, pendingPartyId);
      }
      if (action.kind === "replace" && pendingPartyId === row.pending_party_id) {
        throw Object.assign(new Error("Выбран прежний получатель. Выберите другого или отмените изменение."), { http: 400 });
      }
      await assignPendingRecipientInTransaction(client, {
        transferId: row.id, holderPartyId: partyId, pendingPartyId,
        auditUserId: ctx.isLinkedStaff ? ctx.staffUserId : null,
        expectedHandoffVersion: action.handoffVersion, expectedRowVersion: action.rowVersion,
        requireNoPending: action.kind === "forward", replaceUnreceivedFinal: action.kind === "replace",
      });
      await saveContactAlias(client, partyId, ctx.isLinkedStaff ? ctx.staffUserId : null, pendingPartyId,
        ctx.isLinkedStaff ? payload.recipientExternal?.name : payload.externalRecipientDisplayName);
      if (action.kind === "replace") {
        await client.query("DELETE FROM tt_bot_receipt_code_entries WHERE transfer_id=$1", [row.id]);
      }
      const delivery = await prepareNativeRecipientCodeDelivery(client, {
        transferId: row.id, pendingPartyId, handoffVersion: row.handoff_version + 1,
        channel: ctx.channel, allowUserParty: true,
      });
      automaticReceipt = delivery.automaticReceipt;
      forwardInvitationText = delivery.forwardInvitationText ?? null;
      if (!automaticReceipt && !forwardInvitationText) throw new Error("Не удалось подготовить приглашение.");
    }
    await client.query(
      `UPDATE tt_external_request_drafts SET confirmed_transfer_id=$2, step='done', updated_at=NOW()
       WHERE id=$1::uuid`, [draftId, row.id],
    );
    await client.query("RELEASE SAVEPOINT native_holder_action");
  } catch (err) {
    await client.query("ROLLBACK TO SAVEPOINT native_holder_action");
    await client.query("RELEASE SAVEPOINT native_holder_action");
    const http = (err as { http?: number }).http;
    return { text: http && [400, 403, 404, 409].includes(http) && err instanceof Error ? err.message
      : "Не удалось выполнить действие. Изменения не сохранены. Попробуйте снова через «Мои передачи»." };
  }
  if (action.kind === "obsolete") return buildNativeMainMenuReply(client, ctx, {
    prefix: `Трек ${row.public_code}: Неактуален.\n${OBSOLETE_REASON}`, lock: false,
  });
  if (action.kind === "complete") return buildNativeMainMenuReply(client, ctx, {
    prefix: `Трек ${row.public_code} завершён.\nЗадача выполнена. История сохранена в личном кабинете.`, lock: false,
  });
  return appendReceiptEntryChoices(client, ctx, {
    text: automaticReceipt ? automaticReceiptSenderGuidance(row.public_code, true)
      : buildForwardInvitationGuidance(row.public_code, true),
    ...(forwardInvitationText ? { forwardInvitationText } : {}),
  }, row.public_code);
}
