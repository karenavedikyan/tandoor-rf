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
  LegalOtherFieldsBackfillApplyError,
  planHasBlockingPreconditions,
  planLegalOtherFieldsBackfill,
  type LegalOtherFieldsBackfillPlan,
} from "./plan-apply";
import { validateClientsSourceForBackfill } from "./source-validation";

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
  parseErrors?: string[];
  duplicateGuids?: string[];
};

export type RunLegalOtherFieldsBackfillOptions = {
  env?: NodeJS.ProcessEnv;
  argv?: string[];
  clientsBytes?: Buffer;
};

function rejected(
  mode: "dry_run" | "apply",
  errorCode: string,
  message: string,
  extra: Partial<LegalOtherFieldsBackfillResult> = {},
): LegalOtherFieldsBackfillResult {
  return { status: "REJECTED_BY_CHECKS", mode, errorCode, message, ...extra };
}

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

  const sourceValidation = validateClientsSourceForBackfill(parsedFile);
  if (!sourceValidation.ok) {
    return {
      status: "VALIDATION_FAILED",
      mode: cli.mode,
      errorCode: sourceValidation.code,
      message: sourceValidation.message,
      sourceSha256: parsedFile.sourceSha256,
      parseErrors: sourceValidation.parseErrors,
      duplicateGuids: sourceValidation.duplicateGuids,
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
  let plan: LegalOtherFieldsBackfillPlan | undefined;
  try {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      plan = await planLegalOtherFieldsBackfill(client, parsedFile, {
        expectedSourceSha256: parsedFile.sourceSha256,
      });
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  } catch (error) {
    await pool.end();
    return {
      status: "ERROR",
      mode: cli.mode,
      errorCode: "PLAN_FAILED",
      message: error instanceof Error ? error.message : String(error),
    };
  }
  await pool.end();

  if (plan && planHasBlockingPreconditions(plan)) {
    return rejected(cli.mode, "SOURCE_PRECONDITION_FAILED", "Source or import-history preconditions failed.", {
      sourceSha256: parsedFile.sourceSha256,
      targetDbFingerprint,
      plan,
      parseErrors: plan.parseErrors,
      duplicateGuids: plan.duplicateGuids,
    });
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
    return rejected("apply", "SOURCE_SHA_MISMATCH", "Clients file SHA does not match --expected-source-sha256.", {
      sourceSha256: parsedFile.sourceSha256,
      targetDbFingerprint,
      plan,
    });
  }
  if (cli.confirmTargetDb !== targetDbFingerprint) {
    return rejected("apply", "TARGET_DB_MISMATCH", "Target DB fingerprint does not match --confirm-target-db.", {
      sourceSha256: parsedFile.sourceSha256,
      targetDbFingerprint,
      plan,
    });
  }
  if (cli.expectedPlanHash !== plan?.planHash) {
    return rejected("apply", "PLAN_HASH_MISMATCH", "Plan hash does not match --expected-plan-hash.", {
      sourceSha256: parsedFile.sourceSha256,
      plan,
    });
  }

  const lockPool = createImportPool(databaseUrl);
  const lockClient = await lockPool.connect();
  const locked = await tryAcquireImportLock(lockClient);
  if (!locked) {
    lockClient.release();
    await lockPool.end();
    return rejected("apply", "IMPORT_LOCKED", "Another import holds the advisory lock.", {
      sourceSha256: parsedFile.sourceSha256,
      targetDbFingerprint,
      plan,
    });
  }

  try {
    await lockClient.query("BEGIN");
    const livePlan = await planLegalOtherFieldsBackfill(lockClient, parsedFile, {
      expectedSourceSha256: parsedFile.sourceSha256,
    });
    if (planHasBlockingPreconditions(livePlan)) {
      await lockClient.query("ROLLBACK");
      return rejected("apply", "SOURCE_PRECONDITION_FAILED", "Live plan preconditions failed under lock.", {
        sourceSha256: parsedFile.sourceSha256,
        targetDbFingerprint,
        plan: livePlan,
      });
    }
    if (livePlan.planHash !== plan?.planHash) {
      await lockClient.query("ROLLBACK");
      return rejected("apply", "PLAN_HASH_MISMATCH", "Live plan hash drifted since dry-run.", {
        sourceSha256: parsedFile.sourceSha256,
        plan: livePlan,
      });
    }
    const applyResult = await applyLegalOtherFieldsBackfill(lockClient, parsedFile, livePlan, {
      expectedSourceSha256: parsedFile.sourceSha256,
    });
    await lockClient.query("COMMIT");
    return {
      status: "SUCCESS",
      mode: "apply",
      message: "other_fields backfill applied.",
      sourceSha256: parsedFile.sourceSha256,
      targetDbFingerprint,
      targetDbLabel,
      plan: livePlan,
      applied: applyResult.applied,
    };
  } catch (error) {
    await lockClient.query("ROLLBACK").catch(() => undefined);
    if (error instanceof LegalOtherFieldsBackfillApplyError) {
      return {
        status: "ERROR",
        mode: "apply",
        errorCode: error.code,
        message: error.message,
        sourceSha256: parsedFile.sourceSha256,
        targetDbFingerprint,
        plan,
      };
    }
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
