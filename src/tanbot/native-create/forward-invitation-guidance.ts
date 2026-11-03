/** Sender-only guidance immediately before the clean, forwardable invitation. */
export function buildForwardInvitationGuidance(publicCode: string, existingTrack = false): string {
  return [
    "ПОЛУЧИТЕ КОД У ПОЛУЧАТЕЛЯ!",
    "",
    "Перешлите следующее сообщение со ссылкой получателю.",
    "Он сообщит вам код из MAX или Telegram.",
    "Нажмите «Ввести код» и введите его.",
    "",
    existingTrack ? `Для трека ${publicCode} назначен следующий получатель.` : `Передача создана: ${publicCode}.`,
    "Ответственность перейдёт только после проверки кода.",
    "Предмет передавайте только после подтверждения.",
  ].join("\n");
}
