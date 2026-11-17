export function buildMessengerPlainStartReply(input: {
  channelLabel: "Telegram" | "MAX";
  linked: boolean;
  notificationsEnabled: boolean;
  profileUrl: string;
}): string {
  const { channelLabel, linked, notificationsEnabled, profileUrl } = input;
  if (linked) {
    return notificationsEnabled
      ? `${channelLabel} уже подключён к личному кабинету. Уведомления о передачах Тан-трекера включены.`
      : `${channelLabel} уже подключён к личному кабинету. Уведомления о передачах выключены — включите в профиле.`;
  }
  return `${channelLabel} не подключён к личному кабинету.\nПодключение выполняется в разделе «Мой профиль»: ${profileUrl}`;
}

export function buildMessengerLinkSuccessReply(input: {
  channelLabel: "Telegram" | "MAX";
  notificationsEnabled: boolean;
  phoneE164: string | null;
}): string {
  const { channelLabel, notificationsEnabled, phoneE164 } = input;
  const phoneStatus = phoneE164 ? `Номер в ЛК: ${phoneE164}.` : "Номер этой привязки в ЛК не указан.";
  const base = `${channelLabel} подключён к личному кабинету.\n${phoneStatus}\nКоды Тан-трекера доступны в этом чате.`;
  if (notificationsEnabled) {
    return `${base}\nУведомления о передачах ${phoneE164 ? `для номера ${phoneE164} успешно подключены и включены` : "включены"}. Управление уведомлениями доступно в разделе «Настройки» меню бота.`;
  }
  return `${base} Уведомления о передачах выключены. Включить их можно в разделе «Настройки» меню бота.`;
}
