import type { Pool } from "pg";
import { hashExternalPersonSessionToken, verifyExternalPersonCapability } from "./session-token";
import { requireHandoffOtpPepper } from "../otp-config";

export type ResolvedExternalPerson = {
  personId: string;
  partyId: string;
  displayName: string;
  phone: string;
  accessEpoch: number;
};

export async function resolveExternalPersonAuth(
  pool: Pool,
  input: { est?: string; cap?: string },
): Promise<ResolvedExternalPerson | null> {
  const est = input.est?.trim() ?? "";
  const cap = input.cap?.trim() ?? "";
  let personId: string | null = null;
  let capEpoch: number | null = null;
  if (cap) {
    const payload = verifyExternalPersonCapability(cap);
    if (!payload) return null;
    personId = payload.personId;
    capEpoch = payload.epoch ?? null;
  } else if (est) {
    let pepper: string;
    try {
      pepper = requireHandoffOtpPepper();
    } catch {
      return null;
    }
    const hash = hashExternalPersonSessionToken(est, pepper);
    const session = await pool.query<{ person_id: string }>(
      `SELECT person_id::text FROM tt_external_person_sessions
       WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > NOW() LIMIT 1`,
      [hash],
    );
    personId = session.rows[0]?.person_id ?? null;
  } else {
    return null;
  }
  if (!personId) return null;
  const person = await pool.query<{
    party_id: string;
    phone_e164: string;
    display_name: string;
    access_epoch: number;
  }>(
    `SELECT party_id::text, phone_e164, display_name, access_epoch FROM tt_external_persons WHERE id = $1::uuid LIMIT 1`,
    [personId],
  );
  const p = person.rows[0];
  if (!p) return null;
  if (cap && capEpoch != null && capEpoch !== p.access_epoch) return null;
  return {
    personId,
    partyId: p.party_id,
    displayName: p.display_name,
    phone: p.phone_e164,
    accessEpoch: p.access_epoch,
  };
}
