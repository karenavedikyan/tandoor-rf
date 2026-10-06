import type { UserDto, UserRole, UserStatus } from "../shared/user";

export type AccessPreviewMeta = {
  active: true;
  actorUserId: string;
  targetUserId: string;
  targetUser: UserDto;
  readOnly: true;
};

export type AccessContext = {
  userId: string;
  role: UserRole;
  status: UserStatus;
  employeeId: string | null;
  employeeLinkConflict: boolean;
  hasEmployeeLink: boolean;
  hasScopedClientAccess: boolean;
  /** When true, clients API returns all rows (admin/director with valid link). */
  fullClientBase: boolean;
  explicitlyDeniedAll: boolean;
  /** Admin read-only preview as another user (session-scoped). */
  preview?: AccessPreviewMeta;
};

export type ClientScopeSql = {
  whereSql: string;
  params: unknown[];
};

export type AccessExplainReason =
  | "admin_full_access"
  | "director_full_base"
  | "manager_own_base"
  | "rop_team_scope"
  | "regional_grant"
  | "assistant_delegation"
  | "no_employee_link"
  | "employee_link_conflict"
  | "role_denied"
  | "user_disabled"
  | "explicit_denial"
  | "not_in_scope"
  | "client_not_found";

export type AccessExplainResult = {
  allowed: boolean;
  reason: AccessExplainReason;
  details: string;
};

export type ActiveUserRow = {
  id: string;
  email: string;
  full_name: string;
  role: UserRole;
  status: UserStatus;
};

export type DelegationRow = {
  id: string;
  delegator_user_id: string;
  assistant_user_id: string;
  status: string;
  starts_at: Date;
  ends_at: Date;
  approved_by_user_id: string | null;
  approved_at: Date | null;
  business_approver_user_id: string | null;
  revoked_at: Date | null;
  row_version: number;
};
