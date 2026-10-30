import type { PoolClient } from "pg";
import { generateHandoffCodeForPendingParty } from "../../tan-tracker/handoff-code-generate";
import {
  assertSessionTransferStillOpen,
  bindSessionMessengerChat,
  lockSessionByStartToken,
  lockSessionByTelegramChat,
  lockSessionByMaxChat,
  markPhoneVerified,
  phonesMatch,
  recordCodeIssue,
  recordContactAttempt,
} from "../../tan-tracker/external-messenger/session-service";
import {
  extractPhoneFromVcf,
  verifyMaxContactVcfHash,
  type MaxContactAttachmentPayload,
} from "./max-contact-verify";
import { loadTanbotMaxStage2Config } from "../../tanbot-max/stage2-config";
import { isExternalMessengerStartToken } from "../../tan-tracker/external-messenger/start-token";
import { isExternalMessengerFeatureEnabled } from "../../tan-tracker/external-messenger/config";
import { normalizeRuPhoneE164 } from "../../tan-tracker/phone-normalize";

export type ExternalRecipientBotReply = {
  text: string;
  requestContact?: boolean;
  clearContactKeyboard?: boolean;
};

async function issueExternalMessengerCode(
  client: PoolClient,
  session: { id: string; transfer_id: string; pending_party_id: string },
  auditAction: string,
): Promise<ExternalRecipientBotReply | { error: string }> {
  const issue = await recordCodeIssue(client, session.id);
  if (!issue.allowed) {
    if (issue.alreadyIssued) {
      return { error: "Код уже был отправлен в этот чат. Если он истёк, попросите отправителя обновить приглашение." };
    }
    return { error: "Лимит выдачи кодов исчерпан. Попросите отправителя новую ссылку." };
  }
  const generated = await generateHandoffCodeForPendingParty(client, {
    transferIdOrCode: session.transfer_id,
    pendingPartyId: session.pending_party_id,
    auditUserId: null,
    auditPartyId: session.pending_party_id,
    auditAction,
  });
  if (!generated.ok) return { error: generated.message };
  return {
    text: `Код для передачи ${generated.publicCode}: ${generated.code}\nСообщите его держателю лично. Код одноразовый и действует ограниченное время.`,
    clearContactKeyboard: true,
  };
}

export async function handleExternalRecipientStart(
  client: PoolClient,
  input: {
    channel: "telegram" | "max";
    startPayload: string | null;
    chatId: bigint;
    messengerUserId: bigint;
  },
): Promise<ExternalRecipientBotReply | null> {
  if (!isExternalMessengerFeatureEnabled() || !input.startPayload) return null;
  if (!isExternalMessengerStartToken(input.startPayload)) return null;

  const session = await lockSessionByStartToken(client, input.startPayload);
  if (!session) {
    return { text: "Ссылка недействительна или истекла. Попросите отправителя прислать новую." };
  }
  const open = await assertSessionTransferStillOpen(client, session);
  if (!open.ok) return { text: open.message };

  await bindSessionMessengerChat(client, session, input.channel, input.chatId, input.messengerUserId);
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
  if (!session) return null;
  if (
    session.bound_telegram_user_id &&
    session.bound_telegram_user_id !== input.telegramUserId.toString()
  ) {
    return { text: "Это приглашение привязано к другому пользователю Telegram." };
  }
  if (session.channel && session.channel !== "telegram") {
    return { text: "Это приглашение открыто в другом мессенджере. Используйте тот канал, который вы выбрали на странице получателя." };
  }

  const open = await assertSessionTransferStillOpen(client, session);
  if (!open.ok) return null;

  const attempt = await recordContactAttempt(client, session.id);
  if (!attempt.allowed) return { text: "Слишком много попыток. Попросите отправителя обновить ссылку." };

  const got = normalizeRuPhoneE164(input.phoneRaw);
  if (!got || !phonesMatch(open.expectedPhoneE164, got)) {
    return { text: "Номер не совпадает с указанным отправителем. Проверьте SIM и попробуйте снова." };
  }

  await markPhoneVerified(client, session.id);
  const issued = await issueExternalMessengerCode(client, session, "external_messenger_code_telegram");
  if ("error" in issued) return { text: issued.error };
  return issued;
}

export async function handleExternalRecipientMaxContact(
  client: PoolClient,
  input: {
    maxChatId: bigint;
    maxUserId: bigint;
    contact: MaxContactAttachmentPayload;
    isForwarded: boolean;
  },
): Promise<ExternalRecipientBotReply | null> {
  if (!isExternalMessengerFeatureEnabled()) return null;
  if (input.isForwarded) {
    return { text: "Пересланные контакты не принимаются. Нажмите кнопку и отправьте свой номер." };
  }

  const session = await lockSessionByMaxChat(client, input.maxChatId);
  if (!session) return null;
  if (session.bound_max_user_id && session.bound_max_user_id !== input.maxUserId.toString()) {
    return { text: "Это приглашение привязано к другому пользователю MAX." };
  }
  if (session.channel && session.channel !== "max") {
    return { text: "Это приглашение открыто в другом мессенджере. Используйте тот канал, который вы выбрали на странице получателя." };
  }

  const open = await assertSessionTransferStillOpen(client, session);
  if (!open.ok) return null;

  const cfg = loadTanbotMaxStage2Config();
  if (!cfg.ok) return { text: "MAX временно недоступен." };
  if (
    !verifyMaxContactVcfHash(cfg.config.botToken, input.contact.vcfInfo, input.contact.contactHash)
  ) {
    return { text: "Не удалось проверить подлинность контакта MAX. Отправьте номер кнопкой «Отправить мой номер»." };
  }
  if (BigInt(input.contact.contactUserId) !== input.maxUserId) {
    return { text: "Нужен ваш собственный контакт из MAX." };
  }

  const attempt = await recordContactAttempt(client, session.id);
  if (!attempt.allowed) return { text: "Слишком много попыток. Попросите отправителя обновить ссылку." };

  const phoneDigits = extractPhoneFromVcf(input.contact.vcfInfo);
  const e164Guess = phoneDigits
    ? phoneDigits.startsWith("7")
      ? `+${phoneDigits}`
      : phoneDigits.startsWith("8") && phoneDigits.length === 11
        ? `+7${phoneDigits.slice(1)}`
        : `+7${phoneDigits.slice(-10)}`
    : "";
  const got = e164Guess ? normalizeRuPhoneE164(e164Guess) : null;
  if (!got || !phonesMatch(open.expectedPhoneE164, got)) {
    return { text: "Номер не совпадает с указанным отправителем. Проверьте SIM и попробуйте снова." };
  }

  await markPhoneVerified(client, session.id);
  const issued = await issueExternalMessengerCode(client, session, "external_messenger_code_max");
  if ("error" in issued) return { text: issued.error };
  return issued;
}
