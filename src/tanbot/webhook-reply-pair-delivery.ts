import type { Pool, PoolClient } from "pg";
import {
  isHandoffReplyFullyDelivered,
  parseMaxReplyExtra,
  parseTelegramReplyExtra,
  type MaxReplyExtra,
  type TelegramReplyExtra,
} from "./webhook-reply-extra";

export const TELEGRAM_REPLY_DELIVERY_LOCK_NS = 847291;
export const MAX_REPLY_DELIVERY_LOCK_NS = 847292;

export type ReplyDeliveryStep = "primary" | "copyOnly" | "invitation" | "nativeMedia" | "done";

export function maxDeliveryLockKeys(dedupKey: string): [number, number] {
  let h1 = 0;
  let h2 = 0;
  for (let i = 0; i < dedupKey.length; i++) {
    h1 = (Math.imul(31, h1) + dedupKey.charCodeAt(i)) | 0;
    h2 = (Math.imul(17, h2) + dedupKey.charCodeAt(i)) | 0;
  }
  return [MAX_REPLY_DELIVERY_LOCK_NS, h1 ^ h2];
}

export async function withTelegramReplyDeliveryLock<T>(
  pool: Pool,
  updateId: number,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query(`SELECT pg_advisory_lock($1, $2)`, [TELEGRAM_REPLY_DELIVERY_LOCK_NS, updateId]);
    try {
      return await fn(client);
    } finally {
      await client.query(`SELECT pg_advisory_unlock($1, $2)`, [TELEGRAM_REPLY_DELIVERY_LOCK_NS, updateId]);
    }
  } finally {
    client.release();
  }
}

export async function withMaxReplyDeliveryLock<T>(
  pool: Pool,
  dedupKey: string,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const [k1, k2] = maxDeliveryLockKeys(dedupKey);
  const client = await pool.connect();
  try {
    await client.query(`SELECT pg_advisory_lock($1, $2)`, [k1, k2]);
    try {
      return await fn(client);
    } finally {
      await client.query(`SELECT pg_advisory_unlock($1, $2)`, [k1, k2]);
    }
  } finally {
    client.release();
  }
}

export async function loadTelegramReplyRowLocked(
  client: PoolClient,
  updateId: number,
): Promise<{ reply_text: string; reply_extra: unknown; reply_delivered_at: Date | null } | null> {
  const row = await client.query<{
    reply_text: string;
    reply_extra: unknown;
    reply_delivered_at: Date | null;
  }>(
    `SELECT reply_text, reply_extra, reply_delivered_at
     FROM tanbot_telegram_update_dedup WHERE update_id = $1 FOR UPDATE`,
    [updateId],
  );
  return row.rows[0] ?? null;
}

export async function loadMaxReplyRowLocked(
  client: PoolClient,
  dedupKey: string,
): Promise<{ reply_text: string; reply_extra: unknown; reply_delivered_at: Date | null } | null> {
  const row = await client.query<{
    reply_text: string;
    reply_extra: unknown;
    reply_delivered_at: Date | null;
  }>(
    `SELECT reply_text, reply_extra, reply_delivered_at
     FROM tanbot_max_update_dedup WHERE dedup_key = $1 FOR UPDATE`,
    [dedupKey],
  );
  return row.rows[0] ?? null;
}

export async function mergeTelegramReplyDeliveryProgress(
  client: PoolClient,
  updateId: number,
  step: "primary" | "copyOnly" | "invitation",
): Promise<void> {
  const field = step;
  await client.query(
    `UPDATE tanbot_telegram_update_dedup
     SET reply_extra = jsonb_set(
       COALESCE(reply_extra, '{}'::jsonb),
       '{delivery}',
       COALESCE(reply_extra->'delivery', '{}'::jsonb) || jsonb_build_object($2::text, true),
       true
     )
     WHERE update_id = $1`,
    [updateId, field],
  );
}

export async function mergeMaxReplyDeliveryProgress(
  client: PoolClient,
  dedupKey: string,
  step: "primary" | "copyOnly" | "invitation",
): Promise<void> {
  const field = step;
  await client.query(
    `UPDATE tanbot_max_update_dedup
     SET reply_extra = jsonb_set(
       COALESCE(reply_extra, '{}'::jsonb),
       '{delivery}',
       COALESCE(reply_extra->'delivery', '{}'::jsonb) || jsonb_build_object($2::text, true),
       true
     )
     WHERE dedup_key = $1`,
    [dedupKey, field],
  );
}

export async function mergeTelegramNativeMediaProgress(
  client: PoolClient,
  updateId: number,
  patch: Record<string, unknown>,
): Promise<void> {
  await client.query(
    `UPDATE tanbot_telegram_update_dedup
     SET reply_extra = jsonb_set(
       COALESCE(reply_extra, '{}'::jsonb),
       '{nativeMediaProgress}',
       COALESCE(reply_extra->'nativeMediaProgress', '{}'::jsonb) || $2::jsonb,
       true
     )
     WHERE update_id = $1`,
    [updateId, JSON.stringify(patch)],
  );
}

export async function mergeMaxNativeMediaProgress(
  client: PoolClient,
  dedupKey: string,
  patch: Record<string, unknown>,
): Promise<void> {
  await client.query(
    `UPDATE tanbot_max_update_dedup
     SET reply_extra = jsonb_set(
       COALESCE(reply_extra, '{}'::jsonb),
       '{nativeMediaProgress}',
       COALESCE(reply_extra->'nativeMediaProgress', '{}'::jsonb) || $2::jsonb,
       true
     )
     WHERE dedup_key = $1`,
    [dedupKey, JSON.stringify(patch)],
  );
}

function nextDeliveryStep(extra: TelegramReplyExtra | MaxReplyExtra): ReplyDeliveryStep {
  if (!extra.delivery?.primary) return "primary";
  if (extra.copyOnlyCode && !extra.delivery.copyOnly) return "copyOnly";
  if (extra.forwardInvitationText && !extra.delivery.invitation) return "invitation";
  const queueLen = extra.nativeMediaQueue?.length ?? 0;
  if (queueLen > 0) {
    const prog = extra.nativeMediaProgress ?? {};
    if (prog.disposition !== "canceled" && (prog.mediaDeliveredCount ?? 0) < queueLen) {
      return "nativeMedia";
    }
  }
  return "done";
}

export function nextTelegramDeliveryStep(extra: TelegramReplyExtra): ReplyDeliveryStep {
  return nextDeliveryStep(extra);
}

export function nextMaxDeliveryStep(extra: MaxReplyExtra): ReplyDeliveryStep {
  return nextDeliveryStep(extra);
}

export function telegramExtraFromStored(raw: unknown): TelegramReplyExtra {
  return parseTelegramReplyExtra(raw);
}

export function maxExtraFromStored(raw: unknown): MaxReplyExtra {
  return parseMaxReplyExtra(raw);
}

export function isStoredTelegramFullyDelivered(raw: unknown): boolean {
  return isHandoffReplyFullyDelivered(parseTelegramReplyExtra(raw));
}

export function isStoredMaxFullyDelivered(raw: unknown): boolean {
  return isHandoffReplyFullyDelivered(parseMaxReplyExtra(raw));
}
