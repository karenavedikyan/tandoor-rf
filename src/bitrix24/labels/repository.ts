import type { Pool, PoolClient } from "pg";
import { requirePool } from "../../db/pool";
import type { Bitrix24ObjectType } from "./format";
import { formatLabelCode } from "./format";

export type ObjectLabelRow = {
  id: string;
  objectType: Bitrix24ObjectType;
  objectGuid: string;
  labelCode: string;
  issuedAt: string;
};

export type LabelIssueTransactionResult = ObjectLabelRow & { created: boolean };

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
  client: Pool | PoolClient = requirePool(),
): Promise<boolean> {
  const result = await client.query(
    `DELETE FROM bitrix24_confirmed_objects
     WHERE object_type = $1::bitrix24_object_type AND object_guid = $2::uuid`,
    [objectType, objectGuid],
  );
  return (result.rowCount ?? 0) > 0;
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
    `SELECT id, object_type, object_guid, label_code, issued_at
     FROM bitrix24_object_labels
     WHERE label_code = $1 AND revoked_at IS NULL`,
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
  return {
    id: row.id,
    objectType: row.object_type,
    objectGuid: row.object_guid,
    labelCode: row.label_code,
    issuedAt: row.issued_at.toISOString(),
  };
}

export async function issueLabelInTransaction(
  objectType: Bitrix24ObjectType,
  objectGuid: string,
): Promise<LabelIssueTransactionResult> {
  const pool = requirePool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const existing = await findActiveLabel(objectType, objectGuid, client);
    if (existing) {
      await client.query("COMMIT");
      return { ...existing, created: false };
    }

    const confirmed = await isObjectConfirmed(objectType, objectGuid, client);
    if (!confirmed) {
      await client.query("ROLLBACK");
      throw new Error("OBJECT_NOT_CONFIRMED");
    }

    const seq = await client.query<{ next_value: number }>(
      `SELECT next_value FROM bitrix24_label_sequences
       WHERE object_type = $1::bitrix24_object_type
       FOR UPDATE`,
      [objectType],
    );
    const nextValue = seq.rows[0]?.next_value;
    if (!nextValue) {
      throw new Error("LABEL_SEQUENCE_MISSING");
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
        throw new Error("LABEL_ISSUE_RACE");
      }
      await client.query("COMMIT");
      return { ...raced, created: false };
    }

    await client.query(
      `UPDATE bitrix24_label_sequences
       SET next_value = next_value + 1
       WHERE object_type = $1::bitrix24_object_type`,
      [objectType],
    );
    await client.query("COMMIT");
    const row = inserted.rows[0]!;
    return {
      id: row.id,
      objectType,
      objectGuid,
      labelCode,
      issuedAt: row.issued_at.toISOString(),
      created: true,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    if (error instanceof Error && error.message === "OBJECT_NOT_CONFIRMED") {
      throw error;
    }
    const pgError = error as { code?: string };
    if (pgError.code === "23505") {
      const raced = await findActiveLabel(objectType, objectGuid);
      if (raced) {
        return { ...raced, created: false };
      }
    }
    throw error;
  } finally {
    client.release();
  }
}
