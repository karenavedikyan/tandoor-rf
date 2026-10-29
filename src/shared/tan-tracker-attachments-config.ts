import { isTanTrackerUserTestEnvRequested } from "./tan-tracker-user-test-env";

export type TanTrackerAttachmentsBackend = "postgres" | "filesystem";

function normalizeBackend(raw: string | undefined): TanTrackerAttachmentsBackend | null {
  const v = raw?.trim().toLowerCase();
  if (!v) return null;
  if (v === "postgres" || v === "postgresql" || v === "db") return "postgres";
  if (v === "filesystem" || v === "fs" || v === "file") return "filesystem";
  throw new Error(`Invalid TT_ATTACHMENTS_BACKEND="${raw}". Use postgres or filesystem.`);
}

export function resolveTanTrackerAttachmentsBackend(
  env: NodeJS.ProcessEnv = process.env,
): TanTrackerAttachmentsBackend {
  const explicit = normalizeBackend(env.TT_ATTACHMENTS_BACKEND);
  if (explicit) return explicit;
  if (isTanTrackerUserTestEnvRequested(env) || env.NODE_ENV === "test") {
    return "filesystem";
  }
  if (env.NODE_ENV === "production") {
    return "postgres";
  }
  return "filesystem";
}

/**
 * Production must not rely on ephemeral local disk for attachment bytes.
 * No-op outside NODE_ENV=production unless test mode is explicitly requested.
 */
export function assertTanTrackerAttachmentsProductionBackend(
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (isTanTrackerUserTestEnvRequested(env)) return;
  if (env.NODE_ENV !== "production") return;

  const backend = resolveTanTrackerAttachmentsBackend(env);
  if (backend === "postgres") return;

  const allow = env.TT_ATTACHMENTS_ALLOW_EPHEMERAL_FS?.trim().toLowerCase();
  if (allow === "true" || allow === "1") {
    console.warn(
      "WARNING: TT_ATTACHMENTS_BACKEND=filesystem with TT_ATTACHMENTS_ALLOW_EPHEMERAL_FS on production NODE_ENV — attachments will not survive redeploy.",
    );
    return;
  }

  throw new Error(
    "Refusing production start: set TT_ATTACHMENTS_BACKEND=postgres for durable attachments, or TT_ATTACHMENTS_ALLOW_EPHEMERAL_FS=true only for non-production-like debugging.",
  );
}
