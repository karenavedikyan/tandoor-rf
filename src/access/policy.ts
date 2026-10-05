import { query } from "../db/pool";
import { isClientReadRole } from "../shared/user";
import type { AccessContext, AccessExplainResult } from "./types";
import { buildClientScopeSql } from "./scope-sql";

export function canReadClientsApi(context: AccessContext): boolean {
  if (context.status !== "active") {
    return false;
  }
  if (context.employeeLinkConflict) {
    return false;
  }
  if (context.role === "admin") {
    return true;
  }
  if (context.role === "rop" && context.hasEmployeeLink) {
    return true;
  }
  return isClientReadRole(context.role) && context.hasScopedClientAccess;
}

export async function isClientInScope(
  context: AccessContext,
  guidClient: string,
): Promise<boolean> {
  if (context.status !== "active") {
    return false;
  }
  if (context.fullClientBase) {
    const denied = await query(
      `
        SELECT 1 FROM access_denials
        WHERE user_id = $1::uuid AND revoked_at IS NULL
          AND (scope_type = 'all_clients' OR object_id = $2::uuid)
        LIMIT 1
      `,
      [context.userId, guidClient],
    );
    if (denied.rows.length > 0) {
      return false;
    }
    const exists = await query(
      `SELECT 1 FROM onec_clients WHERE guid_client = $1::uuid AND COALESCE(baseline_status, 'active') = 'active' LIMIT 1`,
      [guidClient],
    );
    return exists.rows.length > 0;
  }
  if (!canReadClientsApi(context)) {
    return false;
  }

  const scope = buildClientScopeSql(context);
  if (scope.whereSql === "WHERE FALSE") {
    return false;
  }

  const existsSql = scope.whereSql
    ? `
        SELECT 1
        FROM onec_clients
        ${scope.whereSql}
          AND onec_clients.guid_client = $${scope.params.length + 1}::uuid
        LIMIT 1
      `
    : `
        SELECT 1
        FROM onec_clients
        WHERE guid_client = $1::uuid
        LIMIT 1
      `;

  const params = scope.whereSql ? [...scope.params, guidClient] : [guidClient];
  const result = await query(existsSql, params);
  return result.rows.length > 0;
}

export async function explainClientAccess(
  context: AccessContext,
  guidClient: string,
  options?: { hideExistenceLeak?: boolean },
): Promise<AccessExplainResult> {
  if (context.status !== "active") {
    return {
      allowed: false,
      reason: "user_disabled",
      details: "Учётная запись не активна — доступ закрыт.",
    };
  }

  if (context.explicitlyDeniedAll) {
    return {
      allowed: false,
      reason: "explicit_denial",
      details: "Для пользователя действует явный запрет на все клиентские данные.",
    };
  }

  if (context.role === "admin") {
    return {
      allowed: true,
      reason: "admin_full_access",
      details: "Технический администратор: полный доступ к snapshot клиентов.",
    };
  }

  if (context.employeeLinkConflict) {
    return {
      allowed: false,
      reason: "employee_link_conflict",
      details: "Конфликт связи user ↔ сотрудник 1С.",
    };
  }

  if (!context.hasEmployeeLink) {
    return {
      allowed: false,
      reason: "no_employee_link",
      details: "Нет подтверждённой связи с ID сотрудника 1С.",
    };
  }

  if (!isClientReadRole(context.role)) {
    return {
      allowed: false,
      reason: "role_denied",
      details: `Роль «${context.role}» не имеет доступа к клиентским данным.`,
    };
  }

  const allowed = await isClientInScope(context, guidClient);
  if (!allowed) {
    const exists = await query(
      "SELECT guid_client::text AS id FROM onec_clients WHERE guid_client = $1::uuid",
      [guidClient],
    );
    const explicit = await query(
      `
        SELECT 1 FROM access_denials
        WHERE user_id = $1::uuid AND revoked_at IS NULL
          AND (scope_type = 'all_clients' OR object_id = $2::uuid)
        LIMIT 1
      `,
      [context.userId, guidClient],
    );
    if (explicit.rows.length > 0) {
      return {
        allowed: false,
        reason: "explicit_denial",
        details: "Действует явный запрет на этот объект.",
      };
    }
    if (options?.hideExistenceLeak) {
      return {
        allowed: false,
        reason: "not_in_scope",
        details: "Объект недоступен для диагностики.",
      };
    }
    return {
      allowed: false,
      reason: exists.rows.length > 0 ? "not_in_scope" : "client_not_found",
      details:
        exists.rows.length > 0
          ? "Объект существует, но не входит в разрешённую область."
          : "Клиент отсутствует в snapshot.",
    };
  }

  const reasonMap = {
    director: "director_full_base" as const,
    manager: "manager_own_base" as const,
    rop: "rop_team_scope" as const,
    regional_manager: "regional_grant" as const,
    assistant: "assistant_delegation" as const,
  };

  return {
    allowed: true,
    reason: reasonMap[context.role as keyof typeof reasonMap] ?? "not_in_scope",
    details: "Доступ разрешён по текущим правилам R1.3.",
  };
}
