import { readBoundedResponseBody } from "../tanbot-telegram/bounded-body";
import { parseTelegramGetMeResult } from "../tanbot-telegram/validate";
import { parseMaxGetMeResult, usernamesMatch } from "../tanbot-max/validate";
import { TELEGRAM_API_ORIGIN } from "../tanbot-telegram/config";
import { MAX_API_ORIGIN } from "../tanbot-max/config";

export const TECHNICAL_BOT_ORIGIN = "https://karenavedikyan-tandoor-rf-24e1.twc1.net";
export const LEGACY_BOT_ORIGIN = "https://lk.tandoor.ru";
type Channel = "telegram" | "max";
export type MigrationResult = {
  channel: Channel;
  status: "switched" | "already_technical" | "blocked" | "failed" | "skipped";
  code: string;
  pendingUpdates?: number;
  foreignSubscriptionsPreserved?: boolean;
};
export type MigrationConfig = { token: string; secret: string; expectedUsername: string };
type Json = Record<string, unknown>;
type Subscription = { url: string; update_types?: string[] | null };

class MigrationFailure extends Error {
  constructor(readonly code: string) { super(code); }
}
function object(value: unknown): Json {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new MigrationFailure("INVALID_API_RESPONSE");
  return value as Json;
}
function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === "string");
}
function path(channel: Channel): string { return `/api/tanbot-${channel}/webhook`; }
function ownedUrl(value: unknown, origin: string, channel: Channel): boolean {
  return value === `${origin}${path(channel)}` || value === `${origin}${path(channel)}/`;
}
function equalTypes(a: string[] | null | undefined, b: string[] | null | undefined): boolean {
  // Compare null/absent without inferring undocumented event-filter semantics.
  return a == null || b == null
    ? a == null && b == null
    : JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
}
async function request(
  fetcher: typeof fetch, url: string, method: string, headers: Record<string, string>, body?: unknown,
): Promise<Json> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetcher(url, {
      method, redirect: "error", signal: controller.signal,
      headers: { Accept: "application/json", ...headers, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok) throw new MigrationFailure(`API_HTTP_${response.status}`);
    const bounded = await readBoundedResponseBody(response, 262_144);
    if (!bounded.ok) throw new MigrationFailure("API_BODY_UNREADABLE");
    try { return object(JSON.parse(bounded.text)); }
    catch (error) {
      if (error instanceof MigrationFailure) throw error;
      throw new MigrationFailure("INVALID_API_RESPONSE");
    }
  } catch (error) {
    if (error instanceof MigrationFailure) throw error;
    // Never propagate fetch errors: Telegram URLs contain the bot token.
    throw new MigrationFailure("API_NETWORK_ERROR");
  } finally { clearTimeout(timer); }
}
async function probeRoute(channel: Channel, secret: string, fetcher: typeof fetch): Promise<void> {
  const url = `${TECHNICAL_BOT_ORIGIN}${path(channel)}`;
  const secretHeader = channel === "telegram" ? "X-Telegram-Bot-Api-Secret-Token" : "X-Max-Bot-Api-Secret";
  for (const authenticated of [false, true]) {
    let response: Response;
    try {
      response = await fetcher(url, {
        method: "POST", redirect: "error", signal: AbortSignal.timeout(5_000),
        headers: { "Content-Type": "application/json", ...(authenticated ? { [secretHeader]: secret } : {}) },
        body: "[]",
      });
      await response.body?.cancel();
    } catch { throw new MigrationFailure("ROUTE_UNREACHABLE"); }
    if (response.status !== (authenticated ? 400 : 403)) throw new MigrationFailure("ROUTE_AUTH_MISMATCH");
  }
}
function safeResult(channel: Channel, error: unknown): MigrationResult {
  const code = error instanceof MigrationFailure ? error.code : "UNEXPECTED_ERROR";
  const blocked = ["UNVERIFIED_WEBHOOK", "BOT_IDENTITY_MISMATCH", "CUSTOM_CERTIFICATE",
    "AMBIGUOUS_LEGACY_SUBSCRIPTION", "SUBSCRIPTION_TYPES_MISMATCH", "INVALID_SECRET",
    "INVALID_API_RESPONSE", "ROUTE_AUTH_MISMATCH", "UNSPECIFIED_EVENT_FILTER"].includes(code);
  return { channel, status: blocked ? "blocked" : "failed", code };
}

export async function migrateTelegramWebhook(
  config: MigrationConfig, apiFetch: typeof fetch = fetch, routeFetch: typeof fetch = fetch,
): Promise<MigrationResult> {
  try {
    if (!/^[A-Za-z0-9_-]{16,256}$/.test(config.secret)) throw new MigrationFailure("INVALID_SECRET");
    async function call(method: "getMe" | "getWebhookInfo" | "setWebhook", body?: unknown): Promise<unknown> {
      const envelope = await request(apiFetch, `${TELEGRAM_API_ORIGIN}/bot${config.token}/${method}`,
        body === undefined ? "GET" : "POST", {}, body);
      if (envelope.ok !== true) throw new MigrationFailure("TELEGRAM_API_REJECTED");
      return envelope.result;
    }
    const me = parseTelegramGetMeResult(await call("getMe"));
    if (!me.ok || !usernamesMatch(config.expectedUsername, me.me.username)) throw new MigrationFailure("BOT_IDENTITY_MISMATCH");
    const before = object(await call("getWebhookInfo"));
    const already = ownedUrl(before.url, TECHNICAL_BOT_ORIGIN, "telegram");
    if (!already && !ownedUrl(before.url, LEGACY_BOT_ORIGIN, "telegram")) throw new MigrationFailure("UNVERIFIED_WEBHOOK");
    if (before.has_custom_certificate !== false) throw new MigrationFailure("CUSTOM_CERTIFICATE");
    await probeRoute("telegram", config.secret, routeFetch);
    if (already) return { channel: "telegram", status: "already_technical", code: "VERIFIED",
      ...(Number.isInteger(before.pending_update_count) ? { pendingUpdates: before.pending_update_count as number } : {}) };
    if (before.allowed_updates !== undefined && !stringArray(before.allowed_updates)) throw new MigrationFailure("INVALID_API_RESPONSE");
    if (before.max_connections !== undefined && (!Number.isInteger(before.max_connections)
      || (before.max_connections as number) < 1 || (before.max_connections as number) > 100)) throw new MigrationFailure("INVALID_API_RESPONSE");
    const body = {
      url: `${TECHNICAL_BOT_ORIGIN}${path("telegram")}`,
      secret_token: config.secret, drop_pending_updates: false,
      ...(before.allowed_updates !== undefined ? { allowed_updates: before.allowed_updates } : {}),
      ...(before.max_connections !== undefined ? { max_connections: before.max_connections } : {}),
    };
    if (await call("setWebhook", body) !== true) throw new MigrationFailure("TELEGRAM_API_REJECTED");
    const after = object(await call("getWebhookInfo"));
    if (!ownedUrl(after.url, TECHNICAL_BOT_ORIGIN, "telegram")) throw new MigrationFailure("VERIFY_FAILED");
    if (before.allowed_updates !== undefined && (!stringArray(after.allowed_updates)
      || !equalTypes(before.allowed_updates as string[], after.allowed_updates))) throw new MigrationFailure("VERIFY_FAILED");
    if (before.max_connections !== undefined && before.max_connections !== after.max_connections) throw new MigrationFailure("VERIFY_FAILED");
    return { channel: "telegram", status: "switched", code: "VERIFIED",
      ...(Number.isInteger(after.pending_update_count) ? { pendingUpdates: after.pending_update_count as number } : {}) };
  } catch (error) { return safeResult("telegram", error); }
}

export async function migrateMaxWebhook(
  config: MigrationConfig, apiFetch: typeof fetch = fetch, routeFetch: typeof fetch = fetch,
): Promise<MigrationResult> {
  try {
    if (!/^[A-Za-z0-9_-]{16,256}$/.test(config.secret)) throw new MigrationFailure("INVALID_SECRET");
    const headers = { Authorization: config.token };
    const me = parseMaxGetMeResult(await request(apiFetch, `${MAX_API_ORIGIN}/me`, "GET", headers));
    if (!me.ok || !usernamesMatch(config.expectedUsername, me.me.username)) throw new MigrationFailure("BOT_IDENTITY_MISMATCH");
    async function subscriptions(): Promise<Subscription[]> {
      const raw = await request(apiFetch, `${MAX_API_ORIGIN}/subscriptions`, "GET", headers);
      if (!Array.isArray(raw.subscriptions)) throw new MigrationFailure("INVALID_API_RESPONSE");
      return raw.subscriptions.map(item => {
        const sub = object(item);
        if (typeof sub.url !== "string" || !sub.url
          || (sub.update_types != null && !stringArray(sub.update_types))) throw new MigrationFailure("INVALID_API_RESPONSE");
        return { url: sub.url, ...(sub.update_types !== undefined ? { update_types: sub.update_types as string[] | null } : {}) };
      });
    }
    const before = await subscriptions();
    const legacy = before.filter(sub => ownedUrl(sub.url, LEGACY_BOT_ORIGIN, "max"));
    const technical = before.filter(sub => ownedUrl(sub.url, TECHNICAL_BOT_ORIGIN, "max"));
    if (legacy.length > 1 || technical.length > 1) throw new MigrationFailure("AMBIGUOUS_LEGACY_SUBSCRIPTION");
    if (!legacy.length && !technical.length) throw new MigrationFailure("UNVERIFIED_WEBHOOK");
    await probeRoute("max", config.secret, routeFetch);
    function foreignFingerprint(subs: Subscription[]): string {
      return JSON.stringify(subs.filter(sub => !ownedUrl(sub.url, LEGACY_BOT_ORIGIN, "max")
        && !ownedUrl(sub.url, TECHNICAL_BOT_ORIGIN, "max"))
        .map(sub => [sub.url, sub.update_types == null ? null : [...sub.update_types].sort()])
        .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
    }
    if (!legacy.length) return { channel: "max", status: "already_technical", code: "VERIFIED", foreignSubscriptionsPreserved: true };
    const old = legacy[0];
    if (old.update_types == null) throw new MigrationFailure("UNSPECIFIED_EVENT_FILTER");
    if (technical.length && !equalTypes(old.update_types, technical[0].update_types)) throw new MigrationFailure("SUBSCRIPTION_TYPES_MISMATCH");
    if (!technical.length) {
      const created = await request(apiFetch, `${MAX_API_ORIGIN}/subscriptions`, "POST", headers, {
        url: `${TECHNICAL_BOT_ORIGIN}${path("max")}`, secret: config.secret,
        update_types: old.update_types,
      });
      if (created.success !== true) throw new MigrationFailure("MAX_API_REJECTED");
    }
    const added = await subscriptions();
    const newSubscriptions = added.filter(sub => ownedUrl(sub.url, TECHNICAL_BOT_ORIGIN, "max"));
    if (newSubscriptions.length !== 1 || !equalTypes(old.update_types, newSubscriptions[0].update_types)
      || foreignFingerprint(before) !== foreignFingerprint(added)) throw new MigrationFailure("VERIFY_FAILED");
    // Only this exact, allowlisted old URL can be removed, and only after verification.
    const removed = await request(apiFetch,
      `${MAX_API_ORIGIN}/subscriptions?url=${encodeURIComponent(old.url)}`, "DELETE", headers);
    if (removed.success !== true) throw new MigrationFailure("MAX_API_REJECTED");
    const after = await subscriptions();
    const finalTarget = after.filter(sub => ownedUrl(sub.url, TECHNICAL_BOT_ORIGIN, "max"));
    if (after.some(sub => ownedUrl(sub.url, LEGACY_BOT_ORIGIN, "max"))
      || finalTarget.length !== 1 || !equalTypes(old.update_types, finalTarget[0].update_types)
      || foreignFingerprint(before) !== foreignFingerprint(after)) throw new MigrationFailure("VERIFY_FAILED");
    return { channel: "max", status: "switched", code: "VERIFIED", foreignSubscriptionsPreserved: true };
  } catch (error) { return safeResult("max", error); }
}
