import type { StaffTransferEventType } from "./staff-notification-copy";
import { staffNotificationMessengerText, type StaffNotificationPayload } from "./staff-notification-copy";
import { normalizeNotificationTransferState } from "./notification-transfer-state";

const TAN_TRACKER_EVENT_PREFIX = "tan_tracker.";

export function isTanTrackerStaffOutboxEvent(eventType: string): eventType is StaffTransferEventType {
  return eventType.startsWith(TAN_TRACKER_EVENT_PREFIX);
}

export function buildTanTrackerStaffOutboxMessage(
  eventType: StaffTransferEventType,
  payload: Record<string, unknown>,
  appOrigin: string,
): string {
  const normalized: StaffNotificationPayload = {
    transferId: String(payload.transferId ?? ""),
    publicCode: String(payload.publicCode ?? ""),
    itemTitle: String(payload.itemTitle ?? "Передача"),
    handoffVersion: Number(payload.handoffVersion ?? 0),
    notificationState: normalizeNotificationTransferState(payload.notificationState),
    reason: payload.reason != null ? String(payload.reason) : null,
    routeFromDisplayName:
      typeof payload.routeFromDisplayName === "string" && payload.routeFromDisplayName.trim()
        ? payload.routeFromDisplayName.trim()
        : undefined,
    routeToDisplayName:
      typeof payload.routeToDisplayName === "string" && payload.routeToDisplayName.trim()
        ? payload.routeToDisplayName.trim()
        : undefined,
  };
  const text = staffNotificationMessengerText(eventType, normalized, appOrigin);
  if (/\d{6}/.test(text)) {
    throw new Error("Staff notification must not contain OTP-like codes");
  }
  return text;
}
