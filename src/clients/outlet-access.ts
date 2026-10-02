import type { AccessContext } from "../access/types";

/**
 * Deny-by-default for nested retail outlet payload until a permanent outlet GUID
 * and an approved access policy exist. Card-level access must not imply outlet access.
 *
 * Allowed exceptions follow the current access matrix only:
 * - admin: technical full read for servicing
 * - director with fullClientBase: company sales base read
 */
export function canReadNestedRetailOutlets(context: AccessContext): boolean {
  if (context.status !== "active") {
    return false;
  }
  if (context.role === "admin") {
    return true;
  }
  if (context.role === "director" && context.fullClientBase) {
    return true;
  }
  return false;
}

export const MAX_OUTLETS_IN_DETAIL_RESPONSE = 20;
