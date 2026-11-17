import type { PoolClient } from "pg";
import { normalizeRuPhoneE164 } from "../tan-tracker/phone-normalize";
import { profilePhoneNumbers } from "../tan-tracker/profile-phone";

export type MessengerChannel = "max" | "telegram";
export type MessengerAccount = {
  user_id: string;
  messenger_user_id: string;
  messenger_chat_id: string;
  username: string | null;
  phone_e164: string | null;
  phone_confirmed_at: Date | null;
  notifications_enabled: boolean;
  stopped_at: Date | null;
  is_primary: boolean;
};
// Identifiers are always selected from a closed server-owned union, never requests.
export function accountTables(channel: MessengerChannel) {
  if (channel !== "max" && channel !== "telegram") throw new Error("Invalid messenger channel");
  return { primary: `tanbot_${channel}_accounts`, additional: `tanbot_${channel}_additional_accounts`,
    all: `tanbot_${channel}_all_accounts`, prefix: channel };
}
export async function listMessengerAccounts(client: PoolClient, channel: MessengerChannel, userId: string) {
  const { all, prefix } = accountTables(channel);
  return (await client.query<MessengerAccount>(
    `SELECT user_id::text, ${prefix}_user_id::text AS messenger_user_id,
       ${prefix}_chat_id::text AS messenger_chat_id, ${prefix}_username AS username,
       phone_e164,phone_confirmed_at,notifications_enabled,stopped_at,is_primary
     FROM ${all} WHERE user_id=$1::uuid ORDER BY is_primary DESC,linked_at,${prefix}_user_id`, [userId])).rows;
}
export async function validateAccountPhone(client: PoolClient, userId: string, raw?: string | null) {
  if (raw == null || raw === "") return null; // legacy clients and unknown old binding
  const phone = normalizeRuPhoneE164(raw);
  const user = (await client.query<{ phone: string | null; additional_phone: string | null }>(
    "SELECT phone,additional_phone FROM users WHERE id=$1::uuid FOR SHARE", [userId])).rows[0];
  if (!phone || !user || !profilePhoneNumbers(user).includes(phone)) {
    throw Object.assign(new Error("Сначала сохраните этот номер в своём профиле."), { http: 409 });
  }
  return phone;
}
export async function messengerProfileStatus(client: PoolClient, channel: MessengerChannel, userId: string) {
  const accounts = (await listMessengerAccounts(client, channel, userId)).filter(a => !a.stopped_at);
  const user = (await client.query<{ phone: string | null; additional_phone: string | null }>(
    "SELECT phone,additional_phone FROM users WHERE id=$1::uuid", [userId])).rows[0];
  return {
    profilePhones: user ? profilePhoneNumbers(user) : [],
    accounts: accounts.map(a => ({
      accountId: a.messenger_user_id, username: a.username, phoneE164: a.phone_e164,
      phoneConfirmed: !!a.phone_confirmed_at, notificationsEnabled: a.notifications_enabled,
    })),
  };
}
/** Caller holds LK-user then messenger advisory locks, plus active-user check. Never replace another identity. */
export async function saveMessengerAccount(client: PoolClient, input: {
  channel: MessengerChannel; userId: string; messengerUserId: string; messengerChatId: string;
  username?: string | null; phone: string | null; phoneConfirmed?: boolean; enabled: boolean;
}) {
  const { primary, additional, all, prefix } = accountTables(input.channel);
  const existing = (await client.query<{ user_id: string; is_primary: boolean; phone_e164: string | null }>(
    `SELECT user_id::text,is_primary,phone_e164 FROM ${all} WHERE ${prefix}_user_id=$1`, [input.messengerUserId])).rows[0];
  if (existing && existing.user_id !== input.userId) {
    throw Object.assign(new Error("Этот аккаунт уже привязан к другому сотруднику."), { http: 409 });
  }
  const rows = await listMessengerAccounts(client, input.channel, input.userId);
  if (input.phone && rows.some(a => !a.stopped_at && a.phone_e164 === input.phone &&
    a.messenger_user_id !== input.messengerUserId)) {
    throw Object.assign(new Error("Для этого номера уже подключён другой аккаунт мессенджера."), { http: 409 });
  }
  // A consumed proof can refresh the SAME identity, never move it between phone slots.
  if (existing?.phone_e164 && input.phone && existing.phone_e164 !== input.phone) {
    const profile = (await client.query<{ phone: string | null; additional_phone: string | null }>(
      "SELECT phone,additional_phone FROM users WHERE id=$1::uuid", [input.userId])).rows[0];
    if (!profile || profilePhoneNumbers(profile).includes(existing.phone_e164)) {
      throw Object.assign(new Error("Этот аккаунт уже связан с другим номером. Подключите отдельный аккаунт."), { http: 409 });
    }
  }
  if (!existing && rows.filter(a => !a.stopped_at).length >= 8) {
    throw Object.assign(new Error("Достигнут предел подключённых аккаунтов."), { http: 409 });
  }
  const table = existing ? (existing.is_primary ? primary : additional) :
    rows.some(a => a.is_primary) ? additional : primary;
  if (existing) {
    await client.query(
      `UPDATE ${table} SET ${prefix}_chat_id=$3,${prefix}_username=COALESCE($4,${prefix}_username),
         phone_e164=COALESCE($5,phone_e164),
         phone_confirmed_at=CASE WHEN $7 THEN NOW()
           WHEN $5::text IS NOT NULL AND phone_e164 IS DISTINCT FROM $5 THEN NULL ELSE phone_confirmed_at END,
         notifications_enabled=$6,stopped_at=NULL,linked_at=NOW()
       WHERE user_id=$1::uuid AND ${prefix}_user_id=$2`,
      [input.userId,input.messengerUserId,input.messengerChatId,input.username ?? null,input.phone,input.enabled,
        input.phoneConfirmed === true]);
  } else {
    await client.query(
      `INSERT INTO ${table}
        (user_id,${prefix}_user_id,${prefix}_chat_id,${prefix}_username,phone_e164,notifications_enabled,phone_confirmed_at)
       VALUES ($1::uuid,$2,$3,$4,$5,$6,CASE WHEN $7 THEN NOW() ELSE NULL END)`,
      [input.userId,input.messengerUserId,input.messengerChatId,input.username ?? null,input.phone,input.enabled,
        input.phoneConfirmed === true]);
  }
}
/** Missing ID is the legacy primary account, NEVER "all accounts". */
export async function changeMessengerAccount(client: PoolClient, input: {
  channel: MessengerChannel; userId: string; accountId?: string; enabled?: boolean; disconnect?: boolean;
}) {
  const { primary, additional, prefix } = accountTables(input.channel);
  if (input.accountId !== undefined && !/^[1-9]\d{0,18}$/.test(input.accountId)) {
    throw Object.assign(new Error("Некорректный аккаунт."), { http: 409 });
  }
  let changed = 0;
  for (const table of input.accountId ? [primary, additional] : [primary]) {
    const result = await client.query(
      `UPDATE ${table} SET notifications_enabled=$2,
         stopped_at=CASE WHEN $3 THEN NOW() ELSE stopped_at END
       WHERE user_id=$1::uuid AND stopped_at IS NULL
         ${input.accountId ? `AND ${prefix}_user_id=$4` : ""}`,
      [input.userId,input.disconnect ? false : input.enabled === true,input.disconnect === true,
        ...(input.accountId ? [input.accountId] : [])]);
    changed += result.rowCount ?? 0;
  }
  if (!changed) throw Object.assign(new Error("Аккаунт не подключён или недоступен."), { http: 409 });
}
