import type { Pool, PoolClient } from "pg";
import { normalizeRuPhoneE164, ruPhoneNational10 } from "./phone-normalize";

export type PhoneProfile = {
  id: string; full_name: string; phone: string | null; additional_phone: string | null; status: string; role: string;
};

export function profilePhoneNumbers(profile: { phone: string | null; additional_phone?: string | null }): string[] {
  return [...new Set([profile.phone, profile.additional_phone]
    .map(phone => normalizeRuPhoneE164(phone ?? "")).filter((phone): phone is string => !!phone))];
}

/** Profile-only identity lookup. Historical party metadata is never an identity proof. */
export async function findProfilesByPhone(
  client: Pool | PoolClient,
  phone: string,
  lock?: "share" | "update",
): Promise<PhoneProfile[]> {
  const national = ruPhoneNational10(phone);
  if (!national) return [];
  const locking = lock === "share" ? "FOR SHARE OF u" : lock === "update" ? "FOR UPDATE OF u" : "";
  return (await client.query<PhoneProfile>(
    `SELECT u.id::text,u.full_name,u.phone,u.additional_phone,u.status,u.role
     FROM users u
     CROSS JOIN LATERAL (SELECT regexp_replace(COALESCE(u.phone,''),'\\D','','g') AS d) norm
     WHERE (CASE WHEN length(d)=11 AND left(d,1) IN ('7','8') THEN right(d,10)
                 WHEN length(d)=10 THEN d ELSE NULL END)=$1
        OR u.additional_phone=('+7' || $1)
     ORDER BY u.id ${locking}`,
    [national],
  )).rows;
}
