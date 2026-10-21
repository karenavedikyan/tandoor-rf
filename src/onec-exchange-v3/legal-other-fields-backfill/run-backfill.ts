import { readFile } from "node:fs/promises";
import { getDatabaseUrl } from "../../config";
import { createImportPool } from "../../onec-clients/apply";
import { readRemoteFileFromFtp } from "../../onec-clients/ftp-read";
import { tryAcquireImportLock, releaseImportLock } from "../../onec-clients/import-lock";
import { loadOnecFtpConfig } from "../../onec-ftp/config";
import { V3_BUNDLE_FILES, V3_FTP_CLIENTS_DIR, V3_MAX_FILE_BYTES } from "../constants";
import { formatTargetDbForReport } from "../target-db-fingerprint";
import { resolveTargetDbIdentityFromUrl, TargetDbIdentityError } from "../target-db-identity";
import {
  LEGAL_OTHER_FIELDS_BACKFILL_CLI_ERRORS,
  parseLegalOtherFieldsBackfillCliArgs,
} from "./cli-args";
import { parseClientsOtherFromJsonBytes } from "./parse-clients-file";
import {
  applyLegalOtherFieldsBackfill,
  planLegalOtherFieldsBackfill,
  type LegalOtherFieldsBackfillPlan,
} from "./plan-apply";

export type LegalOtherFieldsBackfillStatus = "SUCCESS" | "REJECTED_BY_CHECKS" | "ERROR" | "VALIDATION_FAILED";

export type LegalOtherFieldsBackfillResult = {
  status: LegalOtherFieldsBackfillStatus;
  mode: "dry_run" | "apply";
  message: string;
  errorCode?: string;
  sourceSha256?: string;
  targetDbFingerprint?: string;
  targetDbLabel?: string;
  plan?: LegalOtherFieldsBackfillPlan;
  applied?: number;
  skippedGuard?: number;
};

export type RunLegalOtherFieldsBackfillOptions = {
  env?: NodeJS.ProcessEnv;
  argv?: string[];
  clientsBytes?: Buffer;
};

export async function runLegalOtherFieldsBackfill(
  options: RunLegalOtherFieldsBackfillOptions = {},
): Promise<LegalOtherFieldsBackfillResult> {
  const env = options.env ?? process.env;
  const parsedCli = parseLegalOtherFieldsBackfillCliArgs(options.argv ?? []);
  if (!parsedCli.ok) {
    return {
      status: "ERROR",
      mode: "dry_run",
      errorCode: parsedCli.code,
      message: LEGAL_OTHER_FIELDS_BACKFILL_CLI_ERRORS[parsedCli.code] ?? parsedCli.code,
    };
  }
  const cli = parsedCli.options;

  let bytes: Buffer;
  if (options.clientsBytes) {
    bytes = options.clientsBytes;
  } else if (cli.clientsFilePath) {
    try {
      bytes = await readFile(cli.clientsFilePath);
    } catch {
      return { status: "ERROR", mode: cli.mode, errorCode: "FILE_READ_FAILED", message: "Cannot read clients file." };
    }
  } else {
    const loaded = loadOnecFtpConfig(env);
    if (!loaded.ok) {
      return {
        status: "VALIDATION_FAILED",
        mode: cli.mode,
        errorCode: "CLIENTS_SOURCE_UNAVAILABLE",
        message: "Pass --clients-file or configure FTP for /LC/clients/all_clients.json.",
      };
    }
    const remotePath = `${loaded.config.basePath.replace(/\/$/, "")}/${V3_FTP_CLIENTS_DIR}/${V3_BUNDLE_FILES.clients}`;
    const ftpRead = await readRemoteFileFromFtp(loaded.config, remotePath, V3_MAX_FILE_BYTES);
    if (!ftpRead.ok) {
      return {
        status: "ERROR",
        mode: cli.mode,
        errorCode: ftpRead.code || "FTP_READ_FAILED",
        message: ftpRead.message,
      };
    }
    bytes = ftpRead.bytes;
  }

  let parsedFile: ReturnType<typeof parseClientsOtherFromJsonBytes>;
  try {
    parsedFile = parseClientsOtherFromJsonBytes(bytes);
  } catch (error) {
    return {
      status: "VALIDATION_FAILED",
      mode: cli.mode,
      message: error instanceof Error ? error.message : "Invalid clients JSON.",
      errorCode: "PARSE_FAILED",
    };
  }

  const databaseUrl = getDatabaseUrl();
  if (!databaseUrl) {
    return { status: "ERROR", mode: cli.mode, errorCode: "NO_DATABASE_URL", message: "DATABASE_URL is not set." };
  }

  let targetDbFingerprint: string | undefined;
  try {
    const identity = await resolveTargetDbIdentityFromUrl(databaseUrl);
    targetDbFingerprint = identity.fingerprint;
  } catch (error) {
    const message =
      error instanceof TargetDbIdentityError ? error.message : "Target DB identity check failed.";
    return { status: "ERROR", mode: cli.mode, errorCode: "TARGET_DB_IDENTITY", message };
  }
  const targetDbLabel = formatTargetDbForReport(databaseUrl);

  const pool = createImportPool(databaseUrl);
  const client = await pool.connect();
  let plan: LegalOtherFieldsBackfillPlan | undefined;
  try {
    await client.query("BEGIN");
    plan = await planLegalOtherFieldsBackfill(
      client,
      parsedFile,
      cli.mode === "apply" ? { requireLastSourceSha256: cli.expectedSourceSha256 } : undefined,
    );
    await client.query("ROLLBACK");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    client.release();
    await pool.end();
    return {
      status: "ERROR",
      mode: cli.mode,
      errorCode: "PLAN_FAILED",
      message: error instanceof Error ? error.message : String(error),
    };
  } finally {
    client.release();
    await pool.end();
  }

  if (cli.mode === "dry_run") {
    return {
      status: "SUCCESS",
      mode: "dry_run",
      message: "Legal other_fields backfill dry-run completed (no database changes).",
      sourceSha256: parsedFile.sourceSha256,
      targetDbFingerprint,
      targetDbLabel,
      plan,
    };
  }

  if (cli.expectedSourceSha256 !== parsedFile.sourceSha256) {
    return {
      status: "REJECTED_BY_CHECKS",
      mode: "apply",
      errorCode: "SOURCE_SHA_MISMATCH",
      message: "Clients file SHA does not match --expected-source-sha256.",
      sourceSha256: parsedFile.sourceSha256,
      targetDbFingerprint,
      plan,
    };
  }
  if (cli.confirmTargetDb !== targetDbFingerprint) {
    return {
      status: "REJECTED_BY_CHECKS",
      mode: "apply",
      errorCode: "TARGET_DB_MISMATCH",
      message: "Target DB fingerprint does not match --confirm-target-db.",
      sourceSha256: parsedFile.sourceSha256,
      targetDbFingerprint,
      plan,
    };
  }
  if (cli.expectedPlanHash !== plan?.planHash) {
    return {
      status: "REJECTED_BY_CHECKS",
      mode: "apply",
      errorCode: "PLAN_HASH_MISMATCH",
      message: "Plan hash does not match --expected-plan-hash.",
      sourceSha256: parsedFile.sourceSha256,
      plan,
    };
  }

  const lockPool = createImportPool(databaseUrl);
  const lockClient = await lockPool.connect();
  const locked = await tryAcquireImportLock(lockClient);
  if (!locked) {
    lockClient.release();
    await lockPool.end();
    return {
      status: "REJECTED_BY_CHECKS",
      mode: "apply",
      errorCode: "IMPORT_LOCKED",
      message: "Another import holds the advisory lock.",
      sourceSha256: parsedFile.sourceSha256,
      targetDbFingerprint,
      plan,
    };
  }

  try {
    await lockClient.query("BEGIN");
    const applyResult = await applyLegalOtherFieldsBackfill(lockClient, parsedFile, plan!, {
      requireLastSourceSha256: cli.expectedSourceSha256,
    });
    await lockClient.query("COMMIT");
    return {
      status: "SUCCESS",
      mode: "apply",
      message: "other_fields backfill applied.",
      sourceSha256: parsedFile.sourceSha256,
      targetDbFingerprint,
      targetDbLabel,
      plan,
      applied: applyResult.applied,
      skippedGuard: applyResult.skippedGuard,
    };
  } catch (error) {
    await lockClient.query("ROLLBACK").catch(() => undefined);
    return {
      status: "ERROR",
      mode: "apply",
      errorCode: "APPLY_FAILED",
      message: error instanceof Error ? error.message : String(error),
      sourceSha256: parsedFile.sourceSha256,
      targetDbFingerprint,
      plan,
    };
  } finally {
    await releaseImportLock(lockClient);
    lockClient.release();
    await lockPool.end();
  }
}
