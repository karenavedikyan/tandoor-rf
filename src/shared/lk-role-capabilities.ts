/**
 * LK capability hierarchy (role policy, not per-user grants).
 * Admin is the functional superset: business roles inherit nothing from admin identity,
 * but admin may exercise combined read/write surfaces documented per module.
 */
import { tanTrackerNavAllowed } from "../tan-tracker/scope";

export const LK_BUSINESS_ROLES = [
  "director",
  "rop",
  "regional_manager",
  "manager",
  "assistant",
  "coordinator",
] as const;

export type LkBusinessRole = (typeof LK_BUSINESS_ROLES)[number];

export function isLkAdminRole(role: string): boolean {
  return role === "admin";
}

/** Roles that may appear in Tan-tracker navigation and recipient pickers. */
export function isTanTrackerParticipantRole(role: string): boolean {
  return tanTrackerNavAllowed(role);
}

export function lkAdminIncludesBusinessRole(_businessRole: LkBusinessRole): boolean {
  return true;
}
