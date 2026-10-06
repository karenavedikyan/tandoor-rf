import { query } from "../db/pool";
import { ACCESS_AUDIT_ACTIONS } from "./constants";
import {
  getSessionPreviewUserId,
  searchPreviewCandidates,
  setSessionPreviewUser,
  validatePreviewTarget,
} from "./preview";

type AuditWriter = (input: {
  actorUserId: string;
  action: string;
  entityType: string;
  entityId?: string | null;
  after?: unknown;
  basis?: string | null;
}) => Promise<void>;

async function writePreviewAudit(input: {
  actorUserId: string;
  action: string;
  targetUserId: string;
  basis?: string | null;
}): Promise<void> {
  await query(
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

  await setSessionPreviewUser(input.sessionId, input.targetUserId);
  await writePreviewAudit({
    actorUserId: input.actorUserId,
    action: ACCESS_AUDIT_ACTIONS.PREVIEW_START,
    targetUserId: input.targetUserId,
    basis: input.basis ?? "admin_employee_preview",
  });
  return { ok: true };
}

export async function stopEmployeePreview(input: {
  sessionId: string;
  actorUserId: string;
}): Promise<void> {
  const previousTarget = await getSessionPreviewUserId(input.sessionId);
  await setSessionPreviewUser(input.sessionId, null);
  if (previousTarget) {
    await writePreviewAudit({
      actorUserId: input.actorUserId,
      action: ACCESS_AUDIT_ACTIONS.PREVIEW_STOP,
      targetUserId: previousTarget,
      basis: "admin_employee_preview",
    });
  }
}

export { searchPreviewCandidates, validatePreviewTarget, getSessionPreviewUserId, setSessionPreviewUser };
