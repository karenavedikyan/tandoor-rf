import type { AccessContext } from "../access/types";
import type { UserDto } from "../shared/user";

/** Business identity for Tan-tracker: preview target, not admin actor. */
export function resolveTanTrackerEffectiveUser(
  authUser: UserDto,
  access: AccessContext,
): UserDto {
  if (access.preview?.active && access.preview.targetUser) {
    return access.preview.targetUser;
  }
  return authUser;
}

export function resolveTanTrackerAuditUserId(
  authUser: UserDto,
  access: AccessContext,
): string {
  return authUser.id;
}
