import type { PoolClient } from "pg";
import { resolveKnownGlobalExternalPartyByPhone } from "../phone-party-resolver";

export type KnownExternalParty = {
  partyId: string;
  displayName: string;
};

/** External party must already exist (staff-created contact). No self-registration. */
export async function resolveKnownExternalPartyByPhone(
  client: PoolClient,
  phoneE164: string,
): Promise<KnownExternalParty | null> {
  return resolveKnownGlobalExternalPartyByPhone(client, phoneE164);
}
