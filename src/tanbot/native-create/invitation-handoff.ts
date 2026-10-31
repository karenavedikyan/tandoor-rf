import type { PoolClient } from "pg";
import { getAppOrigin } from "../../config";
import { mintExternalMessengerSession } from "../../tan-tracker/external-messenger/session-service";
import { buildTelegramDeepLink } from "../../tanbot-telegram/link-tokens";
import { buildMaxDeepLink } from "../../tanbot-max/link-tokens";
import { loadTanbotTelegramStage2Config } from "../../tanbot-telegram/stage2-config";
import { loadTanbotMaxStage2Config } from "../../tanbot-max/stage2-config";

/** Canonical holder invitation for external pending party (same session mint as LK). */
export async function buildExternalPendingInviteMessage(
  client: PoolClient,
  input: {
    transferId: string;
    pendingPartyId: string;
    handoffVersion: number;
    channel: "telegram" | "max";
  },
): Promise<string | null> {
  const minted = await mintExternalMessengerSession(client, {
    transferId: input.transferId,
    pendingPartyId: input.pendingPartyId,
    handoffVersion: input.handoffVersion,
  });
  if (!minted) return null;
  const origin = getAppOrigin() ?? "";
  const portalPath = `/tan-tracker/recipient?mst=${encodeURIComponent(minted.startToken)}`;
  const portalUrl = origin ? `${origin}${portalPath}` : portalPath;
  if (input.channel === "telegram") {
    const cfg = loadTanbotTelegramStage2Config();
    if (cfg.ok && cfg.config.botUsername) {
      const deep = buildTelegramDeepLink(cfg.config.botUsername, minted.startToken);
      return `Передача создана. Перешлите получателю ссылку для Telegram:\n${deep}\n\nИли веб: ${portalUrl}`;
    }
  } else {
    const cfg = loadTanbotMaxStage2Config();
    if (cfg.ok && cfg.config.botUsername) {
      const deep = buildMaxDeepLink(cfg.config.botUsername, minted.startToken);
      return `Передача создана. Перешлите получателю ссылку для MAX:\n${deep}\n\nИли веб: ${portalUrl}`;
    }
  }
  return `Передача создана. Ссылка для получателя:\n${portalUrl}`;
}
