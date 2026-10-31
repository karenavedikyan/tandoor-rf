import { formatTransferContextHeader } from "../staff-notification-route";
import { formatNotificationTransferState, type NotificationTransferState } from "../notification-transfer-state";

export type ExternalPersonMessengerEvent =
  | "declined"
  | "after_code"
  | "after_receipt"
  | "delivered"
  | "closed"
  | "handoff_code";

function externalContextBlock(input: {
  publicCode: string;
  itemTitle: string;
  routeFromDisplayName?: string | null;
  routeToDisplayName?: string | null;
}): string {
  return formatTransferContextHeader({
    publicCode: input.publicCode,
    itemTitle: input.itemTitle,
    routeFromDisplayName: input.routeFromDisplayName,
    routeToDisplayName: input.routeToDisplayName,
  });
}

function buildReceivedTransferMessengerBody(title: string, publicCode: string, holderUrl?: string | null): string {
  const lines = [
    `Вы получили «${title}».`,
    "",
    "Откройте передачу, чтобы посмотреть историю, передать предмет дальше или вернуть отправителю.",
    "",
    `Передача ${publicCode}.`,
  ];
  if (holderUrl) {
    lines.push(`Открыть: ${holderUrl}`);
  }
  return lines.join("\n");
}

export function buildExternalPersonMessengerBody(input: {
  event: ExternalPersonMessengerEvent;
  publicCode: string;
  itemTitle: string;
  holderUrl?: string | null;
  shellUrl?: string | null;
  extraLine?: string;
  routeFromDisplayName?: string | null;
  routeToDisplayName?: string | null;
  notificationState?: NotificationTransferState;
}): string {
  const title = input.itemTitle.trim() || "Передача";
  const code = input.publicCode;
  const link = input.holderUrl || input.shellUrl;
  const linkLine = link ? `\nОткрыть: ${link}` : "";
  const state = formatNotificationTransferState(input.notificationState);
  const ctx = [externalContextBlock(input), state].filter(Boolean).join("\n\n");
  switch (input.event) {
    case "declined":
      return (
        `${ctx}\n\n` +
        (input.extraLine ? `${input.extraLine}\n` : "") +
        `Заявка отклонена.`
      );
    case "handoff_code":
      return (
        `${ctx}\n\n` +
        `Код для передачи ${code}: ${input.extraLine ?? ""}`.trim() +
        "\nСообщите код держателю лично. Код одноразовый. Выдача кода ещё не подтверждает получение."
      );
    case "after_code":
      return `${ctx}\n\nКод подтверждён, предмет передан дальше. Ваш этап завершён, ответственность перешла новому держателю.${linkLine}`;
    case "after_receipt":
      return `${ctx}\n\nВы получили «${title}».\n\nОткройте передачу, чтобы посмотреть историю, передать предмет дальше или вернуть отправителю.${linkLine}`;
    case "delivered":
      return `${ctx}\n\nВы получили «${title}».\n\nОткройте передачу, чтобы посмотреть историю, передать предмет дальше или вернуть отправителю.${linkLine}`;
    case "closed":
      return `${ctx}\n\nПередача завершена.${linkLine}`;
    default:
      return `${ctx}\n\nТан-трекер.${linkLine}`;
  }
}
