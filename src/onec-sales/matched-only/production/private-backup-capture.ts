import { chmod, lstat, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Pool } from "pg";
import { createPgPoolOptions } from "../../../config/pg-ssl";
import { backupSha256 } from "../backup";
import { captureScopedBackup } from "../scoped-backup-capture";
import type { MatchedOnlyBundlePlanV1 } from "../types";
import { withReadOnlyPreflightSession, PREFLIGHT_CONNECT_TIMEOUT_MS } from "./read-only-session";
import type { ExecutionManifestV2 } from "./manifest-types";
import { resolveProductionDatabaseUrl } from "./database-url";

export type PrivateBackupCaptureResult =
  | {
      ok: true;
      backupSha256: string;
      beforeStateSha256: string;
      planHash: string;
      destinationPath: string;
    }
  | { ok: false; code: string; message: string };

async function assertPrivateDestination(path: string): Promise<void> {
  const parent = dirname(path);
  const parentStat = await lstat(parent);
  if (!parentStat.isDirectory()) {
    throw new Error("CAPTURE_DESTINATION_PARENT_INVALID");
  }
  const parentMode = parentStat.mode & 0o777;
  if (parentMode & 0o077) {
    throw new Error("CAPTURE_DESTINATION_NOT_PRIVATE");
  }
}

export async function capturePrivateBusinessBackupForManifest(input: {
  manifest: ExecutionManifestV2;
  plan: MatchedOnlyBundlePlanV1;
}): Promise<PrivateBackupCaptureResult> {
  const capture = input.manifest.privateBackupCapture;
  if (!capture || capture.status !== "APPROVED" || !capture.destinationPath?.trim()) {
    return {
      ok: false,
      code: "CAPTURE_NOT_APPROVED",
      message: "Manifest private backup capture is not approved.",
    };
  }
  const destinationPath = capture.destinationPath;
  const urlResult = resolveProductionDatabaseUrl();
  if (!urlResult.ok) {
    return { ok: false, code: urlResult.code, message: urlResult.message };
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
    const backup = await withReadOnlyPreflightSession(pool, async (client) =>
      captureScopedBackup(client, input.plan),
    );
    const digest = backupSha256(backup);
    const payload = `${JSON.stringify(backup, null, 2)}\n`;
    const tempPath = join(dirname(destinationPath), `.${Date.now()}.backup.partial`);
    await writeFile(tempPath, payload, { encoding: "utf8", mode: 0o600 });
    await chmod(tempPath, 0o600);
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
