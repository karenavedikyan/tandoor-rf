import { getDatabaseUrl } from "../config";
import { formatTargetDbForReport } from "../onec-exchange-v3/target-db-fingerprint";
import {
  resolveTargetDbIdentityFromUrl,
  TargetDbIdentityError,
} from "../onec-exchange-v3/target-db-identity";
import { createImportPool } from "./apply";
import { readEmployeeRosterFileBytes } from "./cli-args";
import { parseWholesaleEmployeeRosterBytes } from "./employee-roster";
import { tryAcquireImportLock, releaseImportLock } from "./import-lock";
import {
  applyAuthoritativeWholesaleOrgSnapshot,
  authoritativeOrgSnapshotEnabled,
  planAuthoritativeWholesaleOrgSnapshot,
  validateAuthoritativeOrgRoster,
} from "./roster-authoritative-org";
import {
  AUTHORITATIVE_ORG_CLI_ERRORS,
  parseAuthoritativeOrgCliArgs,
  resolveAuthoritativeOrgRosterPath,
} from "./authoritative-org-cli-args";

export type AuthoritativeOrgRebuildStatus =
  | "SUCCESS"
  | "REJECTED_BY_CHECKS"
  | "ERROR"
  | "VALIDATION_FAILED";

export type AuthoritativeOrgRebuildResult = {
  status: AuthoritativeOrgRebuildStatus;
  mode: "dry_run" | "apply";
  message: string;
  errorCode?: string;
  rosterSourceSha256?: string;
  targetDbFingerprint?: string;
  targetDbLabel?: string;
  plan?: Awaited<ReturnType<typeof planAuthoritativeWholesaleOrgSnapshot>>;
  applyCounts?: Awaited<ReturnType<typeof applyAuthoritativeWholesaleOrgSnapshot>>;
  authoritativeModeRequired: boolean;
};

function rejected(input: Omit<AuthoritativeOrgRebuildResult, "authoritativeModeRequired">): AuthoritativeOrgRebuildResult {
  return { ...input, authoritativeModeRequired: true };
}

export type RunAuthoritativeOrgRebuildOptions = {
  env?: NodeJS.ProcessEnv;
  argv?: string[];
  rosterBytes?: Buffer;
};

export async function runAuthoritativeWholesaleOrgRebuild(
  options: RunAuthoritativeOrgRebuildOptions = {},
): Promise<AuthoritativeOrgRebuildResult> {
  const env = options.env ?? process.env;
  const parsed = parseAuthoritativeOrgCliArgs(options.argv ?? []);
  if (!parsed.ok) {
    return rejected({
      status: "ERROR",
      mode: "dry_run",
      errorCode: parsed.code,
      message: AUTHORITATIVE_ORG_CLI_ERRORS[parsed.code],
    });
  }
  const cli = parsed.options;

  if (!authoritativeOrgSnapshotEnabled(env)) {
    return rejected({
      status: "REJECTED_BY_CHECKS",
      mode: cli.mode,
      errorCode: "AUTHORITATIVE_SNAPSHOT_ENV_REQUIRED",
      message:
        "Set TANDOOR_WHOLESALE_ORG_AUTHORITATIVE_SNAPSHOT=1 for wholesale org rebuild (does not affect partial roster imports).",
    });
  }

  let rosterBytes: Buffer;
  if (options.rosterBytes) {
    rosterBytes = options.rosterBytes;
  } else {
    const read = readEmployeeRosterFileBytes(resolveAuthoritativeOrgRosterPath(cli.employeeRosterPath));
    if (!read.ok) {
      return rejected({
        status: "ERROR",
        mode: cli.mode,
        errorCode: read.code,
        message: read.code,
      });
    }
    rosterBytes = read.bytes;
  }

  const parsedRoster = parseWholesaleEmployeeRosterBytes(rosterBytes);
  if (!parsedRoster.ok) {
    return rejected({
      status: "VALIDATION_FAILED",
      mode: cli.mode,
      errorCode: parsedRoster.code,
      message: parsedRoster.message,
    });
  }

  const roster = parsedRoster.roster;
  const orgValidation = validateAuthoritativeOrgRoster(roster);
  if (!orgValidation.ok) {
    return rejected({
      status: "VALIDATION_FAILED",
      mode: cli.mode,
      errorCode: orgValidation.code,
      message: orgValidation.message,
      rosterSourceSha256: roster.sourceSha256,
    });
  }

  const databaseUrl = env.DATABASE_URL?.trim() || getDatabaseUrl();
  const targetDbLabel = databaseUrl ? formatTargetDbForReport(databaseUrl) : undefined;

  if (cli.mode === "dry_run") {
    if (!databaseUrl) {
      return rejected({
        status: "SUCCESS",
        mode: "dry_run",
        rosterSourceSha256: roster.sourceSha256,
        message: `Roster validated for authoritative org rebuild. SHA256=${roster.sourceSha256}. DATABASE_URL not set — plan aggregates skipped.`,
      });
    }

    let targetDbFingerprint: string | undefined;
    try {
      const identity = await resolveTargetDbIdentityFromUrl(databaseUrl);
      targetDbFingerprint = identity.fingerprint;
    } catch (error) {
      if (error instanceof TargetDbIdentityError) {
        return rejected({
          status: "ERROR",
          mode: "dry_run",
          errorCode: error.code,
          message: error.message,
          rosterSourceSha256: roster.sourceSha256,
          targetDbLabel,
        });
      }
      throw error;
    }

    const pool = createImportPool(databaseUrl);
    const client = await pool.connect();
    try {
      const plan = await planAuthoritativeWholesaleOrgSnapshot(client, roster);
      return rejected({
        status: "SUCCESS",
        mode: "dry_run",
        rosterSourceSha256: roster.sourceSha256,
        targetDbFingerprint,
        targetDbLabel,
        plan,
        message: `Authoritative org dry-run OK. Apply with --apply --expected-roster-sha256=${roster.sourceSha256} --confirm-target-db=${targetDbFingerprint}.`,
      });
    } finally {
      client.release();
      await pool.end();
    }
  }

  if (!databaseUrl) {
    return rejected({
      status: "ERROR",
      mode: "apply",
      errorCode: "DATABASE_URL_REQUIRED",
      message: "DATABASE_URL required for apply.",
      rosterSourceSha256: roster.sourceSha256,
    });
  }

  if (cli.expectedRosterSha256 !== roster.sourceSha256) {
    return rejected({
      status: "REJECTED_BY_CHECKS",
      mode: "apply",
      errorCode: "ROSTER_SHA256_MISMATCH",
      message: "Employee roster SHA-256 changed since dry-run; re-run dry-run.",
      rosterSourceSha256: roster.sourceSha256,
      targetDbLabel,
    });
  }

  let targetDbFingerprint: string;
  try {
    const identity = await resolveTargetDbIdentityFromUrl(databaseUrl);
    targetDbFingerprint = identity.fingerprint;
  } catch (error) {
    if (error instanceof TargetDbIdentityError) {
      return rejected({
        status: "ERROR",
        mode: "apply",
        errorCode: error.code,
        message: error.message,
        rosterSourceSha256: roster.sourceSha256,
        targetDbLabel,
      });
    }
    throw error;
  }

  if (cli.confirmTargetDb !== targetDbFingerprint) {
    return rejected({
      status: "REJECTED_BY_CHECKS",
      mode: "apply",
      errorCode: "TARGET_DB_MISMATCH",
      message: "Target DB fingerprint does not match dry-run.",
      rosterSourceSha256: roster.sourceSha256,
      targetDbFingerprint,
      targetDbLabel,
    });
  }

  const pool = createImportPool(databaseUrl);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const locked = await tryAcquireImportLock(client);
    if (!locked) {
      await client.query("ROLLBACK");
      return rejected({
        status: "REJECTED_BY_CHECKS",
        mode: "apply",
        errorCode: "IMPORT_LOCKED",
        message: "Another import holds the advisory lock.",
        rosterSourceSha256: roster.sourceSha256,
        targetDbFingerprint,
        targetDbLabel,
      });
    }
    try {
      const applyCounts = await applyAuthoritativeWholesaleOrgSnapshot(client, roster);
      await client.query("COMMIT");
      return rejected({
        status: "SUCCESS",
        mode: "apply",
        rosterSourceSha256: roster.sourceSha256,
        targetDbFingerprint,
        targetDbLabel,
        applyCounts,
        message: "Authoritative wholesale org snapshot applied.",
      });
    } catch (error) {
      await client.query("ROLLBACK");
      return rejected({
        status: "ERROR",
        mode: "apply",
        errorCode: "APPLY_FAILED",
        message: error instanceof Error ? error.message : String(error),
        rosterSourceSha256: roster.sourceSha256,
        targetDbFingerprint,
        targetDbLabel,
      });
    } finally {
      await releaseImportLock(client);
    }
  } finally {
    client.release();
    await pool.end();
  }
}
