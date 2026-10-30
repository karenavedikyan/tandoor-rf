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
}): string {
  const { channelLabel, notificationsEnabled } = input;
  const base = `${channelLabel} подключён к личному кабинету. Коды Тан-трекера доступны в этом чате.`;
  if (notificationsEnabled) {
    return `${base} Уведомления о передачах включены. Отключить: /stop или профиль.`;
  }
  return `${base} Уведомления о передачах выключены — включите в профиле. Отключить привязку: /stop или профиль.`;
}
