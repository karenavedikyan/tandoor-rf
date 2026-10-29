import type { PoolClient } from "pg";
import { generateHandoffCodeForPendingParty } from "../../tan-tracker/handoff-code-generate";
import {
  assertSessionTransferStillOpen,
  bindSessionChannel,
  bindSessionMessengerChat,
  lockSessionByStartToken,
  lockSessionByTelegramChat,
  markPhoneVerified,
  phonesMatch,
  recordCodeIssue,
  recordContactAttempt,
} from "../../tan-tracker/external-messenger/session-service";
import { isExternalMessengerStartToken } from "../../tan-tracker/external-messenger/start-token";
import { isExternalMessengerFeatureEnabled } from "../../tan-tracker/external-messenger/config";
import { normalizeRuPhoneE164 } from "../../tan-tracker/phone-normalize";

export type ExternalRecipientBotReply = {
  text: string;
  requestContact?: boolean;
  clearContactKeyboard?: boolean;
};

export async function handleExternalRecipientStart(
  client: PoolClient,
  input: { channel: "telegram" | "max"; startPayload: string | null; chatId: bigint },
): Promise<ExternalRecipientBotReply | null> {
  if (!isExternalMessengerFeatureEnabled() || !input.startPayload) return null;
  if (!isExternalMessengerStartToken(input.startPayload)) return null;

  const session = await lockSessionByStartToken(client, input.startPayload);
  if (!session) {
    return { text: "Ссылка недействительна или истекла. Попросите отправителя прислать новую." };
  }
  const open = await assertSessionTransferStillOpen(client, session);
  if (!open.ok) return { text: open.message };

  await bindSessionChannel(client, session.id, input.channel);
  await bindSessionMessengerChat(client, session.id, input.channel, input.chatId);
  return {
    text: "Подтвердите свой номер телефона кнопкой ниже. Код придёт только в этот чат и только после совпадения номера с указанным отправителем.",
    requestContact: true,
  };
}

export async function handleExternalRecipientTelegramContact(
  client: PoolClient,
  input: {
    telegramChatId: bigint;
    telegramUserId: bigint;
    contactUserId: number | null;
    phoneRaw: string;
    isForwarded: boolean;
  },
): Promise<ExternalRecipientBotReply | null> {
  if (!isExternalMessengerFeatureEnabled()) return null;

  if (input.isForwarded) {
    return { text: "Пересланные контакты не принимаются. Нажмите кнопку и отправьте свой номер." };
  }
  if (input.contactUserId == null || BigInt(input.contactUserId) !== input.telegramUserId) {
    return { text: "Нужен ваш собственный контакт из Telegram, отправленный кнопкой «Поделиться номером»." };
  }

  const session = await lockSessionByTelegramChat(client, input.telegramChatId);
  if (!session) return { text: "Приглашение недоступно." };
  if (session.channel && session.channel !== "telegram") {
    return { text: "Это приглашение открыто в другом мессенджере. Используйте тот канал, который вы выбрали на странице получателя." };
  }

  const attempt = await recordContactAttempt(client, session.id);
  if (!attempt.allowed) return { text: "Слишком много попыток. Попросите отправителя обновить ссылку." };

  const open = await assertSessionTransferStillOpen(client, session);
  if (!open.ok) return { text: open.message };

  const got = normalizeRuPhoneE164(input.phoneRaw);
  if (!got || !phonesMatch(open.expectedPhoneE164, got)) {
    return { text: "Номер не совпадает с указанным отправителем. Проверьте SIM и попробуйте снова." };
  }

  await markPhoneVerified(client, session.id);
  const issue = await recordCodeIssue(client, session.id);
  if (!issue.allowed) {
    if (issue.alreadyIssued) {
      return { text: "Код уже был отправлен в этот чат. Если он истёк, попросите отправителя обновить приглашение." };
    }
    return { text: "Лимит выдачи кодов исчерпан. Попросите отправителя новую ссылку." };
  }

  const generated = await generateHandoffCodeForPendingParty(client, {
    transferIdOrCode: session.transfer_id,
    pendingPartyId: session.pending_party_id,
    auditUserId: null,
    auditPartyId: session.pending_party_id,
    auditAction: "external_messenger_code_telegram",
  });
  if (!generated.ok) return { text: generated.message };

  return {
    text: `Код для передачи ${generated.publicCode}: ${generated.code}\nСообщите его держателю лично. Код одноразовый и действует ограниченное время.`,
    clearContactKeyboard: true,
  };
}
