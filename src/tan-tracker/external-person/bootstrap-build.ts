import type { Pool } from "pg";
import { getAppOrigin } from "../../config";
import { signHolderAccess, holderAccessTtlMs } from "../holder-access";
import type { TanTrackerContactDto } from "../types";
import { loadExternalPersonOrders, loadExternalHistoricalSummaries } from "./external-person-orders";
import { listEligibleStaffForExternalParty } from "../external-request/intake-handlers";
import { signExternalPersonCapability } from "./session-token";
import type { ResolvedExternalPerson } from "./resolve-auth";

export async function buildExternalPersonBootstrapPayload(
  pool: Pool,
  resolved: ResolvedExternalPerson,
): Promise<{
  externalPerson: true;
  lkMode: true;
  personId: string;
  partyId: string;
  displayName: string;
  phone: string;
  capability: string;
  appOrigin: string | null;
  actorPartyId: string;
  actorContact: { id: string; kind: "external"; employeeId: null };
  contacts: TanTrackerContactDto[];
  orders: Awaited<ReturnType<typeof loadExternalPersonOrders>>;
  historicalSummaries: Awaited<ReturnType<typeof loadExternalHistoricalSummaries>>;
  holderAccessToken: string | null;
  publicHolder: boolean;
  navAllowed: false;
  previewReadOnly: false;
  capabilities: { canWrite: true };
  prototypeRole: "manager";
  externalMessengerEnabled: false;
}> {
  const orders = await loadExternalPersonOrders(pool, resolved.partyId);
  const historicalSummaries = await loadExternalHistoricalSummaries(pool, resolved.partyId);
  const staff = await listEligibleStaffForExternalParty(pool, resolved.partyId);
  const contacts: TanTrackerContactDto[] = [
    {
      id: resolved.partyId,
      name: resolved.displayName,
      phone: resolved.phone,
      kind: "external",
      employeeId: null,
      team: null,
    },
  ];
  for (const s of staff) {
    const party = await pool.query<{ id: string; display_name: string; phone_e164: string | null }>(
      `SELECT id::text, display_name, phone_e164 FROM tt_parties WHERE user_id = $1::uuid AND kind = 'user' LIMIT 1`,
      [s.userId],
    );
    const p = party.rows[0];
    if (!p) continue;
    contacts.push({
      id: p.id,
      name: p.display_name || s.fullName,
      phone: p.phone_e164 || "",
      kind: "user",
      employeeId: null,
      team: null,
      userId: s.userId,
    } as TanTrackerContactDto & { userId: string });
  }
  let holderAccessToken: string | null = null;
  const holderRow = orders.find(
    (o) =>
      o.holderId === resolved.partyId &&
      o.status !== "completed" &&
      !o.pendingId &&
      (o.status === "active" || o.status === "waiting" || o.status === "delivered"),
  );
  if (holderRow) {
    const hv = Number(holderRow.handoffVer ?? 1);
    holderAccessToken = signHolderAccess({
      transferId: holderRow.id,
      partyId: resolved.partyId,
      hv,
      exp: Date.now() + holderAccessTtlMs(),
    });
  }
  const capability = signExternalPersonCapability(resolved.personId, 24 * 60 * 60 * 1000, resolved.accessEpoch);
  return {
    externalPerson: true,
    lkMode: true,
    personId: resolved.personId,
    partyId: resolved.partyId,
    displayName: resolved.displayName,
    phone: resolved.phone,
    capability,
    appOrigin: getAppOrigin() ?? null,
    actorPartyId: resolved.partyId,
    actorContact: { id: resolved.partyId, kind: "external", employeeId: null },
    contacts,
    orders,
    historicalSummaries,
    holderAccessToken,
    publicHolder: !!holderAccessToken,
    navAllowed: false,
    previewReadOnly: false,
    capabilities: { canWrite: true },
    prototypeRole: "manager",
    externalMessengerEnabled: false,
  };
}
