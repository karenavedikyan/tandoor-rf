export type ExternalPersonMessengerEvent =
  | "declined"
  | "after_code"
  | "after_receipt"
  | "delivered"
  | "closed"
  | "handoff_code";

export function buildExternalPersonMessengerBody(input: {
  event: ExternalPersonMessengerEvent;
  publicCode: string;
  itemTitle: string;
  holderUrl?: string | null;
  shellUrl?: string | null;
  extraLine?: string;
}): string {
  const title = input.itemTitle.trim() || "Передача";
  const code = input.publicCode;
  const link = input.holderUrl || input.shellUrl;
  const linkLine = link ? `\nОткрыть: ${link}` : "";
  switch (input.event) {
    case "declined":
      return (
        (input.extraLine ? `${input.extraLine}\n` : "") +
        `Заявка «${title}» (${code}) отклонена.`
      );
    case "handoff_code":
      return (
        `Код для передачи ${code}: ${input.extraLine ?? ""}`.trim() +
        "\nСообщите код держателю лично. Код одноразовый."
      );
    case "after_code":
      return `Передача «${title}» (${code}): код подтверждён, предмет передан дальше.${linkLine}`;
    case "after_receipt":
      return `Вы получили «${title}» (${code}).${linkLine}`;
    case "delivered":
      return `Передача «${title}» (${code}) доставлена конечному получателю.${linkLine}`;
    case "closed":
      return `Передача «${title}» (${code}) завершена.${linkLine}`;
    default:
      return `Тан-трекер: ${title} (${code}).${linkLine}`;
  }
}
