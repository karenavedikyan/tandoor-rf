import type { Pool, PoolClient } from "pg";
import { normalizeRuPhoneE164, ruPhoneNational10 } from "./phone-normalize";
import { isTanTrackerParticipantRole } from "../shared/lk-role-capabilities";
import { lockPhonePartyResolution } from "./phone-party-resolver";

type Db = Pool | PoolClient;
type StaffRow = { id: string; full_name: string; phone: string | null; status: string; role: string; party_phone: string | null };

/** Exact phone matching is not a directory search and never changes account/bot identities. */
export async function findStaffRecipientByPhone(client: Db, phone: string): Promise<StaffRow | null> {
  const normalized = normalizeRuPhoneE164(phone);
  const national = normalized && ruPhoneNational10(normalized);
  if (!normalized || !national) {
    throw Object.assign(new Error("Введите телефон: 10 цифр после +7."), { http: 400 });
  }
  await lockPhonePartyResolution(client, normalized);
  const rows = (await client.query<StaffRow>(
    `SELECT u.id::text,u.full_name,u.phone,u.status,u.role,p.phone_e164 AS party_phone
     FROM users u LEFT JOIN tt_parties p ON p.user_id=u.id AND p.kind='user'
     CROSS JOIN LATERAL (SELECT regexp_replace(COALESCE(u.phone,''),'\\D','','g') AS d) norm
     WHERE (CASE WHEN length(d)=11 AND left(d,1) IN ('7','8') THEN right(d,10)
                 WHEN length(d)=10 THEN d ELSE NULL END)=$1
        OR p.phone_e164=$2
     FOR SHARE OF u`,
    [national, normalized],
  )).rows;
  // A stale party alias must not route to an employee whose current profile has another number.
  if (rows.some(u => u.party_phone === normalized && u.phone?.trim() && ruPhoneNational10(u.phone) !== national)) {
    throw Object.assign(new Error("Номер контакта изменился. Уточните актуальный телефон получателя."), { http: 409 });
  }
  const active = rows.filter(u => u.status === "active");
  if (active.length > 1) {
    throw Object.assign(new Error("Для номера найдено несколько сотрудников. Обратитесь к администратору."), { http: 409 });
  }
  if ((!active.length && rows.length > 0) || active.some(u => !isTanTrackerParticipantRole(u.role))) {
    throw Object.assign(new Error("Получатель недоступен для этой передачи."), { http: 403 });
  }
  return active[0] ?? null;
}
