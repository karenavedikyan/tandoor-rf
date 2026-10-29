import { getAppOrigin } from "../config";
import { getPool, query } from "../db/pool";
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
import { loadPartyEmployeeMap } from "./party-employee-map";
import { tanTrackerCanWrite } from "./guards";
import { loadWholesalePeerUserIds } from "./team-peers";
import { listAttachmentsForTransfers } from "./attachments";
import {
  TT56_USER_TEST_BANNER,
  isTanTrackerUserTestEnv,
} from "../shared/tan-tracker-user-test-env";

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

function collectParticipantPartyIds(dto: TanTrackerOrderDto): string[] {
  const ids = new Set<string>();
  if (dto.holderId) ids.add(dto.holderId);
  if (dto.pendingId) ids.add(dto.pendingId);
  if (dto.finalRecipientId) ids.add(dto.finalRecipientId);
  if (dto.createdById) ids.add(dto.createdById);
  for (const t of dto.timeline || []) {
    if (t.from) ids.add(t.from);
    if (t.to) ids.add(t.to);
  }
  return [...ids];
}

export async function buildTanTrackerBootstrap(
  authUser: UserDto,
  access: AccessContext,
): Promise<{
  lkMode: true;
  appOrigin: string | null;
  actorPartyId: string | null;
  actorContact: { id: string; kind: "user" | "external"; employeeId: string | null } | null;
  linkedEmployeeId: string | null;
  prototypeRole: string;
  navAllowed: boolean;
  previewReadOnly: boolean;
  contacts: TanTrackerContactDto[];
  orders: TanTrackerOrderDto[];
  capabilities: { canWrite: boolean };
  userTestEnvironmentBanner: string | null;
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
  const peerUserIds = await loadWholesalePeerUserIds(user.id, access.employeeId);
  const pickerUserIds = [...new Set([...teamUserIds, ...peerUserIds, user.id])];
  const ctx: TanTrackerScopeContext = {
    userId: user.id,
    role: user.role,
    employeeId: access.employeeId,
    actorPartyId,
    previewReadOnly: !!access.preview?.readOnly,
  };

  const transfers = await listAllTransferRows(pool);
  const allPartyIds = new Set<string>();
  const transferBundles: Array<{
    row: (typeof transfers)[0];
    timeline: Awaited<ReturnType<typeof listTimelineForTransfer>>;
    revoked: string[];
    dto: TanTrackerOrderDto;
  }> = [];

  for (const row of transfers) {
    const timeline = await listTimelineForTransfer(pool, row.id);
    const revoked = await listRevokedParties(pool, row.id);
    const dto = mapTransferToOrderDto(row, timeline, revoked);
    transferBundles.push({ row, timeline, revoked, dto });
    for (const pid of collectParticipantPartyIds(dto)) allPartyIds.add(pid);
  }

  const partyEmployeeMap = await loadPartyEmployeeMap(pool, [...allPartyIds]);

  const visibleTransferIds: string[] = [];
  const visiblePublicCodes: string[] = [];
  for (const { dto, row } of transferBundles) {
    if (canViewOrder(dto, ctx, [], teamEmployeeGuids, false, partyEmployeeMap)) {
      visibleTransferIds.push(row.id);
      visiblePublicCodes.push(dto.id);
    }
  }

  const attachmentMap = await listAttachmentsForTransfers(pool, visibleTransferIds);

  const partyRows = await listScopedPartyRows(pool, {
    actorPartyId,
    userId: user.id,
    visibleTransferIds: visiblePublicCodes,
    teamUserIds: pickerUserIds,
  });
  const contacts = partyRows.map(partyToContact);

  const orders: TanTrackerOrderDto[] = [];
  for (const { row, timeline, revoked } of transferBundles) {
    if (!visibleTransferIds.includes(row.id)) continue;
    const dto = mapTransferToOrderDto(row, timeline, revoked, {
      attachments: attachmentMap.get(row.id) ?? [],
    });
    if (canViewOrder(dto, ctx, contacts, teamEmployeeGuids, false, partyEmployeeMap)) {
      orders.push(dto);
    }
  }

  const actorContact =
    actorPartyId != null
      ? {
          id: actorPartyId,
          kind: (party?.kind ?? "user") as "user" | "external",
          employeeId: access.employeeId,
        }
      : null;

  const appOrigin = getAppOrigin() ?? null;

  return {
    lkMode: true,
    appOrigin,
    actorPartyId,
    actorContact,
    linkedEmployeeId: access.employeeId,
    prototypeRole: mapRoleToPrototype(user.role),
    navAllowed: tanTrackerNavAllowed(user.role),
    previewReadOnly: ctx.previewReadOnly,
    contacts,
    orders,
    capabilities: { canWrite: tanTrackerCanWrite(user, access) },
    userTestEnvironmentBanner: isTanTrackerUserTestEnv() ? TT56_USER_TEST_BANNER : null,
  };
}
