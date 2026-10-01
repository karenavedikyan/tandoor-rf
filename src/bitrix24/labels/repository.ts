import type { Pool, PoolClient } from "pg";
import { requirePool } from "../../db/pool";
import type { Bitrix24ObjectType } from "./format";
import { formatLabelCode } from "./format";
import { invalidateBindingsForLabel, invalidateBindingsForObject } from "../tasks/repository";

export type ObjectLabelRow = {
  id: string;
  objectType: Bitrix24ObjectType;
  objectGuid: string;
  labelCode: string;
  issuedAt: string;
};

export type LabelIssueTransactionResult = ObjectLabelRow & { created: boolean; restored?: boolean };

export class LabelRepositoryError extends Error {
  constructor(
    message: string,
    readonly code: "OBJECT_NOT_CONFIRMED" | "LABEL_REVOKED" | "LABEL_SEQUENCE_EXHAUSTED" | "LABEL_ISSUE_RACE",
  ) {
    super(message);
    this.name = "LabelRepositoryError";
  }
}

async function recordLabelAudit(
  action: string,
  objectType: Bitrix24ObjectType | null,
  objectGuid: string | null,
  labelCode: string | null,
  actorUserId: string | null,
  detail: string | null,
  client: Pool | PoolClient,
): Promise<void> {
  await client.query(
    `INSERT INTO bitrix24_label_audit (action, object_type, object_guid, label_code, actor_user_id, detail)
     VALUES ($1, $2::bitrix24_object_type, $3::uuid, $4, $5::uuid, $6)`,
    [action, objectType, objectGuid, labelCode, actorUserId, detail],
  );
}

export async function isObjectConfirmed(
  objectType: Bitrix24ObjectType,
  objectGuid: string,
  client: Pool | PoolClient = requirePool(),
): Promise<boolean> {
  const result = await client.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM bitrix24_confirmed_objects
       WHERE object_type = $1::bitrix24_object_type AND object_guid = $2::uuid
     ) AS exists`,
    [objectType, objectGuid],
  );
  return result.rows[0]?.exists ?? false;
}

export async function confirmObject(
  objectType: Bitrix24ObjectType,
  objectGuid: string,
  confirmedBy: string | null,
  client: Pool | PoolClient = requirePool(),
): Promise<void> {
  await client.query(
    `INSERT INTO bitrix24_confirmed_objects (object_type, object_guid, confirmed_by)
     VALUES ($1::bitrix24_object_type, $2::uuid, $3::uuid)
     ON CONFLICT (object_type, object_guid) DO NOTHING`,
    [objectType, objectGuid, confirmedBy],
  );
}

export async function unconfirmObject(
  objectType: Bitrix24ObjectType,
  objectGuid: string,
  actorUserId: string | null = null,
  client: Pool | PoolClient = requirePool(),
): Promise<boolean> {
  const result = await client.query(
    `DELETE FROM bitrix24_confirmed_objects
     WHERE object_type = $1::bitrix24_object_type AND object_guid = $2::uuid`,
    [objectType, objectGuid],
  );
  const removed = (result.rowCount ?? 0) > 0;
  if (removed) {
    await invalidateBindingsForObject(null, objectType, objectGuid, "object_unconfirmed", client);
    await recordLabelAudit("unconfirm", objectType, objectGuid, null, actorUserId, null, client);
  }
  return removed;
}

export async function findActiveLabel(
  objectType: Bitrix24ObjectType,
  objectGuid: string,
  client: Pool | PoolClient = requirePool(),
): Promise<ObjectLabelRow | null> {
  const result = await client.query<{
    id: string;
    object_type: Bitrix24ObjectType;
    object_guid: string;
    label_code: string;
    issued_at: Date;
  }>(
    `SELECT id, object_type, object_guid, label_code, issued_at
     FROM bitrix24_object_labels
     WHERE object_type = $1::bitrix24_object_type
       AND object_guid = $2::uuid
       AND revoked_at IS NULL`,
    [objectType, objectGuid],
  );
  const row = result.rows[0];
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    objectType: row.object_type,
    objectGuid: row.object_guid,
    labelCode: row.label_code,
    issuedAt: row.issued_at.toISOString(),
  };
}

export async function findLatestRevokedLabel(
  objectType: Bitrix24ObjectType,
  objectGuid: string,
  client: Pool | PoolClient = requirePool(),
): Promise<ObjectLabelRow | null> {
  const result = await client.query<{
    id: string;
    object_type: Bitrix24ObjectType;
    object_guid: string;
    label_code: string;
    issued_at: Date;
  }>(
    `SELECT id, object_type, object_guid, label_code, issued_at
     FROM bitrix24_object_labels
     WHERE object_type = $1::bitrix24_object_type
       AND object_guid = $2::uuid
       AND revoked_at IS NOT NULL
     ORDER BY revoked_at DESC
     LIMIT 1`,
    [objectType, objectGuid],
  );
  const row = result.rows[0];
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    objectType: row.object_type,
    objectGuid: row.object_guid,
    labelCode: row.label_code,
    issuedAt: row.issued_at.toISOString(),
  };
}

export async function findLabelByCode(
  labelCode: string,
  client: Pool | PoolClient = requirePool(),
): Promise<ObjectLabelRow | null> {
  const result = await client.query<{
    id: string;
    object_type: Bitrix24ObjectType;
    object_guid: string;
    label_code: string;
    issued_at: Date;
  }>(
    `SELECT ol.id, ol.object_type, ol.object_guid, ol.label_code, ol.issued_at
     FROM bitrix24_object_labels ol
     JOIN bitrix24_confirmed_objects co
       ON co.object_type = ol.object_type AND co.object_guid = ol.object_guid
     WHERE ol.label_code = $1 AND ol.revoked_at IS NULL`,
    [labelCode],
  );
  const row = result.rows[0];
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    objectType: row.object_type,
    objectGuid: row.object_guid,
    labelCode: row.label_code,
    issuedAt: row.issued_at.toISOString(),
  };
}

export async function revokeActiveLabel(
  objectType: Bitrix24ObjectType,
  objectGuid: string,
  actorUserId: string | null = null,
  client: Pool | PoolClient = requirePool(),
): Promise<ObjectLabelRow | null> {
  const result = await client.query<{
    id: string;
    object_type: Bitrix24ObjectType;
    object_guid: string;
    label_code: string;
    issued_at: Date;
  }>(
    `UPDATE bitrix24_object_labels
     SET revoked_at = NOW()
     WHERE object_type = $1::bitrix24_object_type
       AND object_guid = $2::uuid
       AND revoked_at IS NULL
     RETURNING id, object_type, object_guid, label_code, issued_at`,
    [objectType, objectGuid],
  );
  const row = result.rows[0];
  if (!row) {
    return null;
  }
  await invalidateBindingsForObject(null, objectType, objectGuid, "label_revoked", client);
  await recordLabelAudit("revoke", objectType, objectGuid, row.label_code, actorUserId, null, client);
  return {
    id: row.id,
    objectType: row.object_type,
    objectGuid: row.object_guid,
    labelCode: row.label_code,
    issuedAt: row.issued_at.toISOString(),
  };
}

export async function restoreRevokedLabel(
  objectType: Bitrix24ObjectType,
  objectGuid: string,
  actorUserId: string | null = null,
): Promise<LabelIssueTransactionResult> {
  const pool = requirePool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const confirmed = await isObjectConfirmed(objectType, objectGuid, client);
    if (!confirmed) {
      throw new LabelRepositoryError("OBJECT_NOT_CONFIRMED", "OBJECT_NOT_CONFIRMED");
    }
    const active = await findActiveLabel(objectType, objectGuid, client);
    if (active) {
      await client.query("COMMIT");
      return { ...active, created: false, restored: false };
    }
    const revoked = await findLatestRevokedLabel(objectType, objectGuid, client);
    if (!revoked) {
      throw new LabelRepositoryError("LABEL_REVOKED", "LABEL_REVOKED");
    }
    const restored = await client.query<{ issued_at: Date }>(
      `UPDATE bitrix24_object_labels
       SET revoked_at = NULL, issued_at = NOW()
       WHERE id = $1::uuid
       RETURNING issued_at`,
      [revoked.id],
    );
    await recordLabelAudit("restore", objectType, objectGuid, revoked.labelCode, actorUserId, null, client);
    await client.query("COMMIT");
    return {
      ...revoked,
      issuedAt: restored.rows[0]!.issued_at.toISOString(),
      created: false,
      restored: true,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function issueLabelOnClient(
  objectType: Bitrix24ObjectType,
  objectGuid: string,
  actorUserId: string | null,
  client: PoolClient,
): Promise<LabelIssueTransactionResult> {
  const existing = await findActiveLabel(objectType, objectGuid, client);
  if (existing) {
    return { ...existing, created: false };
  }

  const revoked = await findLatestRevokedLabel(objectType, objectGuid, client);
  if (revoked) {
    throw new LabelRepositoryError("LABEL_REVOKED", "LABEL_REVOKED");
  }

  const confirmed = await isObjectConfirmed(objectType, objectGuid, client);
  if (!confirmed) {
    throw new LabelRepositoryError("OBJECT_NOT_CONFIRMED", "OBJECT_NOT_CONFIRMED");
  }

  const seq = await client.query<{ next_value: number; exhausted: boolean }>(
    `SELECT next_value, exhausted FROM bitrix24_label_sequences
     WHERE object_type = $1::bitrix24_object_type
     FOR UPDATE`,
    [objectType],
  );
  const nextValue = seq.rows[0]?.next_value;
  const exhausted = seq.rows[0]?.exhausted ?? false;
  if (!nextValue || exhausted || nextValue > 999999) {
    throw new LabelRepositoryError("LABEL_SEQUENCE_EXHAUSTED", "LABEL_SEQUENCE_EXHAUSTED");
  }
  const labelCode = formatLabelCode(objectType, nextValue);

  const inserted = await client.query<{
    id: string;
    issued_at: Date;
  }>(
    `INSERT INTO bitrix24_object_labels (object_type, object_guid, label_code)
     VALUES ($1::bitrix24_object_type, $2::uuid, $3)
     ON CONFLICT (object_type, object_guid) WHERE revoked_at IS NULL DO NOTHING
     RETURNING id, issued_at`,
    [objectType, objectGuid, labelCode],
  );

  if ((inserted.rowCount ?? 0) === 0) {
    const raced = await findActiveLabel(objectType, objectGuid, client);
    if (!raced) {
      throw new LabelRepositoryError("LABEL_ISSUE_RACE", "LABEL_ISSUE_RACE");
    }
    return { ...raced, created: false };
  }

  if (nextValue === 999999) {
    await client.query(
      `UPDATE bitrix24_label_sequences
       SET exhausted = TRUE
       WHERE object_type = $1::bitrix24_object_type`,
      [objectType],
    );
  } else {
    await client.query(
      `UPDATE bitrix24_label_sequences
       SET next_value = next_value + 1
       WHERE object_type = $1::bitrix24_object_type`,
      [objectType],
    );
  }
  await recordLabelAudit("issue", objectType, objectGuid, labelCode, actorUserId, null, client);
  const row = inserted.rows[0]!;
  return {
    id: row.id,
    objectType,
    objectGuid,
    labelCode,
    issuedAt: row.issued_at.toISOString(),
    created: true,
  };
}

export async function issueLabelInTransaction(
  objectType: Bitrix24ObjectType,
  objectGuid: string,
  actorUserId: string | null = null,
): Promise<LabelIssueTransactionResult> {
  const pool = requirePool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const issued = await issueLabelOnClient(objectType, objectGuid, actorUserId, client);
    await client.query("COMMIT");
    return issued;
  } catch (error) {
    await client.query("ROLLBACK");
    if (error instanceof LabelRepositoryError) {
      throw error;
    }
    const pgError = error as { code?: string };
    if (pgError.code === "23505") {
      const raced = await findActiveLabel(objectType, objectGuid);
      if (raced) {
        return { ...raced, created: false };
      }
    }
    if (pgError.code === "23514") {
      throw new LabelRepositoryError("LABEL_SEQUENCE_EXHAUSTED", "LABEL_SEQUENCE_EXHAUSTED");
    }
    throw error;
  } finally {
    client.release();
  }
}
