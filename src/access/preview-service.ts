import type { PoolClient } from "pg";
import { query } from "../db/pool";
import { ACCESS_AUDIT_ACTIONS } from "./constants";
import { withTransaction } from "./db";
import {
  getSessionPreviewUserId,
  searchPreviewCandidates,
  validatePreviewTarget,
} from "./preview";

class PreviewSessionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PreviewSessionError";
  }
}

async function writePreviewAudit(
  client: PoolClient,
  input: {
    actorUserId: string;
    action: string;
    targetUserId: string;
    basis?: string | null;
  },
): Promise<void> {
  await client.query(
    `
      INSERT INTO access_audit_log (
        actor_user_id,
        business_actor_user_id,
        action,
        entity_type,
        entity_id,
        before_json,
        after_json,
        basis
      )
      VALUES ($1::uuid, NULL, $2, 'user_preview', $3::uuid, NULL, NULL, $4)
    `,
    [input.actorUserId, input.action, input.targetUserId, input.basis ?? null],
  );
}

async function updateSessionPreviewUser(
  client: PoolClient,
  sessionId: string,
  targetUserId: string | null,
): Promise<boolean> {
  const result = await client.query(
    `
      UPDATE sessions
      SET preview_user_id = $2::uuid
      WHERE id = $1::uuid AND revoked_at IS NULL
      RETURNING id
    `,
    [sessionId, targetUserId],
  );
  return (result.rowCount ?? 0) === 1;
}

async function assertActiveAdminSession(
  client: PoolClient,
  sessionId: string,
  actorUserId: string,
): Promise<void> {
  const result = await client.query<{ user_id: string; role: string }>(
    `
      SELECT s.user_id::text, u.role
      FROM sessions s
      INNER JOIN users u ON u.id = s.user_id
      WHERE s.id = $1::uuid
        AND s.revoked_at IS NULL
        AND u.status = 'active'
      LIMIT 1
    `,
    [sessionId],
  );
  const row = result.rows[0];
  if (!row || row.user_id !== actorUserId || row.role !== "admin") {
    throw new PreviewSessionError("Сессия администратора недействительна.");
  }
}

export async function setSessionPreviewUser(sessionId: string, targetUserId: string | null): Promise<void> {
  await query(
    `
      UPDATE sessions
      SET preview_user_id = $2::uuid
      WHERE id = $1::uuid AND revoked_at IS NULL
    `,
    [sessionId, targetUserId],
  );
}

export async function startEmployeePreview(input: {
  sessionId: string;
  actorUserId: string;
  targetUserId: string;
  basis?: string | null;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const validation = await validatePreviewTarget(input.targetUserId);
  if (!validation.ok) {
    return { ok: false, message: validation.message };
  }

  try {
    await withTransaction(async (client) => {
      await assertActiveAdminSession(client, input.sessionId, input.actorUserId);
      const updated = await updateSessionPreviewUser(client, input.sessionId, input.targetUserId);
      if (!updated) {
        throw new PreviewSessionError("Сессия администратора недействительна.");
      }
      await writePreviewAudit(client, {
        actorUserId: input.actorUserId,
        action: ACCESS_AUDIT_ACTIONS.PREVIEW_START,
        targetUserId: input.targetUserId,
        basis: input.basis ?? "admin_employee_preview",
      });
    });
    return { ok: true };
  } catch (error) {
    if (error instanceof PreviewSessionError) {
      return { ok: false, message: error.message };
    }
    throw error;
  }
}

export async function stopEmployeePreview(input: {
  sessionId: string;
  actorUserId: string;
}): Promise<void> {
  await withTransaction(async (client) => {
    await assertActiveAdminSession(client, input.sessionId, input.actorUserId);
    const previousTarget = await client.query<{ preview_user_id: string | null }>(
      `
        SELECT preview_user_id::text
        FROM sessions
        WHERE id = $1::uuid AND revoked_at IS NULL
        FOR UPDATE
      `,
      [input.sessionId],
    );
    const targetUserId = previousTarget.rows[0]?.preview_user_id ?? null;
    const updated = await updateSessionPreviewUser(client, input.sessionId, null);
    if (!updated) {
      throw new PreviewSessionError("Сессия администратора недействительна.");
    }
    if (targetUserId) {
      await writePreviewAudit(client, {
        actorUserId: input.actorUserId,
        action: ACCESS_AUDIT_ACTIONS.PREVIEW_STOP,
        targetUserId,
        basis: "admin_employee_preview",
      });
    }
  });
}

export { searchPreviewCandidates, validatePreviewTarget, getSessionPreviewUserId };
