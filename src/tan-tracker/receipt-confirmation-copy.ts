import { sanitizeNotificationDisplayName } from "./staff-notification-route";
import { formatNotificationTransferState, type NotificationTransferState } from "./notification-transfer-state";

/** Presentation only, frozen at event creation. Never authorizes a transfer action. */
export type ReceiptAudience = "recipient" | "sender" | "observer";

export function formatReceiptConfirmation(input: {
  publicCode: string;
  itemTitle: string;
  routeFromDisplayName?: string | null;
  routeToDisplayName?: string | null;
  notificationState?: NotificationTransferState;
  audience?: ReceiptAudience;
}): string {
  const item = sanitizeNotificationDisplayName(input.itemTitle);
  const object = item ? `«${item}»` : "предмет";
  const from = sanitizeNotificationDisplayName(input.routeFromDisplayName);
  const to = sanitizeNotificationDisplayName(input.routeToDisplayName);
  const lead = input.audience === "recipient" ? `Вам передали ${object}.`
    : input.audience === "sender" ? `Вы передали ${object}.`
      : `Получение ${object} подтверждено.`;
  const state = formatNotificationTransferState(input.notificationState) || "Статус: Получение подтверждено";
  const action = input.audience === "recipient"
    ? "Откройте передачу, чтобы посмотреть историю, передать предмет дальше или вернуть отправителю."
    : input.audience === "sender"
      ? "Код подтверждён. Ваш этап завершён, ответственность перешла новому держателю."
      : "Предмет у получателя. При необходимости он может передать его дальше.";
  return [
    "ГОТОВО ✅", "", lead,
    `Передача ${input.publicCode.trim() || "без номера"}`,
    ...(from ? [`От: ${from}`] : []),
    ...(to ? [`Кому: ${to}`] : []),
    "", "Статус и детали:", state, "", action,
  ].join("\n");
}
