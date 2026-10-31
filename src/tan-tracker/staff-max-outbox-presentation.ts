import type { MaxInlineButton } from "../tanbot-max/delivery-transport";
import { isTanbotHandoffCodePilotEnabled } from "../tanbot/handoff-code-pilot-config";
import { buildHandoffGenCallback } from "../tanbot/handoff-code-bot-service";
import { buildReceiptEntryCallback } from "../tanbot/receipt-entry-callback";
import { NATIVE_SENDER_HANDOFF_GUIDANCE } from "./sender-handoff-guidance";
import { staffNotificationContextBlock } from "./staff-notification-copy";
import {
  buildStaffExternalCreatedNoticeText,
  normalizeStaffOutboxPayload,
  staffTransferLkDetailUrl,
} from "./staff-outbox-shared";
import {
  buildTanTrackerStaffOutboxMessage,
  isTanTrackerStaffOutboxEvent,
} from "./tan-tracker-outbox-messages";

export type StaffMaxOutboxDelivery = {
  text: string;
  inlineButtons?: MaxInlineButton[][];
  shareUrl?: string;
};

export { staffTransferLkDetailUrl, buildStaffExternalCreatedNoticeText as buildStaffExternalCreatedMaxText };

export function buildTanTrackerStaffMaxOutboxDelivery(
  eventType: string,
  payload: Record<string, unknown>,
  appOrigin: string,
): StaffMaxOutboxDelivery {
  if (!isTanTrackerStaffOutboxEvent(eventType)) {
    return { text: "Уведомление Тандор." };
  }

  if (eventType === "tan_tracker.external_created") {
    const p = normalizeStaffOutboxPayload(payload);
    const pilot = isTanbotHandoffCodePilotEnabled();
    const text = buildStaffExternalCreatedNoticeText(p, pilot);
    if (pilot && p.publicCode && p.handoffVersion > 0) {
      return {
        text,
        inlineButtons: [
          [
            {
              type: "callback",
              text: "Получить код приёма",
              payload: buildHandoffGenCallback(p.publicCode, p.handoffVersion),
            },
          ],
        ],
      };
    }
    const detailUrl = staffTransferLkDetailUrl(appOrigin, p.publicCode);
    return {
      text: `${text}\n${detailUrl}`,
    };
  }

  if (eventType === "tan_tracker.code_obtained") {
    const p = normalizeStaffOutboxPayload(payload);
    const callback = buildReceiptEntryCallback("code", p.transferId || p.publicCode, p.handoffVersion);
    if (callback) return {
      text: `${staffNotificationContextBlock(p)}\n\nПолучатель запросил код приёма.\n\n${NATIVE_SENDER_HANDOFF_GUIDANCE}`,
      inlineButtons: [[{ type: "callback", text: "Ввести код", payload: callback }]],
    };
    return {
      text: buildTanTrackerStaffOutboxMessage(eventType, payload, appOrigin),
      inlineButtons: [[{ type: "link", text: "Открыть передачу",
        url: staffTransferLkDetailUrl(appOrigin, p.publicCode) }]],
    };
  }

  return {
    text: buildTanTrackerStaffOutboxMessage(eventType, payload, appOrigin),
  };
}
