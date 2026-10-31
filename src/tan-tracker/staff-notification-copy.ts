/** LK + messenger copy for staff tan_tracker.* events (never include OTP / handoff codes). */

import { formatTransferContextHeader, staffTransferLkDetailUrl } from "./staff-notification-route";
import { SENDER_HANDOFF_GUIDANCE } from "./sender-handoff-guidance";
import { formatNotificationTransferState, type NotificationTransferState } from "./notification-transfer-state";

export type StaffTransferEventType =
  | "tan_tracker.assignment"
  | "tan_tracker.external_created"
  | "tan_tracker.external_declined"
  | "tan_tracker.code_obtained"
  | "tan_tracker.handoff_confirmed"
  | "tan_tracker.delivered"
  | "tan_tracker.continued"
  | "tan_tracker.pending_cancelled"
  | "tan_tracker.returned"
  | "tan_tracker.closed";

export type StaffNotificationPayload = {
  transferId: string;
  publicCode: string;
  itemTitle: string;
  handoffVersion: number;
  reason?: string | null;
  routeFromDisplayName?: string;
  routeToDisplayName?: string;
  notificationState?: NotificationTransferState;
};

function eventActionLine(eventType: StaffTransferEventType, payload: StaffNotificationPayload): string {
  switch (eventType) {
    case "tan_tracker.assignment":
      return payload.notificationState?.phase === "received"
        ? "Вы получили предмет. Теперь вы отвечаете за дальнейшие действия с передачей."
        : payload.notificationState?.phase === "waiting"
          ? "Вам назначена передача. Получите код приёма и сообщите его отправителю."
          : "Вам назначена передача.";
    case "tan_tracker.external_created":
      return "Вам передают от клиента.";
    case "tan_tracker.external_declined":
      return payload.reason ? `Заявка отклонена: ${payload.reason}` : "Заявка отклонена.";
    case "tan_tracker.code_obtained":
      return `Получатель запросил код приёма.\n\n${SENDER_HANDOFF_GUIDANCE}`;
    case "tan_tracker.handoff_confirmed":
      return "Предмет принят новым держателем. Предыдущий отправитель выполнил свой этап.";
    case "tan_tracker.delivered":
      return "Предмет принят конечным получателем. Получение не завершает трек автоматически.";
    case "tan_tracker.continued":
      return "Назначен следующий получатель.";
    case "tan_tracker.pending_cancelled":
      return "Ожидание приёма отменено. Предмет остаётся у текущего держателя.";
    case "tan_tracker.returned":
      return "Назначен возврат создателю. До подтверждения приёма ответственный не меняется.";
    case "tan_tracker.closed":
      return "Передача завершена.";
    default:
      return "Событие Тан-трекера.";
  }
}

export function staffNotificationContextBlock(payload: StaffNotificationPayload): string {
  const context = formatTransferContextHeader({
    publicCode: payload.publicCode,
    itemTitle: payload.itemTitle,
    routeFromDisplayName: payload.routeFromDisplayName,
    routeToDisplayName: payload.routeToDisplayName,
  });
  const state = formatNotificationTransferState(payload.notificationState);
  return state ? `${context}\n\n${state}` : context;
}

export function staffNotificationLkCopy(
  eventType: StaffTransferEventType,
  payload: StaffNotificationPayload,
): { title: string; body: string } {
  const item = payload.itemTitle.trim() || "Передача";
  const code = payload.publicCode;
  const ctx = staffNotificationContextBlock(payload);
  const action = eventActionLine(eventType, payload);
  switch (eventType) {
    case "tan_tracker.assignment":
      return { title: "Вам назначена передача", body: `${ctx}\n\n${action}` };
    case "tan_tracker.external_created":
      return { title: "Вам передают от клиента", body: `${ctx}\n\n${action}` };
    case "tan_tracker.external_declined":
      return { title: "Заявка отклонена", body: `${ctx}\n\n${action}` };
    case "tan_tracker.code_obtained":
      return { title: "Получатель запросил код", body: `${ctx}\n\n${action}` };
    case "tan_tracker.handoff_confirmed":
      return { title: "Получение подтверждено", body: `${ctx}\n\n${action}` };
    case "tan_tracker.delivered":
      return { title: "Получение подтверждено", body: `${ctx}\n\n${action}` };
    case "tan_tracker.continued":
      return { title: "Назначен следующий получатель", body: `${ctx}\n\n${action}` };
    case "tan_tracker.pending_cancelled":
      return { title: "Ожидание передачи отменено", body: `${ctx}\n\n${action}` };
    case "tan_tracker.returned":
      return { title: "Возврат создателю", body: `${ctx}\n\n${action}` };
    case "tan_tracker.closed":
      return { title: "Завершена", body: `${ctx}\n\n${action}` };
    default:
      return { title: "Тан-трекер", body: `${item} (${code})` };
  }
}

export function staffNotificationMessengerText(
  eventType: StaffTransferEventType,
  payload: StaffNotificationPayload,
  appOrigin: string,
): string {
  const lk = staffNotificationLkCopy(eventType, payload);
  const url = eventType === "tan_tracker.code_obtained"
    ? staffTransferLkDetailUrl(appOrigin, payload.publicCode)
    : `${appOrigin.replace(/\/$/, "")}/tan-tracker`;
  return `${lk.body}\n\nОткрыть: ${url}`;
}
