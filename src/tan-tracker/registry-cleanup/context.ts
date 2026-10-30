import type { AccessContext } from "../../access/types";
import type { UserDto } from "../../shared/user";
import { resolveTanTrackerEffectiveUser } from "../effective-user";
import type { TanTrackerScopeContext } from "../types";

export type RegistryCleanupActor = {
  userId: string | null;
  role: string;
  partyId: string;
  previewReadOnly: boolean;
  isAdmin: boolean;
};

export function registryCleanupActorFromAccess(
  authUser: UserDto,
  access: AccessContext,
  actorPartyId: string | null,
): RegistryCleanupActor | null {
  if (!actorPartyId) return null;
  const user = resolveTanTrackerEffectiveUser(authUser, access);
  return {
    userId: user.id,
    role: user.role,
    partyId: actorPartyId,
    previewReadOnly: !!access.preview?.readOnly,
    isAdmin: user.role === "admin",
  };
}

export function registryCleanupActorFromExternalParty(partyId: string): RegistryCleanupActor {
  return {
    userId: null,
    role: "external",
    partyId,
    previewReadOnly: false,
    isAdmin: false,
  };
}

export function scopeContextFromActor(actor: RegistryCleanupActor): TanTrackerScopeContext {
  return {
    userId: actor.userId ?? "",
    role: actor.role,
    employeeId: null,
    actorPartyId: actor.partyId,
    previewReadOnly: actor.previewReadOnly,
  };
}
