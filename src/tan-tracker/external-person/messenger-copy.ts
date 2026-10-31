import { formatTransferContextHeader } from "../staff-notification-route";

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
}): string {
  const title = input.itemTitle.trim() || "Передача";
  const code = input.publicCode;
  const link = input.holderUrl || input.shellUrl;
  const linkLine = link ? `\nОткрыть: ${link}` : "";
  const ctx = externalContextBlock(input);
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
        `Код для передачи: следующим сообщением шесть цифр для копирования.\n` +
        `Сообщите код держателю лично. Код одноразовый.`
      );
    case "after_code":
      return `${ctx}\n\nКод подтверждён, предмет передан дальше.${linkLine}`;
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
