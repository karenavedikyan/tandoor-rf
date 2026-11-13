import type { PoolClient } from "pg";
import { normalizeRuPhoneE164 } from "../tan-tracker/phone-normalize";
import { lockPhonePartyResolution } from "../tan-tracker/phone-party-resolver";
import { findProfilesByPhone, profilePhoneNumbers } from "../tan-tracker/profile-phone";
import {
  lockTanbotMaxLkUser, lockTanbotMaxMessenger,
  lockTanbotTelegramLkUser, lockTanbotTelegramMessenger,
} from "./link-advisory-locks";
import {
  cancelActiveLinkAttempts as cancelMaxAttempts,
  insertLinkAudit as auditMax,
} from "../tanbot-max/link-repository";
import {
  cancelActiveLinkAttempts as cancelTelegramAttempts,
  insertLinkAudit as auditTelegram,
} from "../tanbot-telegram/link-repository";

type StaffCandidate = { id: string; phone: string | null; additional_phone?: string | null; status: string };
export type VerifiedContactStaffLink =
  | { kind: "external" }
  | { kind: "staff"; userId: string }
  | { kind: "rejected"; text: string };

async function candidates(client: PoolClient, phone: string, lock = false): Promise<StaffCandidate[]> {
  return findProfilesByPhone(client, phone, lock ? "update" : undefined);
}

const rejected = (text: string): VerifiedContactStaffLink => ({ kind: "rejected", text });
const conflict = () => rejected(
  "Не удалось подтвердить номер: обнаружен конфликт профилей или привязок. Обратитесь к администратору.",
);

/**
 * Called ONLY after provider-authenticated own-contact proof in a private chat.
 * Caller owns the transaction. No LK session, role grant, party merge or transfer
 * mutation is performed. External fallback keeps the existing phone resolver.
 *
 * Lock order: LK user (when known), messenger, phone, user/account rows.
 * Never acquire an LK lock after an external registration's messenger/phone lock.
 */
export async function linkStaffByVerifiedContact(
  client: PoolClient,
  input: { channel: "max" | "telegram"; messengerUserId: bigint; messengerChatId: bigint; phoneRaw: string },
): Promise<VerifiedContactStaffLink> {
  const phone = normalizeRuPhoneE164(input.phoneRaw);
  if (!phone) return rejected("Не удалось подтвердить номер: некорректный номер телефона.");
  const prefix = input.channel === "max" ? "max" : "telegram";
  const table = `tanbot_${prefix}_accounts`; // closed, server-owned identifiers only
  const lockUser = input.channel === "max" ? lockTanbotMaxLkUser : lockTanbotTelegramLkUser;
  const lockMessenger = input.channel === "max" ? lockTanbotMaxMessenger : lockTanbotTelegramMessenger;
  const initial = await candidates(client, phone);
  if (initial.length > 1) {
    return rejected("Не удалось подтвердить номер: номер связан с несколькими профилями. Обратитесь к администратору.");
  }
  const peek = initial[0];
  if (peek) await lockUser(client, peek.id);
  await lockMessenger(client, input.messengerUserId);
  await lockPhonePartyResolution(client, phone);
  const current = await candidates(client, phone, !!peek);
  // A concurrent phone/profile change must be retried, not matched to another user
  // while holding locks in the reverse order.
  if (current.length > 1 || current[0]?.id !== peek?.id) return conflict();
  const user = current[0];
  const messengerId = input.messengerUserId.toString();
  const chatId = input.messengerChatId.toString();
  const accounts = (await client.query<{
    user_id: string; messenger_user_id: string; messenger_chat_id: string;
    notifications_enabled: boolean; stopped_at: Date | null;
  }>(
    `SELECT user_id::text, ${prefix}_user_id::text AS messenger_user_id,
            ${prefix}_chat_id::text AS messenger_chat_id, notifications_enabled, stopped_at
     FROM ${table}
     WHERE ${prefix}_user_id = $1 OR user_id = $2::uuid
     ORDER BY user_id
     FOR UPDATE`,
    [messengerId, user?.id ?? null],
  )).rows;
  if (!user) {
    // A stopped staff binding remains reserved too: never turn it into an external identity.
    return accounts.length ? conflict() : { kind: "external" };
  }
  if (user.status !== "active") {
    return rejected("Не удалось подтвердить номер: аккаунт недоступен. Обратитесь к администратору.");
  }
  if (!profilePhoneNumbers(user).includes(phone)) return conflict();
  if (accounts.some(a => a.user_id !== user.id || a.messenger_user_id !== messengerId ||
    a.messenger_chat_id !== chatId)) return conflict();
  const external = await client.query(
    `SELECT 1 FROM tt_external_person_verifications v
     WHERE v.channel = $1 AND v.messenger_user_id = $2
     UNION ALL
     SELECT 1 FROM tt_parties p WHERE p.kind = 'external' AND p.phone_e164 = $3
     LIMIT 1`,
    [input.channel, messengerId, phone],
  );
  if ((external.rowCount ?? 0) > 0) return conflict();

  const existing = accounts[0];
  if (!existing || existing.stopped_at) {
    if (existing) {
      // Reconfirming one's own contact explicitly resumes ONLY this same binding.
      await client.query(
        `UPDATE ${table} SET stopped_at = NULL, notifications_enabled = TRUE, linked_at = NOW()
         WHERE user_id = $1::uuid`,
        [user.id],
      );
    } else {
      await client.query(
        `INSERT INTO ${table} (user_id, ${prefix}_user_id, ${prefix}_chat_id, notifications_enabled)
         VALUES ($1::uuid, $2, $3, TRUE)`,
        [user.id, messengerId, chatId],
      );
    }
    await (input.channel === "max" ? cancelMaxAttempts : cancelTelegramAttempts)(client, user.id);
    await (input.channel === "max" ? auditMax : auditTelegram)(client, {
      userId: user.id, actorUserId: user.id, action: "own_contact_link",
      detail: { via: "verified_own_contact", messengerUserId: messengerId, resumed: !!existing },
    });
  }
  return { kind: "staff", userId: user.id };
}
