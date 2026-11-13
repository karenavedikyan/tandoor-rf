import type { Pool, PoolClient } from "pg";
import { normalizeRuPhoneE164, ruPhoneNational10 } from "./phone-normalize";
import { isTanTrackerParticipantRole } from "../shared/lk-role-capabilities";
import { lockPhonePartyResolution } from "./phone-party-resolver";
import { findProfilesByPhone, type PhoneProfile } from "./profile-phone";

type Db = Pool | PoolClient;

/** Exact phone matching is not a directory search and never changes account/bot identities. */
export async function findStaffRecipientByPhone(client: Db, phone: string): Promise<PhoneProfile | null> {
  const normalized = normalizeRuPhoneE164(phone);
  const national = normalized && ruPhoneNational10(normalized);
  if (!normalized || !national) {
    throw Object.assign(new Error("Введите телефон: 10 цифр после +7."), { http: 400 });
  }
  await lockPhonePartyResolution(client, normalized);
  const rows = await findProfilesByPhone(client, normalized, "share");
  const active = rows.filter(u => u.status === "active");
  if (active.length > 1) {
    throw Object.assign(new Error("Для номера найдено несколько сотрудников. Обратитесь к администратору."), { http: 409 });
  }
  if ((!active.length && rows.length > 0) || active.some(u => !isTanTrackerParticipantRole(u.role))) {
    throw Object.assign(new Error("Получатель недоступен для этой передачи."), { http: 403 });
  }
  return active[0] ?? null;
}
