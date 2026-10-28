import { getPool } from "../db/pool";
import type { AccessContext } from "../access/types";
import type { UserDto } from "../shared/user";
import { resolveTanTrackerEffectiveUser } from "./effective-user";
import {
  findPartyByUserId,
  listAllTransferRows,
  listRevokedParties,
  listScopedPartyRows,
  listTimelineForTransfer,
  mapTransferToOrderDto,
  partyToContact,
} from "./repository";
import { canViewOrder, tanTrackerNavAllowed } from "./scope";
import { loadTanTrackerTeamEmployeeGuids } from "./team-scope";
import type { TanTrackerContactDto, TanTrackerOrderDto, TanTrackerScopeContext } from "./types";
import { query } from "../db/pool";

function mapRoleToPrototype(role: string): string {
  if (role === "regional_manager") return "regional";
  if (role === "assistant") return "assistant";
  if (role === "coordinator") return "coordinator";
  return role;
}

async function loadTeamUserIds(teamEmployeeGuids: Set<string> | null): Promise<string[]> {
  if (!teamEmployeeGuids || teamEmployeeGuids.size === 0) {
    return [];
  }
  const guids = [...teamEmployeeGuids];
  const res = await query<{ user_id: string }>(
    `SELECT DISTINCT user_id::text
     FROM user_onec_employee_links
     WHERE revoked_at IS NULL AND lower(employee_id::text) = ANY($1::text[])`,
    [guids.map((g) => g.toLowerCase())],
  );
  return res.rows.map((r) => r.user_id);
}

export async function buildTanTrackerBootstrap(
  authUser: UserDto,
  access: AccessContext,
): Promise<{
  lkMode: true;
  actorPartyId: string | null;
  prototypeRole: string;
  navAllowed: boolean;
  previewReadOnly: boolean;
  contacts: TanTrackerContactDto[];
  orders: TanTrackerOrderDto[];
  capabilities: { canWrite: boolean };
}> {
  const pool = getPool();
  if (!pool) {
    throw new Error("Database pool is not initialized");
  }
  const user = resolveTanTrackerEffectiveUser(authUser, access);
  const scopedAccess: AccessContext = { ...access, userId: user.id, role: user.role };
  const party = await findPartyByUserId(pool, user.id);
  const actorPartyId = party?.id ?? null;
  const teamEmployeeGuids = await loadTanTrackerTeamEmployeeGuids(scopedAccess);
  const teamUserIds = await loadTeamUserIds(teamEmployeeGuids);
  const ctx: TanTrackerScopeContext = {
    userId: user.id,
    role: user.role,
    employeeId: access.employeeId,
    actorPartyId,
    previewReadOnly: !!access.preview?.readOnly,
  };
  const transfers = await listAllTransferRows(pool);
  const orders: TanTrackerOrderDto[] = [];
  const visibleIds: string[] = [];
  for (const row of transfers) {
    const timeline = await listTimelineForTransfer(pool, row.id);
    const revoked = await listRevokedParties(pool, row.id);
    const dto = mapTransferToOrderDto(row, timeline, revoked);
    if (canViewOrder(dto, ctx, [], teamEmployeeGuids, false)) {
      visibleIds.push(row.id);
    }
  }
  const partyRows = await listScopedPartyRows(pool, {
    actorPartyId,
    userId: user.id,
    visibleTransferIds: visibleIds,
    teamUserIds,
  });
  const contacts = partyRows.map(partyToContact);
  for (const row of transfers) {
    if (!visibleIds.includes(row.id)) continue;
    const timeline = await listTimelineForTransfer(pool, row.id);
    const revoked = await listRevokedParties(pool, row.id);
    const dto = mapTransferToOrderDto(row, timeline, revoked);
    if (canViewOrder(dto, ctx, contacts, teamEmployeeGuids, false)) {
      orders.push(dto);
    }
  }
  return {
    lkMode: true,
    actorPartyId,
    prototypeRole: mapRoleToPrototype(user.role),
    navAllowed: tanTrackerNavAllowed(user.role),
    previewReadOnly: ctx.previewReadOnly,
    contacts,
    orders,
    capabilities: { canWrite: !ctx.previewReadOnly && user.role !== "admin" },
  };
}
