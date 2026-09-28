import { query } from "../db/pool";
import { isClientReadRole } from "../shared/user";
import { AccessServiceError, withTransaction } from "./db";
import { ropManagesDelegator } from "./authorization";

const EXPLAIN_DENIED = "Нет доступа к диагностике для указанного пользователя или объекта.";

export async function assertCanExplainAccess(input: {
  callerUserId: string;
  callerRole: string;
  targetUserId: string;
  adminRoute: boolean;
}): Promise<void> {
  if (input.adminRoute) {
    if (input.callerRole !== "admin") {
      throw new AccessServiceError(EXPLAIN_DENIED, "NOT_FOUND");
    }
    return;
  }

  if (input.callerRole === "admin") {
    throw new AccessServiceError(EXPLAIN_DENIED, "NOT_FOUND");
  }

  if (input.callerRole === "manager") {
    if (input.callerUserId !== input.targetUserId) {
      throw new AccessServiceError(EXPLAIN_DENIED, "NOT_FOUND");
    }
    return;
  }

  const targetResult = await query<{ role: string; status: string }>(
    "SELECT role, status FROM users WHERE id = $1::uuid",
    [input.targetUserId],
  );
  const target = targetResult.rows[0];
  if (!target || target.status !== "active") {
    throw new AccessServiceError(EXPLAIN_DENIED, "NOT_FOUND");
  }

  if (input.callerRole === "rop") {
    if (input.callerUserId === input.targetUserId) {
      return;
    }
    const manages = await withTransaction(async (client) =>
      ropManagesDelegator(client, input.callerUserId, input.targetUserId),
    );
    if (!manages) {
      throw new AccessServiceError(EXPLAIN_DENIED, "NOT_FOUND");
    }
    return;
  }

  if (input.callerRole === "director") {
    if (!isClientReadRole(target.role as never) && target.role !== "assistant") {
      throw new AccessServiceError(EXPLAIN_DENIED, "NOT_FOUND");
    }
    return;
  }

  throw new AccessServiceError(EXPLAIN_DENIED, "NOT_FOUND");
}
