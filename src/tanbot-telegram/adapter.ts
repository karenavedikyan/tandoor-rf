import { parseTelegramGetMeResult, parseTelegramWebhookInfoResult } from "./validate";
import type {
  TanbotTelegramConfig,
  TelegramGetMeResult,
  TelegramTransportCall,
} from "./types";
import type { ValidatedWebhookInfo } from "./validate";

export async function telegramGetMe(
  config: TanbotTelegramConfig,
  transport: TelegramTransportCall,
): Promise<
  | { ok: true; me: TelegramGetMeResult }
  | { ok: false; code: string; message: string }
> {
  const result = await transport({
    method: "getMe",
    token: config.botToken,
    timeoutMs: config.requestTimeoutMs,
    maxResponseBytes: config.maxResponseBytes,
  });
  if (!result.ok) {
    return { ok: false, code: result.code, message: result.message };
  }
  const parsed = parseTelegramGetMeResult(result.result);
  if (!parsed.ok) {
    return { ok: false, code: "API_ERROR", message: parsed.message };
  }
  return { ok: true, me: parsed.me };
}

export async function telegramGetWebhookInfo(
  config: TanbotTelegramConfig,
  transport: TelegramTransportCall,
): Promise<
  | { ok: true; info: ValidatedWebhookInfo }
  | { ok: false; code: string; message: string }
> {
  const result = await transport({
    method: "getWebhookInfo",
    token: config.botToken,
    timeoutMs: config.requestTimeoutMs,
    maxResponseBytes: config.maxResponseBytes,
  });
  if (!result.ok) {
    return { ok: false, code: result.code, message: result.message };
  }
  const parsed = parseTelegramWebhookInfoResult(result.result);
  if (!parsed.ok) {
    return { ok: false, code: "API_ERROR", message: parsed.message };
  }
  return { ok: true, info: parsed.info };
}

export function usernamesMatch(expected: string, actual: string | undefined): boolean {
  if (!actual) return false;
  return expected.toLowerCase() === actual.replace(/^@+/, "").toLowerCase();
}
