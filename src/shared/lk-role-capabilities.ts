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

/** Assignment author: manager for own delegations; coordinator/admin for any valid delegator. */
export function lkCanAuthorAssignment(role: string, actorUserId: string, delegatorUserId: string): boolean {
  if (role === "coordinator" || role === "admin") return true;
  return role === "manager" && actorUserId === delegatorUserId;
}

/** Coordinator decisions (approve/reject/revoke/change decisions). */
export function lkCanCoordinatorAssignmentDecisions(role: string): boolean {
  return role === "coordinator" || role === "admin";
}

export function lkCanReadAssignmentActivity(role: string): boolean {
  return role === "director" || role === "coordinator" || role === "admin";
}

export function lkCanReadAssignmentReviewsOverview(role: string): boolean {
  return ["manager", "coordinator", "director", "admin"].includes(role);
}

export function lkCanPickAssignmentManagers(role: string): boolean {
  return role === "coordinator" || role === "admin";
}

export function lkCanSearchAssignmentAssistants(role: string): boolean {
  return role === "manager" || role === "coordinator" || role === "admin";
}

export function lkCanPrepareAssignmentOnBehalfOfManager(role: string): boolean {
  return role === "coordinator" || role === "admin";
}

/** Mandatory review submission stays with the real delegating manager only. */
export function lkCanSubmitAssignmentReview(role: string): boolean {
  return role === "manager";
}
