import type { MaxGetMeResult } from "./types";

const USERNAME_PATTERN = /^[A-Za-z0-9_]{3,64}$/;

export type ValidatedSubscriptionsList = {
  subscriptions: Array<{ url: string; updateTypes: string[] | null }>;
};

export function parseMaxGetMeResult(raw: unknown):
  | { ok: true; me: MaxGetMeResult }
  | { ok: false; message: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, message: "MAX /me response is invalid." };
  }
  const row = raw as Record<string, unknown>;
  const userId = row.user_id;
  if (typeof userId !== "number" || !Number.isInteger(userId) || userId <= 0) {
    return { ok: false, message: "MAX /me response is invalid." };
  }
  if (row.is_bot !== true) {
    return { ok: false, message: "MAX /me response is invalid." };
  }
  let username: string | undefined;
  if (row.username !== undefined && row.username !== null) {
    if (typeof row.username !== "string") {
      return { ok: false, message: "MAX /me response is invalid." };
    }
    const normalized = row.username.replace(/^@+/, "");
    if (!USERNAME_PATTERN.test(normalized)) {
      return { ok: false, message: "MAX /me response is invalid." };
    }
    username = normalized;
  }
  const first_name = typeof row.first_name === "string" ? row.first_name : undefined;
  return { ok: true, me: { user_id: userId, is_bot: true, username, first_name } };
}

export function parseMaxSubscriptionsResult(raw: unknown):
  | { ok: true; info: ValidatedSubscriptionsList }
  | { ok: false; message: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, message: "MAX /subscriptions response is invalid." };
  }
  const row = raw as Record<string, unknown>;
  const subs = row.subscriptions;
  if (!Array.isArray(subs)) {
    return { ok: true, info: { subscriptions: [] } };
  }
  const subscriptions: ValidatedSubscriptionsList["subscriptions"] = [];
  for (const item of subs) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const sub = item as Record<string, unknown>;
    if (typeof sub.url !== "string") continue;
    const updateTypes =
      sub.update_types === null || sub.update_types === undefined
        ? null
        : Array.isArray(sub.update_types) &&
            sub.update_types.every((t) => typeof t === "string")
          ? (sub.update_types as string[])
          : null;
    subscriptions.push({ url: sub.url.trim(), updateTypes });
  }
  return { ok: true, info: { subscriptions } };
}

export function usernamesMatch(expected: string, actual: string | undefined): boolean {
  if (!actual) return false;
  return expected.toLowerCase() === actual.replace(/^@+/, "").toLowerCase();
}
