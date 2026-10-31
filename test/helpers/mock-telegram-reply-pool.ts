import type { Pool, PoolClient } from "pg";

/** Minimal pool mock for deliverTelegramWebhookReply / maybeSendWebhookReply unit tests. */
export function mockTelegramReplyDeliveryPool(input: {
  updateId: number;
  replyText: string;
  replyExtra?: Record<string, unknown> | null;
}): Pool {
  let extra: Record<string, unknown> | null = input.replyExtra ?? null;
  let deliveredAt: Date | null = null;

  const clientQuery = async (sql: string, params?: unknown[]) => {
    if (/pg_advisory_(lock|unlock)/i.test(sql)) {
      return { rows: [] };
    }
    if (/FROM tanbot_telegram_update_dedup/i.test(sql) && /FOR UPDATE/i.test(sql)) {
      const id = Number(params?.[0]);
      if (id !== input.updateId) return { rows: [] };
      return {
        rows: [
          {
            reply_text: input.replyText,
            reply_extra: extra,
            reply_delivered_at: deliveredAt,
          },
        ],
      };
    }
    if (/jsonb_set/i.test(sql) && /'\{delivery\}'/i.test(sql)) {
      const field = String(params?.[1]);
      extra = {
        ...(extra ?? {}),
        delivery: {
          ...((extra?.delivery as Record<string, unknown>) ?? {}),
          [field]: true,
        },
      };
      return { rowCount: 1, rows: [] };
    }
    if (/reply_delivered_at = NOW/i.test(sql)) {
      deliveredAt = new Date();
      return { rowCount: 1, rows: [] };
    }
    if (/reply_extra =/i.test(sql)) {
      extra = params?.[1] as Record<string, unknown>;
      return { rowCount: 1, rows: [] };
    }
    return { rows: [], rowCount: 0 };
  };

  const client = {
    query: clientQuery,
    release: () => undefined,
  } as unknown as PoolClient;

  return {
    connect: async () => client,
    query: clientQuery,
  } as unknown as Pool;
}
