import type { Pool, PoolClient } from "pg";
import {
  isHandoffReplyFullyDelivered,
  mergeReplyDeliveryProgress,
  parseMaxReplyExtra,
  parseTelegramReplyExtra,
  type MaxReplyExtra,
  type TelegramReplyExtra,
} from "./webhook-reply-extra";

export async function loadTelegramReplyRow(
  db: Pool | PoolClient,
  updateId: number,
): Promise<{ reply_text: string; reply_extra: unknown } | null> {
  const row = await db.query<{ reply_text: string; reply_extra: unknown }>(
    `SELECT reply_text, reply_extra FROM tanbot_telegram_update_dedup WHERE update_id = $1`,
    [updateId],
  );
  return row.rows[0] ?? null;
}

export async function persistTelegramReplyExtra(
  db: Pool | PoolClient,
  updateId: number,
  extra: TelegramReplyExtra,
): Promise<void> {
  await db.query(`UPDATE tanbot_telegram_update_dedup SET reply_extra = $2::jsonb WHERE update_id = $1`, [
    updateId,
    JSON.stringify(extra),
  ]);
}

export async function loadMaxReplyRow(
  db: Pool | PoolClient,
  dedupKey: string,
): Promise<{ reply_text: string; reply_extra: unknown } | null> {
  const row = await db.query<{ reply_text: string; reply_extra: unknown }>(
    `SELECT reply_text, reply_extra FROM tanbot_max_update_dedup WHERE dedup_key = $1`,
    [dedupKey],
  );
  return row.rows[0] ?? null;
}

export async function persistMaxReplyExtra(
  db: Pool | PoolClient,
  dedupKey: string,
  extra: MaxReplyExtra,
): Promise<void> {
  await db.query(`UPDATE tanbot_max_update_dedup SET reply_extra = $2::jsonb WHERE dedup_key = $1`, [
    dedupKey,
    JSON.stringify(extra),
  ]);
}

export function nextTelegramDeliveryStep(extra: TelegramReplyExtra): "primary" | "copyOnly" | "done" {
  if (!extra.delivery?.primary) return "primary";
  if (extra.copyOnlyCode && !extra.delivery.copyOnly) return "copyOnly";
  return "done";
}

export function nextMaxDeliveryStep(extra: MaxReplyExtra): "primary" | "copyOnly" | "done" {
  if (!extra.delivery?.primary) return "primary";
  if (extra.copyOnlyCode && !extra.delivery.copyOnly) return "copyOnly";
  return "done";
}

export function markTelegramExtraProgress(
  extra: TelegramReplyExtra,
  step: "primary" | "copyOnly",
): TelegramReplyExtra {
  return {
    ...extra,
    delivery: mergeReplyDeliveryProgress(extra.delivery, step === "primary" ? { primary: true } : { copyOnly: true }),
  };
}

export function markMaxExtraProgress(extra: MaxReplyExtra, step: "primary" | "copyOnly"): MaxReplyExtra {
  return {
    ...extra,
    delivery: mergeReplyDeliveryProgress(extra.delivery, step === "primary" ? { primary: true } : { copyOnly: true }),
  };
}

export function telegramExtraFromStored(raw: unknown): TelegramReplyExtra {
  return parseTelegramReplyExtra(raw);
}

export function maxExtraFromStored(raw: unknown): MaxReplyExtra {
  return parseMaxReplyExtra(raw);
}

export function isStoredTelegramFullyDelivered(raw: unknown): boolean {
  const extra = parseTelegramReplyExtra(raw);
  return isHandoffReplyFullyDelivered(extra);
}

export function isStoredMaxFullyDelivered(raw: unknown): boolean {
  const extra = parseMaxReplyExtra(raw);
  return isHandoffReplyFullyDelivered(extra);
}
