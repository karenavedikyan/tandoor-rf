import { parseMaxGetMeResult, parseMaxSubscriptionsResult, usernamesMatch } from "./validate";
import type { MaxGetMeResult, MaxTransportCall, TanbotMaxConfig } from "./types";
import type { ValidatedSubscriptionsList } from "./validate";

export { usernamesMatch };

export async function maxGetMe(
  config: TanbotMaxConfig,
  transport: MaxTransportCall,
): Promise<{ ok: true; me: MaxGetMeResult } | { ok: false; code: string; message: string }> {
  const result = await transport({
    method: "me",
    token: config.botToken,
    timeoutMs: config.requestTimeoutMs,
    maxResponseBytes: config.maxResponseBytes,
  });
  if (!result.ok) {
    return { ok: false, code: result.code, message: result.message };
  }
  const parsed = parseMaxGetMeResult(result.result);
  if (!parsed.ok) {
    return { ok: false, code: "API_ERROR", message: parsed.message };
  }
  return { ok: true, me: parsed.me };
}

export async function maxGetSubscriptions(
  config: TanbotMaxConfig,
  transport: MaxTransportCall,
): Promise<
  { ok: true; info: ValidatedSubscriptionsList } | { ok: false; code: string; message: string }
> {
  const result = await transport({
    method: "subscriptions",
    token: config.botToken,
    timeoutMs: config.requestTimeoutMs,
    maxResponseBytes: config.maxResponseBytes,
  });
  if (!result.ok) {
    return { ok: false, code: result.code, message: result.message };
  }
  const parsed = parseMaxSubscriptionsResult(result.result);
  if (!parsed.ok) {
    return { ok: false, code: "API_ERROR", message: parsed.message };
  }
  return { ok: true, info: parsed.info };
}
