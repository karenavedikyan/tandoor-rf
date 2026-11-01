/** Sender-only guidance immediately before the clean, forwardable invitation. */
export function buildForwardInvitationGuidance(publicCode: string): string {
  return [
    "ПЕРЕШЛИТЕ СЛЕДУЮЩЕЕ СООБЩЕНИЕ ПОЛУЧАТЕЛЮ",
    "",
    "В нём ссылка для получения кода.",
    "Попросите код у получателя и нажмите «Ввести код».",
    "",
    `Передача создана: ${publicCode}.`,
    "Предмет передавайте только после подтверждения.",
  ].join("\n");
}
