import type { Pool, PoolClient } from "pg";
import {
  deliverTemporaryPasswordToChannel,
  type PasswordDeliverySpec,
} from "./password-delivery";
import {
  confirmAdminProvisionDelivery,
  finalizeGrantTransaction,
  grantAdminAccess,
  markAdminProvisionIncomplete,
  type GrantAdminAccessResult,
  type TransactionFinalizeOutcome,
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

export type GrantOrchestrationResult =
  | {
      ok: true;
      mode: "created" | "delivery_resumed" | "role_assigned";
      userId: string;
      email: string;
      passwordChanged: boolean;
      transactionOutcome: TransactionFinalizeOutcome;
    }
  | (GrantAdminAccessResult & { transactionOutcome?: TransactionFinalizeOutcome });

async function withFreshClient<T>(pool: Pool, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

async function markIncompleteSafely(
  pool: Pool,
  input: { userId: string; actorUserId: string; basis: string; reason: string },
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
  input: { userId: string; actorUserId: string; basis: string },
): Promise<void> {
  await withFreshClient(pool, async (client) => {
    await client.query("BEGIN");
    await confirmAdminProvisionDelivery(client, input);
    await client.query("COMMIT");
  });
}

export async function runAdminGrant(
  pool: Pool,
  grantClient: PoolClient,
  input: GrantOrchestrationInput,
): Promise<GrantOrchestrationResult> {
  await grantClient.query("BEGIN");
  const grantResult = await grantAdminAccess(grantClient, {
    email: input.email,
    fullName: input.fullName,
    actorUserId: input.actorUserId,
    basis: input.basis,
    auditReviewConfirmed: input.auditReviewConfirmed,
    assignAdminRoleOnly: input.assignAdminRoleOnly,
  });

  if (!grantResult.ok) {
    await grantClient.query("ROLLBACK");
    return grantResult;
  }

  const verifyClient = await pool.connect();
  let transactionOutcome: TransactionFinalizeOutcome;
  try {
    const finalized = await finalizeGrantTransaction(grantClient, verifyClient, input.email);
    transactionOutcome = finalized.outcome;
    if (transactionOutcome === "rolled_back" && !finalized.userExists) {
      return {
        ok: false,
        code: "VALIDATION_ERROR",
        message: "Транзакция выдачи откатилась; учётная запись не создана.",
        transactionOutcome,
      };
    }
  } finally {
    verifyClient.release();
  }

  if (grantResult.mode === "role_assigned") {
    return {
      ok: true,
      mode: "role_assigned",
      userId: grantResult.userId,
      email: grantResult.email,
      passwordChanged: false,
      transactionOutcome,
    };
  }

  if (!input.passwordDelivery) {
    await markIncompleteSafely(pool, {
      userId: grantResult.userId,
      actorUserId: input.actorUserId,
      basis: input.basis,
      reason: "password delivery channel missing",
    });
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      message: "Канал доставки пароля обязателен для новой учётной записи.",
      transactionOutcome,
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
    });
    throw deliveryError;
  }

  try {
    await confirmDeliverySafely(pool, {
      userId: grantResult.userId,
      actorUserId: input.actorUserId,
      basis: input.basis,
    });
  } catch (confirmError) {
    await markIncompleteSafely(pool, {
      userId: grantResult.userId,
      actorUserId: input.actorUserId,
      basis: input.basis,
      reason: "delivery confirmation failed",
    });
    throw confirmError;
  }

  return {
    ok: true,
    mode: grantResult.mode,
    userId: grantResult.userId,
    email: grantResult.email,
    passwordChanged: true,
    transactionOutcome,
  };
}
