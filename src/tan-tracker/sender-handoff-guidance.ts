/** Sender instructions only. Never include a receipt code or imply that code issuance confirms custody. */
export const SENDER_HANDOFF_GUIDANCE =
  "Ваш следующий шаг: попросите у получателя код приёма.\n" +
  "Откройте карточку передачи и нажмите «Ввести код».\n" +
  "Введите полученный код и дождитесь подтверждения. Только после этого передавайте посылку.";

/** Native messenger confirmation is explicitly scoped by its callback before accepting text. */
export const NATIVE_SENDER_HANDOFF_GUIDANCE =
  "Ваш следующий шаг: попросите у получателя код приёма.\n" +
  "Нажмите «Ввести код» у этой передачи и отправьте боту 6 цифр или сообщение с кодом целиком.\n" +
  "Дождитесь сообщения «Передача подтверждена». Только после этого передавайте посылку.";
