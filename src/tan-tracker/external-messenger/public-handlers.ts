import type { Request, Response } from "express";
import { getPool } from "../../db/pool";
import { setNoStore } from "../../http/no-store";
import { apiError, ERROR_CODES } from "../../shared/errors";
import { isExternalMessengerStartToken } from "./start-token";
import { lockSessionByStartToken, assertSessionTransferStillOpen } from "./session-service";
import {
  isExternalMessengerFeatureEnabled,
  resolveMessengerChannelAvailability,
} from "./config";
import { buildTelegramDeepLink } from "../../tanbot-telegram/link-tokens";
import { loadTanbotTelegramStage2Config } from "../../tanbot-telegram/stage2-config";
import { isTanbotTelegramEnabled } from "../../tanbot-telegram/config";
import { isPublicRecipientSmsAlternativeAvailable } from "../phone-verification";

function maxDeepLinkPlaceholder(startToken: string): string | null {
  const base = process.env.TANBOT_MAX_BOT_PUBLIC_LINK?.trim();
  if (!base) return null;
  try {
    const url = new URL(base);
    url.searchParams.set("start", startToken);
    return url.toString();
  } catch {
    return null;
  }
}

export async function publicExternalMessengerPortalHandler(req: Request, res: Response): Promise<void> {
  setNoStore(res);
  const mst = String(req.query.mst ?? "").trim();
  if (!isExternalMessengerStartToken(mst)) {
    res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, "Некорректная ссылка получателя."));
    return;
  }
  const pool = getPool();
  if (!pool) {
    res.status(503).json(apiError(ERROR_CODES.SERVICE_UNAVAILABLE, "Сервис временно недоступен."));
    return;
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const session = await lockSessionByStartToken(client, mst);
    if (!session) {
      await client.query("ROLLBACK");
      res.status(410).json(apiError(ERROR_CODES.NOT_FOUND, "Приглашение истекло или уже использовано."));
      return;
    }
    const open = await assertSessionTransferStillOpen(client, session);
    if (!open.ok) {
      await client.query("ROLLBACK");
      res.status(410).json(apiError(ERROR_CODES.NOT_FOUND, open.message));
      return;
    }
    const transfer = await client.query<{
      public_code: string;
      item_title: string;
      sender_display_name: string;
    }>(
      `SELECT t.public_code, t.item_title, hp.display_name AS sender_display_name
       FROM tt_transfers t
       JOIN tt_parties hp ON hp.id = t.holder_party_id
       WHERE t.id = $1`,
      [session.transfer_id],
    );
    await client.query("COMMIT");

    const channels = resolveMessengerChannelAvailability().map((c) => {
      let deepLink: string | null = null;
      if (c.available && c.channel === "telegram" && isTanbotTelegramEnabled()) {
        try {
          const loaded = loadTanbotTelegramStage2Config();
          if (loaded.ok) {
            deepLink = buildTelegramDeepLink(loaded.config.botUsername, mst);
          }
        } catch {
          deepLink = null;
        }
      }
      if (c.available && c.channel === "max") {
        deepLink = maxDeepLinkPlaceholder(mst);
      }
      return { ...c, deepLink };
    });

    res.status(200).json({
      messengerPortal: true,
      featureEnabled: isExternalMessengerFeatureEnabled(),
      transferPublicCode: transfer.rows[0]?.public_code ?? null,
      itemTitle: transfer.rows[0]?.item_title ?? "",
      senderDisplayName: transfer.rows[0]?.sender_display_name ?? "",
      startToken: mst,
      channels,
      smsAlternative: isPublicRecipientSmsAlternativeAvailable(),
    });
  } catch {
    await client.query("ROLLBACK").catch(() => undefined);
    res.status(503).json(apiError(ERROR_CODES.SERVICE_UNAVAILABLE, "Не удалось открыть страницу получателя."));
  } finally {
    client.release();
  }
}
