import type { TanTrackerOrderDto, TanTrackerContactDto, TanTrackerScopeContext } from "./types";

const TIMELINE_AUDIT_NOTES = new Set([
  "Назначен следующий получатель",
  "Ожидание передачи отменено",
]);

export function orderParticipantIds(o: TanTrackerOrderDto): Set<string> {
  const ids = new Set<string>();
  if (o.createdById) ids.add(o.createdById);
  if (o.holderId) ids.add(o.holderId);
  if (o.pendingId) ids.add(o.pendingId);
  if (o.finalRecipientId) ids.add(o.finalRecipientId);
  for (const t of o.timeline || []) {
    if (TIMELINE_AUDIT_NOTES.has(t.note)) continue;
    if (t.from) ids.add(t.from);
    if (t.to) ids.add(t.to);
  }
  return ids;
}

export function contactEmployeeId(
  contactId: string | null | undefined,
  contacts: TanTrackerContactDto[],
): string | null {
  if (!contactId) return null;
  const c = contacts.find((x) => x.id === contactId);
  return c?.employeeId ?? null;
}

/** Server-side visibility — mirrors prototype `canViewOrder` without URL role spoofing. */
export function canViewOrder(
  o: TanTrackerOrderDto,
  ctx: TanTrackerScopeContext,
  contacts: TanTrackerContactDto[],
  teamEmployeeIds: Set<string> | null,
  externalActing: boolean,
): boolean {
  if (!o || !ctx.actorPartyId) return false;
  if (externalActing) {
    const allowed = [o.holderId, o.pendingId, o.finalRecipientId].filter(Boolean) as string[];
    return allowed.includes(ctx.actorPartyId);
  }
  if (ctx.role === "director" || ctx.role === "admin") return true;
  const actor = ctx.actorPartyId;
  if ([o.holderId, o.pendingId, o.finalRecipientId].includes(actor)) return true;
  const participants = orderParticipantIds(o);
  if (participants.has(actor)) return true;
  if ((o.revokedParticipants || []).includes(actor)) return false;
  if (ctx.role === "rop" || ctx.role === "regional_manager") {
    if (teamEmployeeIds) {
      for (const cid of participants) {
        const eid = contactEmployeeId(cid, contacts);
        if (eid && teamEmployeeIds.has(eid)) return true;
      }
    }
  }
  return false;
}

export function tanTrackerNavAllowed(role: string): boolean {
  return !["marketer", "analyst", "category_manager"].includes(role);
}
