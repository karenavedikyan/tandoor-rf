import { buildNativeCreateCallback } from "../tanbot/native-create/callback-codec";
import { NATIVE_MENU_DRAFT_HEX } from "../tanbot/native-create/menu-sentinel";
import { buildReceiptEntryCallback } from "../tanbot/receipt-entry-callback";
import { normalizeNotificationTransferState } from "./notification-transfer-state";

/** Frozen audience is presentation only; the callback rechecks the live holder. */
export function receivedTrackStaffCallback(event: string, payload: Record<string, unknown>): string | null {
  const state = normalizeNotificationTransferState(payload.notificationState);
  const receivedAssignment = event === "tan_tracker.assignment" && state?.phase === "received";
  const receivedEvent = ["tan_tracker.handoff_confirmed", "tan_tracker.delivered"].includes(event)
    && payload.receiptAudience === "recipient" && (!state || state.phase === "received");
  if (!receivedAssignment && !receivedEvent) return null;
  return buildReceiptEntryCallback("pick", String(payload.transferId ?? payload.publicCode ?? ""),
    Number(payload.handoffVersion ?? 0));
}

/** No identity/track is inferred: this only opens the authenticated holder list. */
export function receivedTrackMenuCallback(body: string): string | null {
  return body.replace(/\r\n/g, "\n").startsWith("ГОТОВО ✅\n\nВам передали ")
    ? buildNativeCreateCallback("menu_my", NATIVE_MENU_DRAFT_HEX, 1) : null;
}
