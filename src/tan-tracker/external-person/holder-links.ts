import type { PoolClient } from "pg";
import { getAppOrigin } from "../../config";
import { signHolderAccess, holderAccessTtlMs } from "../holder-access";
import { signExternalPersonCapability } from "./session-token";

export function buildExternalPersonShellUrl(appOrigin: string, capability: string): string {
  const base = appOrigin.replace(/\/$/, "");
  return `${base}/tan-tracker/?cap=${encodeURIComponent(capability)}`;
}

export function buildExternalHolderUrl(appOrigin: string, capability: string, holderAccessToken: string): string {
  const base = appOrigin.replace(/\/$/, "");
  const q = new URLSearchParams();
  q.set("cap", capability);
  q.set("tt_hat", holderAccessToken);
  return `${base}/tan-tracker/?${q.toString()}`;
}

/** Signed deep links for Telegram/MAX after handoff milestones. */
export async function signExternalPersonMessengerLinks(
  client: PoolClient,
  input: {
    externalPartyId: string;
    transferId: string;
    handoffVersion: number;
  },
): Promise<{ shellUrl: string; holderUrl: string | null } | null> {
  const row = await client.query<{ person_id: string; access_epoch: number }>(
    `SELECT p.id::text AS person_id, p.access_epoch
     FROM tt_external_persons p
     WHERE p.party_id = $1::uuid
     LIMIT 1`,
    [input.externalPartyId],
  );
  const person = row.rows[0];
  if (!person) return null;
  const origin = getAppOrigin();
  if (!origin) return null;
  const capability = signExternalPersonCapability(person.person_id, 24 * 60 * 60 * 1000, person.access_epoch);
  const shellUrl = buildExternalPersonShellUrl(origin, capability);
  const hat = signHolderAccess({
    transferId: input.transferId,
    partyId: input.externalPartyId,
    hv: input.handoffVersion,
    exp: Date.now() + holderAccessTtlMs(),
  });
  return { shellUrl, holderUrl: buildExternalHolderUrl(origin, capability, hat) };
}
