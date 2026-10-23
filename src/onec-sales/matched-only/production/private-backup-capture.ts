import { chmod, lstat, open } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { Pool } from "pg";
import { createPgPoolOptions } from "../../../config/pg-ssl";
import { resolveTargetDbIdentityFromUrl } from "../../../onec-exchange-v3/target-db-identity";
import { backupSha256 } from "../backup";
import { captureScopedBackup } from "../scoped-backup-capture";
import type { MatchedOnlyBundlePlanV1 } from "../types";
import { withReadOnlyPreflightSession, PREFLIGHT_CONNECT_TIMEOUT_MS } from "./read-only-session";
import type { ExecutionManifestV2 } from "./manifest-types";
import { resolveProductionDatabaseUrl } from "./database-url";
import { validatePrivateCaptureManifestForRun } from "./manifest-capture-validate";
import { assertManifestCodeProvenance } from "./runtime-provenance";

export type PrivateBackupCaptureResult =
  | {
      ok: true;
      backupSha256: string;
      beforeStateSha256: string;
      planHash: string;
      destinationPath: string;
    }
  | { ok: false; code: string; message: string };

const PUBLIC_PATH_MARKERS = ["/public/", "/static/", "/runtime-export/"];

async function assertPrivateDestination(path: string): Promise<void> {
  const resolved = resolve(path);
  const lower = resolved.toLowerCase();
  for (const marker of PUBLIC_PATH_MARKERS) {
    if (lower.includes(marker)) {
      throw new Error("CAPTURE_DESTINATION_PUBLIC_PATH");
    }
  }
  let current = dirname(resolved);
  const root = resolve("/");
  while (current !== root) {
    const stat = await lstat(current);
    if (stat.isSymbolicLink()) {
      throw new Error("CAPTURE_DESTINATION_SYMLINK_ANCESTOR");
    }
    const mode = stat.mode & 0o777;
    if (mode & 0o077) {
      throw new Error("CAPTURE_DESTINATION_NOT_PRIVATE");
    }
    current = dirname(current);
  }
}

export async function capturePrivateBusinessBackupForManifest(input: {
  manifest: ExecutionManifestV2;
  plan: MatchedOnlyBundlePlanV1;
  approvedCaptureHash?: string;
}): Promise<PrivateBackupCaptureResult> {
  const captureCheck = validatePrivateCaptureManifestForRun({
    manifest: input.manifest,
    approvedCaptureHash: input.approvedCaptureHash,
  });
  if (!captureCheck.ok) {
    return captureCheck;
  }
  const provenance = await assertManifestCodeProvenance(
    input.manifest.provenance.codeArtifactLabel,
    input.manifest.provenance.expectedExecutableArtifactSha256,
    true,
  );
  if (!provenance.ok) {
    return provenance;
  }
  const destinationPath = input.manifest.privateBackupCapture!.destinationPath!;
  const urlResult = resolveProductionDatabaseUrl();
  if (!urlResult.ok) {
    return { ok: false, code: urlResult.code, message: urlResult.message };
  }
  const identity = await resolveTargetDbIdentityFromUrl(urlResult.databaseUrl);
  if (identity.fingerprint !== input.plan.identity.targetDbFingerprint) {
    return {
      ok: false,
      code: "CAPTURE_TARGET_IDENTITY_MISMATCH",
      message: "Live database identity does not match approved plan target fingerprint.",
    };
  }
  try {
    await assertPrivateDestination(destinationPath);
  } catch (error) {
    return {
      ok: false,
      code: "CAPTURE_DESTINATION_INVALID",
      message: error instanceof Error ? error.message : "Invalid capture destination.",
    };
  }

  const pgOptions = createPgPoolOptions(urlResult.databaseUrl);
  const pool = new Pool({
    connectionString: pgOptions.connectionString,
    max: 1,
    connectionTimeoutMillis: PREFLIGHT_CONNECT_TIMEOUT_MS,
    ssl: pgOptions.ssl === false ? false : pgOptions.ssl,
  });

  try {
    const backup = await withReadOnlyPreflightSession(pool, async (client) => {
      const schema = await import("./schema-readiness").then((m) => m.assertMatchedOnlySchemaReady(client));
      if (!schema.ok) {
        throw new Error(schema.code);
      }
      return captureScopedBackup(client, input.plan);
    });
    if (backup.targetDbFingerprint !== identity.fingerprint) {
      return {
        ok: false,
        code: "CAPTURE_BACKUP_IDENTITY_MISMATCH",
        message: "Captured backup target fingerprint does not match live database.",
      };
    }
    const digest = backupSha256(backup);
    const payload = `${JSON.stringify(backup, null, 2)}\n`;
    const tempPath = join(dirname(destinationPath), `.capture-${Date.now()}-${process.pid}.partial`);
    const tempHandle = await open(tempPath, "wx", 0o600);
    try {
      await tempHandle.writeFile(payload, { encoding: "utf8" });
    } finally {
      await tempHandle.close();
    }
    await chmod(tempPath, 0o600);
    try {
      await open(destinationPath, "r");
      return {
        ok: false,
        code: "CAPTURE_DESTINATION_EXISTS",
        message: "Backup destination already exists; exclusive capture refused.",
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
    const { rename } = await import("node:fs/promises");
    await rename(tempPath, destinationPath);
    await chmod(destinationPath, 0o600);
    return {
      ok: true,
      backupSha256: digest,
      beforeStateSha256: backup.beforeStateSha256,
      planHash: backup.planHash,
      destinationPath,
    };
  } catch (error) {
    return {
      ok: false,
      code: "CAPTURE_FAILED",
      message: error instanceof Error ? error.message : "Private backup capture failed.",
    };
  } finally {
    await pool.end();
  }
}
