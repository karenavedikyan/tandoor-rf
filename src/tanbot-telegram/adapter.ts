import type {
  TanbotTelegramConfig,
  TelegramGetMeResult,
  TelegramTransportCall,
  TelegramWebhookInfoResult,
} from "./types";

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
  const me = result.result as TelegramGetMeResult;
  if (!me || typeof me.id !== "number" || me.is_bot !== true) {
    return { ok: false, code: "API_ERROR", message: "Telegram getMe response is invalid." };
  }
  return { ok: true, me };
}

export async function telegramGetWebhookInfo(
  config: TanbotTelegramConfig,
  transport: TelegramTransportCall,
): Promise<
  | { ok: true; info: TelegramWebhookInfoResult }
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
  const info = (result.result ?? {}) as TelegramWebhookInfoResult;
  return { ok: true, info };
}

export function usernamesMatch(expected: string, actual: string | undefined): boolean {
  if (!actual) return false;
  return expected.toLowerCase() === actual.replace(/^@+/, "").toLowerCase();
}
