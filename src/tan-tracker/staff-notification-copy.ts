/** LK + messenger copy for staff tan_tracker.* events (never include OTP / handoff codes). */

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
};

export function staffNotificationLkCopy(
  eventType: StaffTransferEventType,
  payload: StaffNotificationPayload,
): { title: string; body: string } {
  const item = payload.itemTitle.trim() || "Передача";
  const code = payload.publicCode;
  const body = `${item} (${code})`;
  switch (eventType) {
    case "tan_tracker.assignment":
      return { title: "Вам назначена передача", body };
    case "tan_tracker.external_created":
      return { title: "Вам передают от клиента", body: item };
    case "tan_tracker.external_declined":
      return {
        title: "Заявка отклонена",
        body: payload.reason ? `${item}: ${payload.reason}` : item,
      };
    case "tan_tracker.code_obtained":
      return { title: "Получатель запросил код", body };
    case "tan_tracker.handoff_confirmed":
      return { title: "Передача подтверждена", body };
    case "tan_tracker.delivered":
      return { title: "Доставлено конечному получателю", body };
    case "tan_tracker.continued":
      return { title: "Назначен следующий получатель", body };
    case "tan_tracker.pending_cancelled":
      return { title: "Ожидание передачи отменено", body };
    case "tan_tracker.returned":
      return { title: "Возврат создателю", body };
    case "tan_tracker.closed":
      return { title: "Передача завершена", body };
    default:
      return { title: "Тан-трекер", body };
  }
}

export function staffNotificationMessengerText(
  eventType: StaffTransferEventType,
  payload: StaffNotificationPayload,
  appOrigin: string,
): string {
  const lk = staffNotificationLkCopy(eventType, payload);
  const url = `${appOrigin.replace(/\/$/, "")}/tan-tracker`;
  return `Тан-трекер: ${lk.title}. «${payload.itemTitle || "Передача"}» (${payload.publicCode}).\nОткрыть: ${url}`;
}
