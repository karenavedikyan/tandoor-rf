import type { UserRole } from "../shared/user";

export type AccessContext = {
  userId: string;
  role: UserRole;
  employeeId: string | null;
  employeeLinkConflict: boolean;
  hasScopedClientAccess: boolean;
  /** When true, clients API returns all rows (admin/director). */
  fullClientBase: boolean;
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
  | "not_in_scope"
  | "client_not_found";

export type AccessExplainResult = {
  allowed: boolean;
  reason: AccessExplainReason;
  details: string;
};
