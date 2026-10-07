import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import {
  deliverTemporaryPasswordToChannel,
  type PasswordDeliverySpec,
} from "./password-delivery";
import {
  confirmAdminProvisionDelivery,
  finalizeGrantTransaction,
  findPendingProvisionOperation,
  grantAdminAccess,
  lookupUserByEmail,
  markAdminProvisionIncomplete,
  type GrantAdminAccessResult,
  type GrantOperationOutcome,
} from "./user-provisioning";

export type GrantOrchestrationInput = {
  email: string;
  fullName: string;
  actorUserId: string;
  basis: string;
  auditReviewConfirmed: boolean;
  assignAdminRoleOnly?: boolean;
  passwordDelivery: PasswordDeliverySpec | null;
};

export type GrantRecoveryStatus =
  | "none"
  | "pending_delivery"
  | "operation_rolled_back"
  | "operation_unknown";

export type GrantOrchestrationResult =
  | {
      ok: true;
      mode: "created" | "delivery_resumed" | "role_assigned";
      userId: string;
      email: string;
      operationId: string;
      passwordChanged: boolean;
      operationOutcome: GrantOperationOutcome["status"];
    }
  | ({
      ok: false;
      operationId: string;
      operationOutcome: GrantOperationOutcome["status"];
      recoveryStatus: GrantRecoveryStatus;
    } & Extract<GrantAdminAccessResult, { ok: false }>)
  | {
      ok: false;
      code: "PROVISION_OUTCOME_UNKNOWN" | "PROVISION_OUTCOME_ROLLED_BACK";
      message: string;
      operationId: string;
      operationOutcome: GrantOperationOutcome["status"];
      recoveryStatus: GrantRecoveryStatus;
    };

async function withFreshClient<T>(pool: Pool, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

async function resolveRecoveryStatus(
  pool: Pool,
  email: string,
): Promise<GrantRecoveryStatus> {
  return withFreshClient(pool, async (client) => {
    const user = await lookupUserByEmail(client, email);
    if (!user) {
      return "none";
    }
    const pending = await findPendingProvisionOperation(client, user.id);
    if (pending) {
      return "pending_delivery";
    }
    return "none";
  });
}

async function markIncompleteSafely(
  pool: Pool,
  input: {
    userId: string;
    actorUserId: string;
    basis: string;
    reason: string;
    operationId: string;
  },
): Promise<void> {
  try {
    await withFreshClient(pool, async (client) => {
      await client.query("BEGIN");
      await markAdminProvisionIncomplete(client, input);
      await client.query("COMMIT");
    });
  } catch {
    await withFreshClient(pool, async (client) => {
      await client.query(
        `
          UPDATE users
          SET status = 'disabled', updated_at = NOW()
          WHERE id = $1::uuid
        `,
        [input.userId],
      );
    });
  }
}

async function confirmDeliverySafely(
  pool: Pool,
  input: { userId: string; actorUserId: string; basis: string; operationId: string },
): Promise<void> {
  await withFreshClient(pool, async (client) => {
    await client.query("BEGIN");
    await confirmAdminProvisionDelivery(client, input);
    await client.query("COMMIT");
  });
}

function failFromOperationOutcome(
  operationId: string,
  outcome: GrantOperationOutcome,
  recoveryStatus: GrantRecoveryStatus,
): GrantOrchestrationResult {
  if (outcome.status === "rolled_back") {
    return {
      ok: false,
      code: "PROVISION_OUTCOME_ROLLED_BACK",
      message:
        "Изменения операции выдачи не зафиксированы (операция откатилась). Пароль не выдан, аккаунт не активирован.",
      operationId,
      operationOutcome: outcome.status,
      recoveryStatus,
    };
  }
  const detail = outcome.reason ? ` (${outcome.reason})` : "";
  return {
    ok: false,
    code: "PROVISION_OUTCOME_UNKNOWN",
    message: `Исход операции выдачи неизвестен; пароль не выдан и аккаунт не активирован (fail-closed).${detail}`,
    operationId,
    operationOutcome: outcome.status,
    recoveryStatus,
  };
}

export async function runAdminGrant(
  pool: Pool,
  grantClient: PoolClient,
  input: GrantOrchestrationInput,
): Promise<GrantOrchestrationResult> {
  const operationId = randomUUID();
  let resumeOperationId: string | null = null;

  if (!input.assignAdminRoleOnly) {
    const lookupClient = await pool.connect();
    try {
      const existing = await lookupUserByEmail(lookupClient, input.email);
      if (existing) {
        const pending = await findPendingProvisionOperation(lookupClient, existing.id);
        resumeOperationId = pending?.operationId ?? null;
      }
    } finally {
      lookupClient.release();
    }
  }

  await grantClient.query("BEGIN");
  const grantResult = await grantAdminAccess(grantClient, {
    email: input.email,
    fullName: input.fullName,
    actorUserId: input.actorUserId,
    basis: input.basis,
    operationId,
    resumeOperationId,
    auditReviewConfirmed: input.auditReviewConfirmed,
    assignAdminRoleOnly: input.assignAdminRoleOnly,
  });

  if (!grantResult.ok) {
    await grantClient.query("ROLLBACK");
    const recoveryStatus = await resolveRecoveryStatus(pool, input.email);
    return {
      ...grantResult,
      operationId,
      operationOutcome: "rolled_back",
      recoveryStatus,
    };
  }

  const verifyClient = await pool.connect();
  let operationOutcome: GrantOperationOutcome;
  try {
    operationOutcome = await finalizeGrantTransaction(grantClient, verifyClient, operationId);
  } finally {
    verifyClient.release();
  }

  const recoveryStatus = await resolveRecoveryStatus(pool, input.email);

  if (operationOutcome.status !== "committed") {
    return failFromOperationOutcome(operationId, operationOutcome, recoveryStatus);
  }

  if (grantResult.mode === "role_assigned") {
    return {
      ok: true,
      mode: "role_assigned",
      userId: grantResult.userId,
      email: grantResult.email,
      operationId,
      passwordChanged: false,
      operationOutcome: operationOutcome.status,
    };
  }

  if (!input.passwordDelivery) {
    await markIncompleteSafely(pool, {
      userId: grantResult.userId,
      actorUserId: input.actorUserId,
      basis: input.basis,
      reason: "password delivery channel missing",
      operationId,
    });
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      message: "Канал доставки пароля обязателен для новой учётной записи.",
      operationId,
      operationOutcome: operationOutcome.status,
      recoveryStatus: "pending_delivery",
    };
  }

  try {
    await deliverTemporaryPasswordToChannel(
      grantResult.temporaryPassword,
      input.passwordDelivery,
    );
  } catch (deliveryError) {
    await markIncompleteSafely(pool, {
      userId: grantResult.userId,
      actorUserId: input.actorUserId,
      basis: input.basis,
      reason: "password delivery failed",
      operationId,
    });
    throw deliveryError;
  }

  try {
    await confirmDeliverySafely(pool, {
      userId: grantResult.userId,
      actorUserId: input.actorUserId,
      basis: input.basis,
      operationId,
    });
  } catch (confirmError) {
    await markIncompleteSafely(pool, {
      userId: grantResult.userId,
      actorUserId: input.actorUserId,
      basis: input.basis,
      reason: "delivery confirmation failed",
      operationId,
    });
    throw confirmError;
  }

  return {
    ok: true,
    mode: grantResult.mode,
    userId: grantResult.userId,
    email: grantResult.email,
    operationId,
    passwordChanged: true,
    operationOutcome: operationOutcome.status,
  };
}
