import type { PoolClient } from "pg";
import type { ActiveUserRow } from "./types";

export type PreviewProxyAudit = {
  actualAdmin: ActiveUserRow;
  effectiveEmployee: ActiveUserRow;
};

export function adminOnBehalfNotice(proxy: PreviewProxyAudit): string {
  return (
    " Выполнено администратором " +
    proxy.actualAdmin.full_name +
    " от имени " +
    proxy.effectiveEmployee.full_name +
    "."
  );
}

export async function insertAccessAudit(
  c: PoolClient,
  input: {
    actorUserId: string;
    businessActorUserId?: string | null;
    action: string;
    entityType: string;
    entityId: string;
    beforeJson?: string | null;
    afterJson?: string | null;
    basis?: string | null;
  },
): Promise<void> {
  await c.query(
    `INSERT INTO access_audit_log(
      actor_user_id, business_actor_user_id, action, entity_type, entity_id, before_json, after_json, basis
    ) VALUES($1::uuid,$2::uuid,$3,$4,$5::uuid,$6,$7,$8)`,
    [
      input.actorUserId,
      input.businessActorUserId ?? null,
      input.action,
      input.entityType,
      input.entityId,
      input.beforeJson ?? null,
      input.afterJson ?? null,
      input.basis ?? null,
    ],
  );
}
