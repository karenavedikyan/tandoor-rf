export const DELEGATION_STATUSES = [
  "draft",
  "pending_approval",
  "active",
  "revoked",
  "expired",
] as const;

export type DelegationStatus = (typeof DELEGATION_STATUSES)[number];

export const GRANT_TYPES = ["client"] as const;

export type GrantType = (typeof GRANT_TYPES)[number];

export const ACCESS_AUDIT_ACTIONS = {
  EMPLOYEE_LINK_CREATE: "employee_link.create",
  EMPLOYEE_LINK_REVOKE: "employee_link.revoke",
  GRANT_CREATE: "grant.create",
  GRANT_REVOKE: "grant.revoke",
  ROP_TEAM_ADD: "rop_team.add",
  ROP_TEAM_REVOKE: "rop_team.revoke",
  COORDINATOR_TEAM_ADD: "coordinator_team.add",
  COORDINATOR_TEAM_REVOKE: "coordinator_team.revoke",
  DELEGATION_CREATE: "delegation.create",
  DELEGATION_UPDATE: "delegation.update",
  DELEGATION_SUBMIT: "delegation.submit",
  DELEGATION_APPROVE: "delegation.approve",
  DELEGATION_REVOKE: "delegation.revoke",
  PREVIEW_START: "preview.start",
  PREVIEW_STOP: "preview.stop",
  USER_CREATE: "user.create",
  USER_ROLE_ASSIGN: "user.role_assign",
  USER_PASSWORD_SET: "user.password_set",
  USER_PASSWORD_CHANGE: "user.password_change",
  USER_PROVISION_ROLLBACK: "user.provision_rollback",
  USER_PROVISION_DELIVERY_CONFIRMED: "user.provision_delivery_confirmed",
  USER_PROVISION_INCOMPLETE: "user.provision_incomplete",
  USER_PROVISION_RECOVERY: "user.provision_recovery",
  USER_PROVISION_OPERATION_COMMITTED: "user.provision_operation_committed",
} as const;

/** JSON key in provision audit rows linking delivery to a grant attempt. */
export const PROVISION_OPERATION_ID_KEY = "provision_operation_id";
