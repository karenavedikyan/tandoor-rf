import type { Pool, PoolClient } from "pg";
import { withTransaction } from "../access/db";
import type { TanbotMaxStage2Config } from "./stage2-config";
import { parseMaxWebhookUpdate } from "./update-parse";
import { consumeStartTokenForMaxUser } from "./link-service";
import {
  findAccountByMaxUserId,
  cancelActiveLinkAttempts,
  insertLinkAudit,
} from "./link-repository";
import { lockTanbotMaxLkUser } from "../tanbot/link-advisory-locks";
import { buildMessengerLinkSuccessReply, buildMessengerPlainStartReply } from "../tanbot/link-bot-replies";
import type { MaxDeliveryTransport, MaxDeliveryResult, MaxInlineButton } from "./delivery-transport";
import { buildHandoffCodeBotReply } from "../tanbot/handoff-code-bot-flow";
import { isTanbotHandoffCodePilotEnabled } from "../tanbot/handoff-code-pilot-config";
import { handleExternalRecipientMaxContact, handleExternalRecipientStart } from "../tanbot/external-recipient/bot-flow";
import type { MaxContactAttachmentPayload } from "../tanbot/external-recipient/max-contact-verify";
import { isExternalMessengerStartToken } from "../tan-tracker/external-messenger/start-token";
import { isExternalMessengerFeatureEnabled } from "../tan-tracker/external-messenger/config";
import {
  handleExternalPersonMaxContact,
  handleExternalPersonMaxMessage,
  handleExternalPersonMaxPhoto,
} from "../tanbot/external-person/max-bot-flow";
import { extractPhoneFromVcf, verifyMaxContactVcfHash } from "../tanbot/external-recipient/max-contact-verify";
import { loadTanbotMaxStage2Config } from "./stage2-config";
import {
  claimMaxUpdate,
  commitMaxUpdateReply,
  markMaxUpdateFailed,
} from "./webhook-inbox";
import { deliverMaxWebhookReply } from "./webhook-reply-delivery";

export type WebhookReply = {
  userId: bigint;
  chatId: bigint;
  text: string;
  inlineButtons?: MaxInlineButton[][];
  copyOnlyCode?: string;
  replyExtra?: Record<string, unknown>;
} | null;

async function disconnectMaxAccountOnClient(client: PoolClient, userId: string): Promise<void> {
  await lockTanbotMaxLkUser(client, userId);
  await client.query(
    `UPDATE tanbot_max_accounts SET stopped_at = NOW(), notifications_enabled = FALSE WHERE user_id = $1::uuid`,
    [userId],
  );
  await cancelActiveLinkAttempts(client, userId);
  await insertLinkAudit(client, { userId, actorUserId: userId, action: "link_disconnect" });
}

async function processUpdateInTransaction(
  client: PoolClient,
  pool: Pool,
  config: TanbotMaxStage2Config,
  update: Record<string, unknown> & {
    dedupKey: string;
    updateType: string;
    maxUserId: bigint;
    chatId: bigint;
  },
): Promise<WebhookReply> {
  const startPayload = (update.startPayload as string | null) ?? null;
  const commandText = (update.commandText as string | null) ?? null;
  const callbackPayload = (update.callbackPayload as string | null) ?? null;
  const username = (update.username as string | null) ?? null;
  const firstName = (update.firstName as string | null) ?? null;
  const contact = update.contact as MaxContactAttachmentPayload | undefined;
  const unsignedVcfInfo =
    "unsignedVcfInfo" in update && typeof update.unsignedVcfInfo === "string"
      ? update.unsignedVcfInfo
      : undefined;
  const isForwarded = Boolean(update.isForwarded);
  const recipientChatType =
    "recipientChatType" in update && typeof update.recipientChatType === "string"
      ? update.recipientChatType
      : null;
  const claim = await claimMaxUpdate(client, update.dedupKey);
  if (claim.kind === "ignore") {
    return null;
  }
  if (claim.kind === "resend") {
    return claim.reply;
  }

  let reply: WebhookReply = null;
  const lkUrl = `${config.appOrigin}/profile`;

  try {
    if (unsignedVcfInfo) {
      const { tryNativeCreateMaxRecipientContact } = await import("../tanbot/native-create/adapters");
      const native = await tryNativeCreateMaxRecipientContact(client, {
        chatId: update.chatId,
        maxUserId: update.maxUserId,
        vcfInfo: unsignedVcfInfo,
        isForwarded,
        recipientChatType,
      });
      if (native) {
        reply = {
          userId: update.maxUserId,
          chatId: update.chatId,
          text: native.text,
          inlineButtons: native.inlineButtons,
        };
      }
    }
    if (!reply && contact) {
      const linkedStaff = await findAccountByMaxUserId(client, update.maxUserId);
      if (linkedStaff && recipientChatType === "dialog" && !isForwarded) {
        const { tryNativeCreateMaxRecipientContact } = await import("../tanbot/native-create/adapters");
        const native = await tryNativeCreateMaxRecipientContact(client, {
          chatId: update.chatId,
          maxUserId: update.maxUserId,
          vcfInfo: contact.vcfInfo,
          isForwarded,
          recipientChatType,
        });
        if (native) {
          reply = {
            userId: update.maxUserId,
            chatId: update.chatId,
            text: native.text,
            inlineButtons: native.inlineButtons,
          };
        }
      }
      let ext = reply
        ? null
        : ((await handleExternalRecipientMaxContact(client, {
            maxChatId: update.chatId,
            maxUserId: update.maxUserId,
            contact,
            isForwarded,
          })) ?? null);
      if (!reply && !ext && isExternalMessengerFeatureEnabled()) {
        const maxCfg = loadTanbotMaxStage2Config();
        const token = maxCfg.ok ? maxCfg.config.botToken : "";
        const phoneDigits = extractPhoneFromVcf(contact.vcfInfo);
        const phoneRaw = phoneDigits ? (phoneDigits.startsWith("7") ? `+${phoneDigits}` : `+7${phoneDigits}`) : "";
        if (
          token &&
          phoneRaw &&
          verifyMaxContactVcfHash(token, contact.vcfInfo, contact.contactHash) &&
          contact.contactUserId === Number(update.maxUserId)
        ) {
          ext = await handleExternalPersonMaxContact(client, {
            chatId: update.chatId,
            maxUserId: update.maxUserId,
            phoneRaw,
            firstName,
            contactUserId: contact.contactUserId,
            isForwarded,
          });
        }
      }
      if (!reply) reply = ext
        ? {
            userId: update.maxUserId,
            chatId: update.chatId,
            text: ext.text,
            copyOnlyCode: ext.copyOnlyCode,
            inlineButtons: ext.requestContact
              ? [[{ type: "request_contact", text: "Отправить мой номер" }]]
              : undefined,
          }
        : { userId: update.maxUserId, chatId: update.chatId, text: "Контакт не принят." };
    } else if (update.updateType === "bot_stopped" || commandText?.split(/\s+/)[0]?.toLowerCase() === "/stop") {
      const { handleStaffOrExternalMessengerStop } = await import("../tanbot/messenger-stop-handler");
      const stopText = await handleStaffOrExternalMessengerStop(client, {
        channel: "max",
        messengerUserId: update.maxUserId,
      });
      reply = {
        userId: update.maxUserId,
        chatId: update.chatId,
        text: stopText,
      };
    } else if (commandText?.split(/\s+/)[0]?.toLowerCase() === "/status") {
      const account = await findAccountByMaxUserId(client, update.maxUserId);
      const { buildMainMenuInline } = await import("../tanbot/native-create/keyboards");
      const menu = buildMainMenuInline("max");
      reply = account
        ? {
            userId: update.maxUserId,
            chatId: update.chatId,
            text: account.notifications_enabled
              ? "MAX подключён. Уведомления о передачах Тан-трекера включены.\nМожно создать передачу кнопкой ниже."
              : "MAX подключён. Уведомления о передачах выключены — включите в профиле.\nМожно создать передачу кнопкой ниже.",
            inlineButtons: menu.maxInlineButtons,
          }
        : {
            userId: update.maxUserId,
            chatId: update.chatId,
            text: "MAX не подключён к личному кабинету. Подключение выполняется в разделе «Мой профиль».",
          };
    } else if (update.updateType === "bot_started") {
      if (startPayload && isExternalMessengerStartToken(startPayload)) {
        const ext = await handleExternalRecipientStart(client, {
          channel: "max",
          startPayload,
          chatId: update.chatId,
          messengerUserId: update.maxUserId,
        });
        reply = ext
          ? {
              userId: update.maxUserId,
              chatId: update.chatId,
              text: ext.text,
              inlineButtons: ext.requestContact
                ? [[{ type: "request_contact", text: "Отправить мой номер" }]]
                : undefined,
            }
          : {
              userId: update.maxUserId,
              chatId: update.chatId,
              text: "Приглашение недоступно.",
            };
      } else if (!startPayload) {
        const account = await findAccountByMaxUserId(client, update.maxUserId);
        const { buildMainMenuInline } = await import("../tanbot/native-create/keyboards");
        const menu = buildMainMenuInline("max");
        reply = {
          userId: update.maxUserId,
          chatId: update.chatId,
          text: buildMessengerPlainStartReply({
            channelLabel: "MAX",
            linked: !!account,
            notificationsEnabled: account?.notifications_enabled ?? false,
            profileUrl: lkUrl,
          }),
          inlineButtons: account ? menu.maxInlineButtons : menu.maxInlineButtons,
        };
      } else {
        const outcome = await consumeStartTokenForMaxUser(
          pool,
          config,
          {
            startToken: startPayload,
            maxUserId: update.maxUserId,
            maxChatId: update.chatId,
            maxUsername: username,
            maxFirstName: firstName,
          },
          client,
        );
        if (outcome === "conflict") {
          reply = {
            userId: update.maxUserId,
            chatId: update.chatId,
            text: "Этот MAX уже связан с другим аккаунтом. Обратитесь к администратору.",
          };
        } else if (outcome === "invalid") {
          reply = {
            userId: update.maxUserId,
            chatId: update.chatId,
            text: "Ссылка недействительна или истекла. Запросите новую в личном кабинете.",
          };
        } else {
          const account = await findAccountByMaxUserId(client, update.maxUserId);
          reply = {
            userId: update.maxUserId,
            chatId: update.chatId,
            text: buildMessengerLinkSuccessReply({
              channelLabel: "MAX",
              notificationsEnabled: account?.notifications_enabled ?? true,
            }),
          };
        }
      }
    } else if (
      update.updateType === "message_callback" &&
      callbackPayload &&
      (await import("../tanbot/native-create/adapters")).isNativeCreateCallback(callbackPayload)
    ) {
      const { tryNativeCreateMaxCallback } = await import("../tanbot/native-create/adapters");
      const native = await tryNativeCreateMaxCallback(client, {
        chatId: update.chatId,
        maxUserId: update.maxUserId,
        payload: callbackPayload,
        recipientChatType,
      });
      if (native) {
        const { nativeMaxReplyExtra } = await import("../tanbot/native-create/adapters");
        const linkedStaff = await findAccountByMaxUserId(client, update.maxUserId);
        reply = {
          userId: update.maxUserId,
          chatId: update.chatId,
          text: native.text,
          inlineButtons: native.inlineButtons,
          replyExtra: nativeMaxReplyExtra(native, {
            messengerChatId: update.chatId.toString(),
            messengerUserId: update.maxUserId.toString(),
            actor: linkedStaff ? "staff" : "external",
            channel: "max",
          }),
        };
      }
    } else if (
      isTanbotHandoffCodePilotEnabled() &&
      (update.updateType === "message_callback" ||
        callbackPayload ||
        commandText?.trim().toLowerCase() === "/code" ||
        commandText?.trim().toLowerCase() === "кod" ||
        commandText?.trim().toLowerCase() === "код")
    ) {
      const handoff = await buildHandoffCodeBotReply(client, "max", {
        externalUserId: update.maxUserId,
        callbackPayload,
        commandText,
      });
      if (handoff.text) {
        reply = {
          userId: update.maxUserId,
          chatId: update.chatId,
          text: handoff.text,
          copyOnlyCode: handoff.copyOnlyCode,
          inlineButtons: handoff.maxInlineButtons,
        };
      }
    } else if (
      (typeof update.imageDownloadUrl === "string" && update.imageDownloadUrl) ||
      (typeof update.imageMediaToken === "string" && update.imageMediaToken)
    ) {
      if (!update.imageDownloadUrl && update.imageMediaToken) {
        reply = {
          userId: update.maxUserId,
          chatId: update.chatId,
          text: "Не удалось загрузить изображение по токену. Отправьте фото ещё раз из галереи MAX.",
        };
      } else if (typeof update.imageDownloadUrl === "string" && update.imageDownloadUrl) {
        const ext = isExternalMessengerFeatureEnabled()
          ? await handleExternalPersonMaxPhoto(client, {
              chatId: update.chatId,
              maxUserId: update.maxUserId,
              downloadUrl: update.imageDownloadUrl,
              fileName: typeof update.imageFileName === "string" ? update.imageFileName : null,
              recipientChatType,
              mediaToken:
                typeof update.imageMediaToken === "string" ? update.imageMediaToken : null,
            })
          : null;
        if (ext) {
          reply = {
            userId: update.maxUserId,
            chatId: update.chatId,
            text: ext.text,
            inlineButtons: ext.inlineButtons,
          };
        }
      }
    } else if (commandText) {
      if (isExternalMessengerFeatureEnabled()) {
        const linkedStaff = await findAccountByMaxUserId(client, update.maxUserId);
        if (linkedStaff) {
          const { tryNativeCreateMaxMessage } = await import("../tanbot/native-create/adapters");
          const native = await tryNativeCreateMaxMessage(client, {
            chatId: update.chatId,
            maxUserId: update.maxUserId,
            text: commandText,
            recipientChatType,
          });
          if (native) {
            const { nativeMaxReplyExtra } = await import("../tanbot/native-create/adapters");
            reply = {
              userId: update.maxUserId,
              chatId: update.chatId,
              text: native.text,
              inlineButtons: native.inlineButtons,
              replyExtra: nativeMaxReplyExtra(native, {
                messengerChatId: update.chatId.toString(),
                messengerUserId: update.maxUserId.toString(),
                actor: "staff",
                channel: "max",
              }),
            };
          }
        }
        const ext = !reply
          ? await handleExternalPersonMaxMessage(client, {
              chatId: update.chatId,
              maxUserId: update.maxUserId,
              text: commandText,
              firstName,
              recipientChatType,
            })
          : null;
        if (ext) {
          reply = {
            userId: update.maxUserId,
            chatId: update.chatId,
            text: ext.text,
            inlineButtons: ext.inlineButtons ?? (ext.requestContact
              ? [[{ type: "request_contact", text: "Отправить мой номер" }]]
              : undefined),
          };
        }
      }
      if (!reply) {
        reply = {
          userId: update.maxUserId,
          chatId: update.chatId,
          text: "Команды: /status — статус, /stop — отключить уведомления, /code — код приёма.",
        };
      }
    }

    if (!reply) {
      reply = {
        userId: update.maxUserId,
        chatId: update.chatId,
        text: "Команды: /status — статус, /stop — отключить уведомления, /code — код приёма.",
      };
    }

    await commitMaxUpdateReply(client, update.dedupKey, reply);
    return reply;
  } catch (err) {
    await markMaxUpdateFailed(client, update.dedupKey);
    throw err;
  }
}

export async function handleTanbotMaxUpdate(
  pool: Pool,
  config: TanbotMaxStage2Config,
  raw: unknown,
): Promise<{ reply: WebhookReply; dedupKey: string | null }> {
  const parsed = parseMaxWebhookUpdate(raw);
  if (!parsed.ok) {
    return { reply: null, dedupKey: null };
  }
  const { update } = parsed;
  const reply = await withTransaction((client) => processUpdateInTransaction(client, pool, config, update));
  return { reply, dedupKey: update.dedupKey };
}

export async function maybeSendMaxWebhookReply(
  pool: Pool,
  config: TanbotMaxStage2Config,
  transport: MaxDeliveryTransport | null,
  dedupKey: string | null,
  reply: WebhookReply,
): Promise<MaxDeliveryResult | null> {
  if (!reply || !transport || !config.deliveryEnabled || dedupKey == null) return null;
  return deliverMaxWebhookReply(pool, config, transport, dedupKey, reply);
}
