import { query } from "../db/pool";
import { isClientReadRole } from "../shared/user";
import type { AccessContext, AccessExplainResult } from "./types";
import { buildClientScopeSql } from "./scope-sql";

export function canReadClientsApi(context: AccessContext): boolean {
  if (context.role === "admin" || context.role === "director") {
    return true;
  }
  return isClientReadRole(context.role) && context.hasScopedClientAccess;
}

export async function isClientInScope(
  context: AccessContext,
  guidClient: string,
): Promise<boolean> {
  if (context.fullClientBase) {
    return true;
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
  const result = await query<{ exists: number }>(existsSql, params);
  return result.rows.length > 0;
}

export async function explainClientAccess(
  context: AccessContext,
  guidClient: string,
): Promise<AccessExplainResult> {
  if (context.role === "admin") {
    return {
      allowed: true,
      reason: "admin_full_access",
      details: "Технический администратор: полный доступ к snapshot клиентов.",
    };
  }

  if (context.role === "director") {
    const inBase = await query<{ id: string }>(
      "SELECT guid_client::text AS id FROM onec_clients WHERE guid_client = $1::uuid",
      [guidClient],
    );
    return {
      allowed: inBase.rows.length > 0,
      reason: inBase.rows.length > 0 ? "director_full_base" : "client_not_found",
      details:
        inBase.rows.length > 0
          ? "Директор: доступ ко всей sales-базе snapshot."
          : "Клиент отсутствует в snapshot.",
    };
  }

  if (!isClientReadRole(context.role)) {
    return {
      allowed: false,
      reason: "role_denied",
      details: `Роль «${context.role}» не имеет доступа к клиентским данным без отдельной политики.`,
    };
  }

  if (context.employeeLinkConflict) {
    return {
      allowed: false,
      reason: "employee_link_conflict",
      details: "Конфликт связи user ↔ сотрудник 1С: доступ к клиентам закрыт до разрешения.",
    };
  }

  if ((context.role === "manager" || context.role === "rop") && !context.employeeId) {
    return {
      allowed: false,
      reason: "no_employee_link",
      details: "Нет подтверждённой связи с ID сотрудника 1С.",
    };
  }

  const allowed = await isClientInScope(context, guidClient);
  if (!allowed) {
    const exists = await query<{ id: string }>(
      "SELECT guid_client::text AS id FROM onec_clients WHERE guid_client = $1::uuid",
      [guidClient],
    );
    return {
      allowed: false,
      reason: exists.rows.length > 0 ? "not_in_scope" : "client_not_found",
      details:
        exists.rows.length > 0
          ? "Объект существует, но не входит в разрешённую область доступа."
          : "Клиент отсутствует в snapshot.",
    };
  }

  const reasonMap = {
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
