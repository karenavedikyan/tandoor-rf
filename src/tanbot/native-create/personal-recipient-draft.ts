import type { NativeCreateDraftPayload } from "./draft-scope";

export function boundRecipientPartyIdForPersonalLabel(
  payload: NativeCreateDraftPayload,
): string | undefined {
  if (payload.recipientPersonalLabelPartyId) return payload.recipientPersonalLabelPartyId;
  return payload.recipientPartyId ?? payload.recipientUserId;
}

export function syncPersonalLabelPartyBinding(
  payload: NativeCreateDraftPayload,
  partyId: string | undefined,
): void {
  if (!partyId) return;
  if (
    payload.recipientPersonalLabelPartyId &&
    payload.recipientPersonalLabelPartyId !== partyId
  ) {
    delete payload.recipientPersonalNameForMe;
  }
  payload.recipientPersonalLabelPartyId = partyId;
}

export function personalNameForNativeCreate(payload: NativeCreateDraftPayload): string | undefined {
  const raw = payload.recipientPersonalNameForMe?.trim();
  return raw || undefined;
}

export function canonicalRecipientSummaryLine(payload: NativeCreateDraftPayload): string {
  if (payload.actor === "external") {
    const phone = payload.externalRecipientPhone?.trim();
    const canonical =
      payload.recipientDisplayName?.trim() ||
      payload.externalRecipientDisplayName?.trim() ||
      (phone ? phone : "—");
    return phone ? `${canonical} (${phone})` : canonical;
  }
  const name = payload.recipientDisplayName ?? payload.recipientExternal?.name ?? "—";
  const phone = payload.recipientExternal?.phone?.trim();
  if (phone && payload.recipientPartyId == null && payload.recipientUserId == null) {
    return `${name} (${phone})`;
  }
  return name;
}
