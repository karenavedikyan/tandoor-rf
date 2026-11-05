/**
 * LK capability hierarchy (role policy, not per-user grants).
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

export function isTanTrackerParticipantRole(role: string): boolean {
  return tanTrackerNavAllowed(role);
}

/** Tan-tracker write (preview read-only handled separately in guards). */
export function lkCanWriteTanTracker(role: string): boolean {
  return tanTrackerNavAllowed(role);
}

/** ROP capabilities always require a separate current-team check on the server. */
export function lkCanAuthorAssignment(role: string, actorUserId: string, delegatorUserId: string): boolean {
  if (lkCanPrepareAssignmentOnBehalfOfManager(role)) return true;
  return role === "manager" && actorUserId === delegatorUserId;
}

/** Operational decisions; ROP is scoped to their current team, not global. */
export function lkCanCoordinatorAssignmentDecisions(role: string): boolean {
  return ["coordinator", "director", "rop", "admin"].includes(role);
}

export function lkCanReadAssignmentActivity(role: string): boolean {
  return ["director", "coordinator", "rop", "admin"].includes(role);
}

export function lkCanReadAssignmentReviewsOverview(role: string): boolean {
  return ["manager", "coordinator", "director", "admin"].includes(role);
}

export function lkCanPickAssignmentManagers(role: string): boolean {
  return ["coordinator", "director", "rop", "admin"].includes(role);
}

export function lkCanSearchAssignmentAssistants(role: string): boolean {
  return role === "manager" || lkCanPrepareAssignmentOnBehalfOfManager(role);
}

export function lkCanPrepareAssignmentOnBehalfOfManager(role: string): boolean {
  return ["coordinator", "director", "rop", "admin"].includes(role);
}

/** Mandatory review submission stays with the real delegating manager only. */
export function lkCanSubmitAssignmentReview(role: string): boolean {
  return role === "manager";
}
