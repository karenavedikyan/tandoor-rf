/** Sender-only guidance immediately before the clean, forwardable invitation. */
export function buildForwardInvitationGuidance(publicCode: string): string {
  return [
    "ПОЛУЧИТЕ КОД У ПОЛУЧАТЕЛЯ!",
    "",
    "Перешлите следующее сообщение со ссылкой получателю.",
    "Он откроет ссылку и сообщит вам код.",
    "Нажмите «Ввести код» и введите его.",
    "",
    `Передача создана: ${publicCode}.`,
    "Предмет передавайте только после подтверждения.",
  ].join("\n");
}
