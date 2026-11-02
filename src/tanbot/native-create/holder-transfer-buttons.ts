import type { TanTrackerTransferRow } from "../../tan-tracker/types";
import { checkTransferCompletionAccess } from "../../tan-tracker/legacy-complete-mutation";
import { buildReceiptEntryCallback } from "../receipt-entry-callback";

type HolderTransferButtonRow = Pick<TanTrackerTransferRow,
  "id" | "holder_party_id" | "pending_party_id" | "final_recipient_party_id" |
  "allow_legacy_complete" | "handoff_version" | "deleted_at" | "general_archived_at"
> & { status: string };

/** Shared presentation only. Existing callbacks recheck live identity, ownership and version. */
export function holderTransferActionButtons(
  row: HolderTransferButtonRow, actorPartyId: string | null,
): Array<{ text: string; data: string }> {
  if (!actorPartyId || row.holder_party_id !== actorPartyId || row.pending_party_id
    || row.deleted_at || row.general_archived_at || !["active", "waiting", "delivered"].includes(row.status)) {
    return [];
  }
  const forward = buildReceiptEntryCallback("forward", row.id, row.handoff_version);
  const buttons = forward ? [{ text: "Передать дальше", data: forward }] : [];
  if (checkTransferCompletionAccess({
    status: row.status, actingPartyId: actorPartyId, holderPartyId: row.holder_party_id,
    pendingPartyId: row.pending_party_id, finalRecipientPartyId: row.final_recipient_party_id,
    allowLegacyComplete: row.allow_legacy_complete,
  }).ok) {
    const close = buildReceiptEntryCallback("close", row.id, row.handoff_version);
    if (close) buttons.push({ text: "Завершить трек", data: close });
  }
  return buttons;
}
