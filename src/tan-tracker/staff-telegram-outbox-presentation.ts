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
    const code = p.publicCode.trim();
    const callbackData = buildHandoffGenCallback(code, p.handoffVersion);
    if (pilot && code && code.length <= 32 && !code.includes(":") &&
        Number.isSafeInteger(p.handoffVersion) && p.handoffVersion > 0 &&
        Buffer.byteLength(callbackData, "utf8") <= 64) {
      return {
        text: buildStaffExternalCreatedNoticeText(p, true),
        disable_web_page_preview: true,
        reply_markup: {
          inline_keyboard: [
            [{ text: "Получить код приёма", callback_data: callbackData }],
          ],
        },
      };
    }
    const detailUrl = staffTransferLkDetailUrl(appOrigin, p.publicCode);
    return {
      text: `${buildStaffExternalCreatedNoticeText(p, false)}\n${detailUrl}`,
      disable_web_page_preview: true,
    };
  }

  const text = buildTanTrackerStaffOutboxMessage(eventType, payload, appOrigin);
  return {
    text,
    disable_web_page_preview: true,
  };
}
