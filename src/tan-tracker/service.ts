import { getPool } from "../db/pool";
import type { AccessContext } from "../access/types";
import type { UserDto } from "../shared/user";
import {
  ensurePartyForUser,
  listAllTransfers,
  listParties,
  listRevokedParties,
  listTimelineForTransfer,
  mapTransferToOrderDto,
  partyToContact,
} from "./repository";
import { canViewOrder, tanTrackerNavAllowed } from "./scope";
import type { TanTrackerContactDto, TanTrackerOrderDto, TanTrackerScopeContext } from "./types";

function mapRoleToPrototype(role: string): string {
  if (role === "regional_manager") return "regional";
  if (role === "assistant") return "assistant";
  if (role === "coordinator") return "coordinator";
  return role;
}

export async function buildTanTrackerBootstrap(
  user: UserDto,
  access: AccessContext,
): Promise<{
  lkMode: true;
  actorPartyId: string;
  prototypeRole: string;
  navAllowed: boolean;
  previewReadOnly: boolean;
  contacts: TanTrackerContactDto[];
  orders: TanTrackerOrderDto[];
}> {
  const pool = getPool();
  if (!pool) {
    throw new Error("Database pool is not initialized");
  }
  const party = await ensurePartyForUser(
    pool,
    user.id,
    user.fullName,
    user.phone,
  );
  const ctx: TanTrackerScopeContext = {
    userId: user.id,
    role: user.role,
    employeeId: access.employeeId,
    actorPartyId: party.id,
    previewReadOnly: !!access.preview?.readOnly,
  };
  const partyRows = await listParties(pool);
  const contacts = partyRows.map(partyToContact);
  const transfers = await listAllTransfers(pool);
  const orders: TanTrackerOrderDto[] = [];
  for (const row of transfers) {
    const timeline = await listTimelineForTransfer(pool, row.id);
    const revoked = await listRevokedParties(pool, row.id);
    const dto = mapTransferToOrderDto(row, timeline, revoked);
    if (canViewOrder(dto, ctx, contacts, null, false)) {
      orders.push(dto);
    }
  }
  return {
    lkMode: true,
    actorPartyId: party.id,
    prototypeRole: mapRoleToPrototype(user.role),
    navAllowed: tanTrackerNavAllowed(user.role),
    previewReadOnly: ctx.previewReadOnly,
    contacts,
    orders,
  };
}
