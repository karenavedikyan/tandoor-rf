export const USER_ROLES = [
  "admin",
  "director",
  "rop",
  "regional_manager",
  "manager",
  "marketer",
  "analyst",
  "category_manager",
  "assistant",
  "coordinator",
] as const;

/** Roles that may call read-only clients API when scope permits. */
export const CLIENT_READ_ROLES = [
  "admin",
  "director",
  "rop",
  "regional_manager",
  "manager",
  "assistant",
] as const;

export type ClientReadRole = (typeof CLIENT_READ_ROLES)[number];

export function isClientReadRole(role: string): role is ClientReadRole {
  return (CLIENT_READ_ROLES as readonly string[]).includes(role);
}

export type UserRole = (typeof USER_ROLES)[number];

export const USER_STATUSES = ["invited", "active", "disabled"] as const;

export type UserStatus = (typeof USER_STATUSES)[number];

export type UserDto = {
  id: string;
  email: string;
  fullName: string;
  phone: string | null;
  role: UserRole;
  status: UserStatus;
  lastLoginAt: string | null;
};

export function toUserDto(row: {
  id: string;
  email: string;
  full_name: string;
  phone: string | null;
  role: string;
  status: string;
  last_login_at: Date | string | null;
}): UserDto {
  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    phone: row.phone,
    role: row.role as UserRole,
    status: row.status as UserStatus,
    lastLoginAt: row.last_login_at
      ? row.last_login_at instanceof Date
        ? row.last_login_at.toISOString()
        : String(row.last_login_at)
      : null,
  };
}
