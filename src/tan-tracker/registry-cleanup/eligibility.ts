import type { PoolClient } from "pg";
import type { TanTrackerOrderDto, TanTrackerTransferRow } from "../types";
import { canViewOrder } from "../scope";
import type { TanTrackerScopeContext } from "../types";
import { transferHasConfirmedFirstCustody, isBeforeFirstConfirmedCustody } from "../custody-state";
import type { RegistryCleanupActor } from "./context";

export type CleanupMode =
  | "personal"
  | "personal-restore"
  | "personal-hide"
  | "personal-unhide"
  | "general-archive"
  | "general-restore"
  | "delete";

export function orderCreatorPartyId(o: TanTrackerOrderDto): string | null {
  return o.createdById ?? null;
}

export function isTerminalForPersonalArchive(o: TanTrackerOrderDto): boolean {
  return o.status === "completed" || o.status === "delivered";
}

export function actorSeesOrder(
  o: TanTrackerOrderDto,
  actor: RegistryCleanupActor,
  ctx: TanTrackerScopeContext,
  contacts: Parameters<typeof canViewOrder>[2],
  teamGuids: Set<string> | null,
  partyEmployeeMap: Map<string, string | null>,
): boolean {
  return canViewOrder(o, ctx, contacts, teamGuids, false, partyEmployeeMap);
}

export function canPersonalArchiveOrder(
  o: TanTrackerOrderDto,
  actor: RegistryCleanupActor,
  ctx: TanTrackerScopeContext,
  contacts: Parameters<typeof canViewOrder>[2],
  teamGuids: Set<string> | null,
  partyEmployeeMap: Map<string, string | null>,
  generalArchived: boolean,
  alreadyPersonalArchived: boolean,
): boolean {
  if (actor.previewReadOnly) return false;
  if (!actorSeesOrder(o, actor, ctx, contacts, teamGuids, partyEmployeeMap)) return false;
  if (generalArchived || alreadyPersonalArchived) return false;
  if (o.pendingId) return false;
  if (!isTerminalForPersonalArchive(o)) return false;
  return true;
}

export function canPersonalHideOrder(
  o: TanTrackerOrderDto,
  actor: RegistryCleanupActor,
  ctx: TanTrackerScopeContext,
  contacts: Parameters<typeof canViewOrder>[2],
  teamGuids: Set<string> | null,
  partyEmployeeMap: Map<string, string | null>,
): boolean {
  if (actor.previewReadOnly) return false;
  if (orderCreatorPartyId(o) !== actor.partyId) return false;
  return actorSeesOrder(o, actor, ctx, contacts, teamGuids, partyEmployeeMap);
}

export function canGeneralArchiveOrder(
  o: TanTrackerOrderDto,
  actor: RegistryCleanupActor,
  row: TanTrackerTransferRow,
): boolean {
  if (!actor.isAdmin || actor.previewReadOnly) return false;
  if (row.general_archived_at) return false;
  if (o.pendingId) return false;
  return isTerminalForPersonalArchive(o);
}

export function canGeneralRestoreOrder(row: TanTrackerTransferRow, actor: RegistryCleanupActor): boolean {
  return actor.isAdmin && !actor.previewReadOnly && !!row.general_archived_at;
}

export async function canDeleteOrder(
  client: PoolClient,
  o: TanTrackerOrderDto,
  row: TanTrackerTransferRow,
  actor: RegistryCleanupActor,
): Promise<boolean> {
  if (actor.previewReadOnly) return false;
  const creator = orderCreatorPartyId(o);
  const allowedRole = actor.isAdmin || (creator != null && creator === actor.partyId);
  if (!allowedRole) return false;
  if (!isBeforeFirstConfirmedCustody(row)) return false;
  if (await transferHasConfirmedFirstCustody(client, row.id)) return false;
  if (row.status === "completed") return false;
  return true;
}
