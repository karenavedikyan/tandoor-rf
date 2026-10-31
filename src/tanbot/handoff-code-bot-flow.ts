import type { PoolClient } from "pg";
import type { MaxInlineButton } from "../tanbot-max/delivery-transport";
import { lockTanbotMaxMessenger, lockTanbotTelegramMessenger } from "./link-advisory-locks";
import {
  HANDOFF_CALLBACK_MENU,
  assertHandoffCodeBotAccess,
  buildHandoffGenCallback,
  formatPendingTransfersMessage,
  issueHandoffCodeViaBot,
  listPendingTransfersForParty,
  parseHandoffGenCallbackDetail,
  resolveStaffUserIdForBotChannel,
  type BotChannel,
} from "./handoff-code-bot-service";

export type HandoffBotReply = {
  text: string;
  /** Second messenger message: digits only, after successful issuance. */
  copyOnlyCode?: string;
  telegramInlineKeyboard?: Array<Array<{ text: string; callback_data: string }>>;
  maxInlineButtons?: MaxInlineButton[][];
};

function buildTransferKeyboard(
  channel: BotChannel,
  transfers: Array<{ publicCode: string; itemTitle: string }>,
): HandoffBotReply["telegramInlineKeyboard"] | HandoffBotReply["maxInlineButtons"] {
  const rows = transfers.map((t) => [
    {
      text: `Получить код: ${t.publicCode}`,
      ...(channel === "telegram"
        ? { callback_data: buildHandoffGenCallback(t.publicCode) }
        : { payload: buildHandoffGenCallback(t.publicCode) }),
    },
  ]);
  if (channel === "telegram") {
    return rows as HandoffBotReply["telegramInlineKeyboard"];
  }
  return rows.map((row) =>
    row.map((cell) => ({
      type: "callback" as const,
      text: cell.text,
      payload: (cell as { payload: string }).payload,
    })),
  );
}

function isCodeMenuCommand(text: string | null): boolean {
  if (!text) return false;
  const t = text.trim().toLowerCase();
  return (
    t === "/code" ||
    t === "/getcode" ||
    t.startsWith("/code@") ||
    t === "получить код" ||
    t === "код"
  );
}

export async function buildHandoffCodeBotReply(
  client: PoolClient,
  channel: BotChannel,
  input: {
    externalUserId: bigint;
    callbackPayload?: string | null;
    commandText?: string | null;
  },
): Promise<HandoffBotReply> {
  const parsedGeneration = parseHandoffGenCallbackDetail(input.callbackPayload ?? "");
  if (parsedGeneration || input.callbackPayload === HANDOFF_CALLBACK_MENU || isCodeMenuCommand(input.commandText ?? null)) {
    // Selecting recipient code issuance deliberately leaves sender code-entry mode.
    // Same messenger lock/order as native selection: never lock entry/transfer in reverse order.
    if (channel === "max") await lockTanbotMaxMessenger(client, input.externalUserId);
    else await lockTanbotTelegramMessenger(client, input.externalUserId);
    await client.query(`DELETE FROM tt_bot_receipt_code_entries WHERE channel=$1 AND messenger_user_id=$2`,
      [channel, input.externalUserId.toString()]);
  }
  const staffUserId = await resolveStaffUserIdForBotChannel(client, channel, input.externalUserId);
  if (!staffUserId) {
    return { text: "Канал не подключён к личному кабинету." };
  }

  const access = await assertHandoffCodeBotAccess(client, channel, staffUserId);
  if (!access.ok) {
    return { text: access.message };
  }

  const genCode = parsedGeneration;
  if (genCode) {
    const issued = await issueHandoffCodeViaBot(client, {
      channel,
      userId: staffUserId,
      partyId: access.partyId,
      transferPublicCode: genCode.publicCode,
      expectedHandoffVersion: genCode.handoffVersion,
    });
    if (!issued.ok) return { text: issued.message };
    return { text: issued.message, copyOnlyCode: issued.code };
  }

  if (input.callbackPayload === HANDOFF_CALLBACK_MENU || isCodeMenuCommand(input.commandText ?? null)) {
    const transfers = await listPendingTransfersForParty(client, access.partyId);
    const text = formatPendingTransfersMessage(transfers);
    if (transfers.length === 1) {
      const keyboard = buildTransferKeyboard(channel, transfers);
      return {
        text,
        telegramInlineKeyboard:
          channel === "telegram" ? (keyboard as HandoffBotReply["telegramInlineKeyboard"]) : undefined,
        maxInlineButtons:
          channel === "max" ? (keyboard as HandoffBotReply["maxInlineButtons"]) : undefined,
      };
    }
    if (transfers.length > 1) {
      const keyboard = buildTransferKeyboard(channel, transfers);
      return {
        text,
        telegramInlineKeyboard:
          channel === "telegram" ? (keyboard as HandoffBotReply["telegramInlineKeyboard"]) : undefined,
        maxInlineButtons:
          channel === "max" ? (keyboard as HandoffBotReply["maxInlineButtons"]) : undefined,
      };
    }
    return { text };
  }

  return { text: "" };
}
