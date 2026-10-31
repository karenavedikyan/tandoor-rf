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

export type StaffTelegramOutboxSendBody = {
  text: string;
  disable_web_page_preview?: boolean;
  reply_markup?: {
    inline_keyboard: Array<Array<{ text: string; callback_data: string }>>;
  };
};

export function buildTanTrackerStaffTelegramOutboxSendBody(
  eventType: string,
  payload: Record<string, unknown>,
  appOrigin: string,
): StaffTelegramOutboxSendBody {
  if (!isTanTrackerStaffOutboxEvent(eventType)) {
    return { text: "Уведомление Тандор.", disable_web_page_preview: true };
  }

  if (eventType === "tan_tracker.external_created") {
    const p = normalizeStaffOutboxPayload(payload);
    const pilot = isTanbotHandoffCodePilotEnabled();
    const text = buildStaffExternalCreatedNoticeText(p.itemTitle, p.publicCode, pilot);
    if (pilot && p.publicCode && p.handoffVersion > 0) {
      return {
        text,
        disable_web_page_preview: true,
        reply_markup: {
          inline_keyboard: [
            [{ text: "Получить код приёма", callback_data: buildHandoffGenCallback(p.publicCode, p.handoffVersion) }],
          ],
        },
      };
    }
    const detailUrl = staffTransferLkDetailUrl(appOrigin, p.publicCode);
    return {
      text: `${text}\n${detailUrl}`,
      disable_web_page_preview: true,
    };
  }

  const text = buildTanTrackerStaffOutboxMessage(eventType, payload, appOrigin);
  return {
    text,
    disable_web_page_preview: true,
  };
}
