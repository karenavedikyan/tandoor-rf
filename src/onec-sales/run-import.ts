import { readFile } from "node:fs/promises";
import { getDatabaseUrl } from "../config";
import { formatTargetDbForReport } from "../onec-exchange-v3/target-db-fingerprint";
import {
  resolveTargetDbIdentityFromUrl,
  TargetDbIdentityError,
} from "../onec-exchange-v3/target-db-identity";
import { createImportPool } from "../onec-clients/apply";
import { tryAcquireImportLock, releaseImportLock } from "../onec-clients/import-lock";
import { loadOnecFtpConfig } from "../onec-ftp/config";
import { readRemoteFileFromFtp } from "../onec-clients/ftp-read";
import { buildLegalSalesFilePath, MAX_LEGAL_SALES_BYTES } from "./constants";
import { parseLegalSalesCliArgs, LEGAL_SALES_CLI_ERRORS } from "./cli-args";
import { parseLegalSalesJsonBytes } from "./parse-sale-json";
import { applyLegalSalesImport, planLegalSalesImport, type LegalSalesImportPlan } from "./plan-apply";

export type LegalSalesImportStatus = "SUCCESS" | "REJECTED_BY_CHECKS" | "ERROR" | "VALIDATION_FAILED";

export type LegalSalesImportResult = {
  status: LegalSalesImportStatus;
  mode: "dry_run" | "apply";
  message: string;
  errorCode?: string;
  sourceSha256?: string;
  targetDbFingerprint?: string;
  targetDbLabel?: string;
  plan?: LegalSalesImportPlan;
};

export type RunLegalSalesImportOptions = {
  env?: NodeJS.ProcessEnv;
  argv?: string[];
  saleBytes?: Buffer;
};

async function readSaleBytesFromFtp(env: NodeJS.ProcessEnv): Promise<
  | { ok: true; bytes: Buffer }
  | { ok: false; code: string; message: string }
> {
  const loaded = loadOnecFtpConfig(env);
  if (!loaded.ok) {
    return { ok: false, code: "CONFIG_ERROR", message: loaded.message };
  }
  const remotePath = buildLegalSalesFilePath(loaded.config.basePath);
  const read = await readRemoteFileFromFtp(loaded.config, remotePath, MAX_LEGAL_SALES_BYTES);
  if (!read.ok) {
    return { ok: false, code: read.code, message: read.message };
  }
  return { ok: true, bytes: read.bytes };
}

export async function runLegalSalesImport(
  options: RunLegalSalesImportOptions = {},
): Promise<LegalSalesImportResult> {
  const env = options.env ?? process.env;
  const parsedCli = parseLegalSalesCliArgs(options.argv ?? []);
  if (!parsedCli.ok) {
    return {
      status: "ERROR",
      mode: "dry_run",
      errorCode: parsedCli.code,
      message: LEGAL_SALES_CLI_ERRORS[parsedCli.code] ?? parsedCli.code,
    };
  }
  const cli = parsedCli.options;

  let bytes: Buffer;
  if (options.saleBytes) {
    bytes = options.saleBytes;
  } else {
    try {
      bytes = await readFile(cli.saleFilePath);
    } catch {
      return { status: "ERROR", mode: cli.mode, errorCode: "FILE_READ_FAILED", message: "Cannot read sale file." };
    }
  }

  const parsed = parseLegalSalesJsonBytes(bytes);
  if (!parsed.ok) {
    return {
      status: "VALIDATION_FAILED",
      mode: cli.mode,
      errorCode: parsed.code,
      message: parsed.message,
    };
  }

  const databaseUrl = getDatabaseUrl();
  if (!databaseUrl) {
    return {
      status: "ERROR",
      mode: cli.mode,
      errorCode: "DATABASE_URL_REQUIRED",
      message: "DATABASE_URL required.",
    };
  }

  let targetDbFingerprint: string | undefined;
  try {
    const identity = await resolveTargetDbIdentityFromUrl(databaseUrl);
    targetDbFingerprint = identity.fingerprint;
  } catch (error) {
    const message = error instanceof TargetDbIdentityError ? error.message : "Target DB identity failed.";
    return { status: "ERROR", mode: cli.mode, errorCode: "TARGET_DB_IDENTITY_FAILED", message };
  }

  const pool = createImportPool(databaseUrl);
  const client = await pool.connect();
  let plan: LegalSalesImportPlan | undefined;
  try {
    await client.query("BEGIN");
    plan = await planLegalSalesImport(client, parsed.roster);
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
      message: "Legal sales dry-run completed (no database changes).",
      sourceSha256: parsed.roster.sourceSha256,
      targetDbFingerprint,
      targetDbLabel: formatTargetDbForReport(databaseUrl),
      plan,
    };
  }

  if (cli.expectedSourceSha256 !== parsed.roster.sourceSha256) {
    return {
      status: "REJECTED_BY_CHECKS",
      mode: "apply",
      errorCode: "SOURCE_SHA256_MISMATCH",
      message: "sale.json SHA-256 changed since dry-run; re-run dry-run.",
      sourceSha256: parsed.roster.sourceSha256,
      targetDbFingerprint,
      plan,
    };
  }
  if (cli.confirmTargetDb !== targetDbFingerprint) {
    return {
      status: "REJECTED_BY_CHECKS",
      mode: "apply",
      errorCode: "TARGET_DB_MISMATCH",
      message: "Target DB fingerprint does not match dry-run.",
      sourceSha256: parsed.roster.sourceSha256,
      targetDbFingerprint,
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
      sourceSha256: parsed.roster.sourceSha256,
      targetDbFingerprint,
      plan,
    };
  }

  try {
    await lockClient.query("BEGIN");
    const applyPlan = await applyLegalSalesImport(lockClient, parsed.roster);
    await lockClient.query("COMMIT");
    return {
      status: "SUCCESS",
      mode: "apply",
      message: "Legal sales import applied.",
      sourceSha256: parsed.roster.sourceSha256,
      targetDbFingerprint,
      targetDbLabel: formatTargetDbForReport(databaseUrl),
      plan: applyPlan,
    };
  } catch (error) {
    await lockClient.query("ROLLBACK").catch(() => undefined);
    return {
      status: "ERROR",
      mode: "apply",
      errorCode: "APPLY_FAILED",
      message: error instanceof Error ? error.message : String(error),
      sourceSha256: parsed.roster.sourceSha256,
      targetDbFingerprint,
      plan,
    };
  } finally {
    await releaseImportLock(lockClient);
    lockClient.release();
    await lockPool.end();
  }
}

export { readSaleBytesFromFtp };
