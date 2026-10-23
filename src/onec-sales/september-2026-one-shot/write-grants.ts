import type { OperatorDataScopeV1 } from "./operator-data-scope";

export type WriteGrantKind = "backup" | "apply" | "rollback";

const ENV_BY_KIND: Record<WriteGrantKind, string> = {
  backup: "SEPTEMBER_2026_BACKUP_GRANT_REF",
  apply: "SEPTEMBER_2026_APPLY_GRANT_REF",
  rollback: "SEPTEMBER_2026_ROLLBACK_GRANT_REF",
};

function scopeWriteFlag(scope: OperatorDataScopeV1, kind: WriteGrantKind): boolean {
  if (kind === "backup") return scope.backupBusinessValuesAuthorized;
  if (kind === "apply") return scope.applyAuthorized;
  return scope.rollbackAuthorized;
}

export function assertSeptemberWriteGrant(
  kind: WriteGrantKind,
  scope: OperatorDataScopeV1,
  humanGrantRef: string,
  options?: { allowAuthorizedScope?: boolean },
): { ok: true; ref: string } | { ok: false; code: string; message: string } {
  const flag = scopeWriteFlag(scope, kind);
  if (options?.allowAuthorizedScope) {
    if (!flag) {
      return {
        ok: false,
        code: "WRITE_SCOPE_NOT_AUTHORIZED",
        message: `Scope write flag must be true for this write operation.`,
      };
    }
  } else if (flag) {
    return {
      ok: false,
      code: "CANDIDATE_NOT_WRITE_AUTHORIZATION",
      message: `Scope write flags must remain false until separate human grant.`,
    };
  }
  const envName = ENV_BY_KIND[kind];
  const ref = process.env[envName]?.trim();
  if (!ref) {
    return {
      ok: false,
      code: "WRITE_GRANT_REQUIRED",
      message: `${envName} is required for ${kind} operations.`,
    };
  }
  if (ref !== humanGrantRef) {
    return { ok: false, code: "WRITE_GRANT_MISMATCH", message: "Human grant ref mismatch." };
  }
  if (process.env.TEST_DATABASE_URL?.trim() && process.env.DATABASE_URL?.trim() === process.env.TEST_DATABASE_URL?.trim()) {
    return {
      ok: false,
      code: "PRODUCTION_URL_TEST_MIXED",
      message: "DATABASE_URL must not equal TEST_DATABASE_URL on write paths.",
    };
  }
  return { ok: true, ref };
}
