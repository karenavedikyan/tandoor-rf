import type { MaxInlineButton } from "../tanbot-max/delivery-transport";
import { isTanbotHandoffCodePilotEnabled } from "../tanbot/handoff-code-pilot-config";
import { buildHandoffGenCallback } from "../tanbot/handoff-code-bot-service";
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
    const text = buildStaffExternalCreatedNoticeText(p.itemTitle, p.publicCode, pilot);
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

  return {
    text: buildTanTrackerStaffOutboxMessage(eventType, payload, appOrigin),
  };
}
