import type { MaxInlineButton } from "../tanbot-max/delivery-transport";
import { isTanbotHandoffCodePilotEnabled } from "../tanbot/handoff-code-pilot-config";
import { buildHandoffGenCallback } from "../tanbot/handoff-code-bot-service";
import type { StaffTransferEventType } from "./staff-notification-copy";
import {
  buildTanTrackerStaffOutboxMessage,
  isTanTrackerStaffOutboxEvent,
} from "./tan-tracker-outbox-messages";

export type StaffMaxOutboxDelivery = {
  text: string;
  inlineButtons?: MaxInlineButton[][];
  shareUrl?: string;
};

function normalizePayload(payload: Record<string, unknown>) {
  return {
    transferId: String(payload.transferId ?? ""),
    publicCode: String(payload.publicCode ?? ""),
    itemTitle: String(payload.itemTitle ?? "Передача"),
    handoffVersion: Number(payload.handoffVersion ?? 0),
  };
}

/** Deep link to LK transfer card (fallback when handoff-code pilot is off). */
export function staffTransferLkDetailUrl(appOrigin: string, publicCode: string): string {
  const base = appOrigin.replace(/\/$/, "");
  const params = new URLSearchParams();
  params.set("tt_screen", "detail");
  params.set("tt_id", publicCode);
  return `${base}/tan-tracker#?${params.toString()}`;
}

export function buildStaffExternalCreatedMaxText(
  itemTitle: string,
  publicCode: string,
  pilotEnabled: boolean,
): string {
  const item = itemTitle.trim() || "Передача";
  if (pilotEnabled) {
    return (
      `Тан-трекер: клиент отправил заявку «${item}» (${publicCode}).\n` +
      `Получите одноразовый код приёма кнопкой ниже и сообщите его отправителю для подтверждения в Тан-трекере.`
    );
  }
  return (
    `Тан-трекер: клиент отправил заявку «${item}» (${publicCode}).\n` +
    `Откройте передачу в личном кабинете, чтобы принять заявку или получить код приёма.`
  );
}

export function buildTanTrackerStaffMaxOutboxDelivery(
  eventType: string,
  payload: Record<string, unknown>,
  appOrigin: string,
): StaffMaxOutboxDelivery {
  if (!isTanTrackerStaffOutboxEvent(eventType)) {
    return { text: "Уведомление Тандор." };
  }

  if (eventType === "tan_tracker.external_created") {
    const p = normalizePayload(payload);
    const pilot = isTanbotHandoffCodePilotEnabled();
    const text = buildStaffExternalCreatedMaxText(p.itemTitle, p.publicCode, pilot);
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
