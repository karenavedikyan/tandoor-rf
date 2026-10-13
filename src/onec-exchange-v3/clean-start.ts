import type { PoolClient } from "pg";
import { IMPORT_ADVISORY_LOCK_KEY } from "../onec-clients/constants";
import { tryAcquireImportLock } from "../onec-clients/import-lock";
import { requirePool } from "../db/pool";
import { validateExchangeV3Bundle } from "./validate-bundle";
import type { V3ValidatedBundle } from "./types";
import { countLegacyClientScope, purgeLegacyClientDomain } from "./legacy-client-purge";
import { revokeLegacyBitrixClientLabels, purgeV3Domain } from "./clean-start-purge";
import { applyExchangeV3BundleOnClient } from "./apply";
import { parseTargetDbDescriptor, type TargetDbDescriptor } from "./target-db-fingerprint";
import { observeCleanStartState } from "./clean-start-verify";
import {
  databaseNameMismatchBlocker,
  IDENTITY_ADMIN_QUERY_TIMEOUT_MS,
  pgQueryWithTimeout,
  readTargetDbIdentityFromClient,
  resetIdentityStatementTimeout,
  setIdentityStatementTimeout,
  shouldDiscardPgClientAfterError,
  TargetDbIdentityError,
  withOneOffPgClient,
  type TargetDbIdentity,
} from "./target-db-identity";

/** @internal exported for regression tests */
export async function rollbackCleanStartTransaction(
  client: PoolClient,
  testHooks?: CleanStartTestHooks,
): Promise<boolean> {
  try {
    if (testHooks?.simulateRollbackSqlError) {
      throw new Error("rollback cleanup failed");
    }
    await pgQueryWithTimeout(client, "ROLLBACK", IDENTITY_ADMIN_QUERY_TIMEOUT_MS);
    return false;
  } catch {
    return true;
  }
}

/** @internal exported for regression tests */
export async function releaseCleanStartImportLock(
  client: PoolClient,
  testHooks?: CleanStartTestHooks,
): Promise<boolean> {
  try {
    if (testHooks?.simulateLockReleaseTransportTimeout) {
      throw new Error("Query read timeout");
    }
    if (testHooks?.simulateLockReleaseSqlError) {
      throw new Error("advisory unlock cleanup failed");
    }
    const unlocked = await pgQueryWithTimeout<{ pg_advisory_unlock: boolean }>(
      client,
      "SELECT pg_advisory_unlock($1) AS pg_advisory_unlock",
      IDENTITY_ADMIN_QUERY_TIMEOUT_MS,
      [IMPORT_ADVISORY_LOCK_KEY],
    );
    if (unlocked.rows[0]?.pg_advisory_unlock !== true) {
      return true;
    }
    return false;
  } catch {
    return true;
  }
}

export type CleanStartDryRunReport = {
  mode: "dry_run";
  targetDb: TargetDbIdentity;
  bundleFingerprint: string;
  fileSha256: Record<string, string>;
  wouldRemove: Awaited<ReturnType<typeof countLegacyClientScope>>;
  wouldLoad: {
    holdings: number;
    legalEntities: number;
    retailOutlets: number;
    employees: number;
  };
  preserved: {
    users: number;
    employeeRoster: number;
    employeeLinks: number;
  };
  warnings: string[];
  blockers: string[];
};

export type CleanStartApplyReport = {
  mode: "apply";
  targetDb: TargetDbIdentity;
  bundleFingerprint: string;
  legacyRemoved: Awaited<ReturnType<typeof purgeLegacyClientDomain>> | null;
  bitrixLabelsRevoked: number | null;
  loaded: { holdings: number; legalEntities: number; retailOutlets: number; employees: number };
  /** Set when outcome was inferred after lost COMMIT acknowledgement (not a full apply trace). */
  recoveredAfterCommitUncertainty?: boolean;
};

export type CleanStartCommitUncertainReport = {
  mode: "apply";
  targetDb: TargetDbIdentity;
  bundleFingerprint: string;
  observed: Awaited<ReturnType<typeof observeCleanStartState>>;
  message: string;
};

export type CleanStartTestHooks = {
  failAfter?: "lock" | "purge_legacy" | "bitrix" | "apply";
  /** Throws before COMMIT (transaction rolls back). */
  failCommit?: boolean;
  /** COMMIT succeeds, then simulates lost client acknowledgement. */
  loseCommitAckAfterSuccessfulCommit?: boolean;
  /** Integration tests: simulate pg_control_system denial on apply connection identity read. */
  simulatePgControlSystemDenied?: boolean;
  /** Integration tests: trigger client-side query_timeout during identity read on apply pool. */
  identityTestPreSleepSec?: number;
  identityQueryTimeoutMs?: number;
  /** Integration tests: transport error after successful COMMIT before ack flag is set. */
  simulateCommitTransportTimeout?: boolean;
  /** Integration tests: transport error while releasing advisory lock in finally. */
  simulateLockReleaseTransportTimeout?: boolean;
  /** Integration tests: generic SQL error during ROLLBACK in error path. */
  simulateRollbackSqlError?: boolean;
  /** Integration tests: generic SQL error during advisory unlock in finally. */
  simulateLockReleaseSqlError?: boolean;
};

async function countPreserved(client: PoolClient): Promise<CleanStartDryRunReport["preserved"]> {
  const users = Number(
    (await client.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM users`)).rows[0]?.count ?? "0",
  );
  const employeeRoster = Number(
    (
      await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM onec_wholesale_employee_roster`,
      )
    ).rows[0]?.count ?? "0",
  );
  const employeeLinks = Number(
    (
      await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM user_onec_employee_links WHERE revoked_at IS NULL`,
      )
    ).rows[0]?.count ?? "0",
  );
  return { users, employeeRoster, employeeLinks };
}

async function assertNoConcurrentJobs(client: PoolClient): Promise<string | null> {
  const pending = await client.query<{ id: string }>(
    `SELECT id::text FROM onec_import_jobs WHERE status IN ('pending', 'running') LIMIT 1`,
  );
  if (pending.rows.length > 0) {
    return "Обнаружен активный или ожидающий onec_import_jobs";
  }
  return null;
}

/** Dry-run on a dedicated one-off connection (TLS/CA + statement/query timeouts). */
export async function runExchangeV3CleanStartDryRun(
  databaseUrl: string,
  bundle: V3ValidatedBundle,
): Promise<CleanStartDryRunReport> {
  return withOneOffPgClient(databaseUrl, (client) =>
    buildCleanStartDryRunReport(client, bundle, databaseUrl),
  );
}

export async function buildCleanStartDryRunReport(
  client: PoolClient,
  bundle: V3ValidatedBundle,
  databaseUrl: string,
): Promise<CleanStartDryRunReport> {
  const targetDb = await readTargetDbIdentityFromClient(client, databaseUrl);

  const wouldRemove = await countLegacyClientScope(client);
  const preserved = await countPreserved(client);
  const blockers: string[] = [];
  const dbMismatch = databaseNameMismatchBlocker(targetDb, databaseUrl);
  if (dbMismatch) {
    blockers.push(dbMismatch);
  }
  const jobBlocker = await assertNoConcurrentJobs(client);
  if (jobBlocker) {
    blockers.push(jobBlocker);
  }
  const completed = await client.query<{ legacy_clean_start_completed_at: string | null }>(
    `SELECT legacy_clean_start_completed_at FROM onec_v3_exchange_state WHERE id = 1`,
  );
  if (completed.rows[0]?.legacy_clean_start_completed_at) {
    blockers.push("Clean start уже выполнялся; для повтора нужен --force-clean-start");
  }

  return {
    mode: "dry_run",
    targetDb,
    bundleFingerprint: bundle.bundleFingerprint,
    fileSha256: bundle.fileSha256,
    wouldRemove,
    wouldLoad: {
      holdings: bundle.holdings.length,
      legalEntities: bundle.legalEntities.length,
      retailOutlets: bundle.retailOutlets.length,
      employees: bundle.employeeRoster.wholesaleCount,
    },
    preserved,
    warnings: bundle.warnings,
    blockers,
  };
}

export async function resolveCleanStartCommitUncertainty(input: {
  databaseUrl: string;
  bundleFingerprint: string;
  confirmTargetDbFingerprint: string;
  pendingLegacyRemoved?: Awaited<ReturnType<typeof purgeLegacyClientDomain>>;
  pendingBitrixLabelsRevoked?: number;
}): Promise<
  | { ok: true; report: CleanStartApplyReport }
  | {
      ok: false;
      errorCode: "COMMIT_UNCERTAIN" | "TARGET_DB_MISMATCH";
      message: string;
      report: CleanStartCommitUncertainReport;
    }
> {
  const observed = await observeCleanStartState(input.databaseUrl);
  const targetDb: TargetDbIdentity | null = observed?.targetDb ?? null;

  if (!observed || !targetDb) {
    return {
      ok: false,
      errorCode: "COMMIT_UNCERTAIN",
      message:
        "Исход COMMIT неизвестен; не удалось достоверно прочитать состояние БД. Повтор clean-start запрещён.",
      report: {
        mode: "apply",
        targetDb: targetDb ?? {
          host: "",
          port: "",
          database: parseTargetDbDescriptor(input.databaseUrl)?.database ?? "",
          fingerprint: "",
          systemIdentifier: "",
          serverHost: "",
          serverPort: "",
          urlHost: "",
          urlPort: "",
        },
        bundleFingerprint: input.bundleFingerprint,
        observed,
        message: "commit_outcome_unknown",
      },
    };
  }

  if (targetDb.fingerprint !== input.confirmTargetDbFingerprint) {
    return {
      ok: false,
      errorCode: "TARGET_DB_MISMATCH",
      message: "Наблюдаемая БД не совпадает с подтверждённым targetDbFingerprint; успех COMMIT не заявлен.",
      report: {
        mode: "apply",
        targetDb,
        bundleFingerprint: input.bundleFingerprint,
        observed,
        message: "observed_db_fingerprint_mismatch",
      },
    };
  }

  if (
    observed.legacyCleanStartCompletedAt &&
    observed.legacyCleanStartBundleFingerprint === input.bundleFingerprint &&
    observed.v3HoldingsCount > 0
  ) {
    return {
      ok: true,
      report: {
        mode: "apply",
        targetDb,
        bundleFingerprint: input.bundleFingerprint,
        legacyRemoved: input.pendingLegacyRemoved ?? null,
        bitrixLabelsRevoked: input.pendingBitrixLabelsRevoked ?? null,
        loaded: {
          holdings: observed.v3HoldingsCount,
          legalEntities: observed.v3LegalCount,
          retailOutlets: observed.v3RetailCount,
          employees: observed.v3EmployeeRosterCount,
        },
        recoveredAfterCommitUncertainty: true,
      },
    };
  }

  return {
    ok: false,
    errorCode: "COMMIT_UNCERTAIN",
    message:
      "Исход COMMIT неизвестен; автоматический повтор clean-start запрещён. Проверьте legacy_clean_start_* и fingerprint через новое подключение.",
    report: {
      mode: "apply",
      targetDb,
      bundleFingerprint: input.bundleFingerprint,
      observed,
      message: "commit_outcome_unknown",
    },
  };
}

export async function runExchangeV3CleanStartApply(input: {
  databaseUrl: string;
  bundle: V3ValidatedBundle;
  confirmTargetDbFingerprint: string;
  confirmBundleFingerprint: string;
  forceCleanStart?: boolean;
  testHooks?: CleanStartTestHooks;
}): Promise<
  | { ok: true; report: CleanStartApplyReport }
  | {
      ok: false;
      errorCode: string;
      message: string;
      report?: Partial<CleanStartApplyReport> | CleanStartCommitUncertainReport;
    }
> {
  if (input.confirmBundleFingerprint !== input.bundle.bundleFingerprint) {
    return { ok: false, errorCode: "BUNDLE_FINGERPRINT_MISMATCH", message: "bundleFingerprint не совпадает" };
  }

  const pool = requirePool();
  const client = await pool.connect();
  let commitAttempted = false;
  let commitConfirmed = false;
  let primaryErrorCode = "CLEAN_START_FAILED";
  let primaryMessage = "Clean start failed";
  let applyReport: CleanStartApplyReport | undefined;
  let targetIdentity: TargetDbIdentity | undefined;
  let legacyRemoved: Awaited<ReturnType<typeof purgeLegacyClientDomain>> | undefined;
  let bitrixLabelsRevoked: number | undefined;
  let discardPooledClient = false;
  let identityPhaseDiscard = false;
  let identityFailureMessage: string | null = null;

  try {
    await setIdentityStatementTimeout(client);
    try {
      if (input.testHooks?.simulatePgControlSystemDenied) {
        throw new TargetDbIdentityError(
          "TARGET_DB_IDENTITY_UNAVAILABLE",
          "Недостаточно прав для чтения идентификатора кластера (pg_control_system); проверьте роль приложения",
          { discardConnection: false },
        );
      }
      targetIdentity = await readTargetDbIdentityFromClient(client, input.databaseUrl, {
        testPreSleepSec: input.testHooks?.identityTestPreSleepSec,
        queryTimeoutMs: input.testHooks?.identityQueryTimeoutMs,
      });
    } catch (error) {
      identityPhaseDiscard = shouldDiscardPgClientAfterError(error);
      identityFailureMessage =
        error instanceof TargetDbIdentityError
          ? error.message
          : "Не удалось определить идентичность целевой БД на соединении apply";
    } finally {
      if (!identityPhaseDiscard) {
        try {
          await resetIdentityStatementTimeout(client);
        } catch {
          identityPhaseDiscard = true;
        }
      }
    }
    discardPooledClient = identityPhaseDiscard;
    if (identityFailureMessage || !targetIdentity) {
      return {
        ok: false,
        errorCode: "TARGET_DB_MISMATCH",
        message: identityFailureMessage ?? "Не удалось определить идентичность целевой БД на соединении apply",
      };
    }
    if (identityPhaseDiscard) {
      return {
        ok: false,
        errorCode: "TARGET_DB_MISMATCH",
        message:
          "Соединение с БД непригодно после проверки идентичности (ошибка RESET statement_timeout)",
      };
    }

    const dbMismatch = databaseNameMismatchBlocker(targetIdentity, input.databaseUrl);
    if (dbMismatch) {
      return { ok: false, errorCode: "TARGET_DB_MISMATCH", message: dbMismatch };
    }
    if (targetIdentity.fingerprint !== input.confirmTargetDbFingerprint) {
      return {
        ok: false,
        errorCode: "TARGET_DB_MISMATCH",
        message: "targetDbFingerprint не совпадает с фактическим соединением apply",
      };
    }

    await client.query("BEGIN");
    const locked = await tryAcquireImportLock(client);
    if (!locked) {
      if (await rollbackCleanStartTransaction(client, input.testHooks)) {
        discardPooledClient = true;
      }
      return { ok: false, errorCode: "IMPORT_LOCKED", message: "Не удалось захватить import lock" };
    }
    if (input.testHooks?.failAfter === "lock") {
      throw new Error("TEST_FAIL_AFTER_LOCK");
    }

    const jobBlocker = await assertNoConcurrentJobs(client);
    if (jobBlocker) {
      if (await rollbackCleanStartTransaction(client, input.testHooks)) {
        discardPooledClient = true;
      }
      return { ok: false, errorCode: "CONCURRENT_JOBS", message: jobBlocker };
    }

    const state = await client.query<{ legacy_clean_start_completed_at: string | null }>(
      `SELECT legacy_clean_start_completed_at FROM onec_v3_exchange_state WHERE id = 1 FOR UPDATE`,
    );
    if (state.rows[0]?.legacy_clean_start_completed_at && !input.forceCleanStart) {
      if (await rollbackCleanStartTransaction(client, input.testHooks)) {
        discardPooledClient = true;
      }
      return {
        ok: false,
        errorCode: "CLEAN_START_ALREADY_DONE",
        message: "Clean start уже выполнен; передайте --force-clean-start для повторного сброса",
      };
    }

    legacyRemoved = await purgeLegacyClientDomain(client);
    if (input.testHooks?.failAfter === "purge_legacy") {
      throw new Error("TEST_FAIL_AFTER_PURGE");
    }

    bitrixLabelsRevoked = await revokeLegacyBitrixClientLabels(client);
    if (input.testHooks?.failAfter === "bitrix") {
      throw new Error("TEST_FAIL_AFTER_BITRIX");
    }

    await purgeV3Domain(client);

    const applied = await applyExchangeV3BundleOnClient(client, input.bundle, {
      expectedFingerprint: input.confirmBundleFingerprint,
      skipDomainDelete: true,
      markCleanStart: true,
      cleanStartBundleFingerprint: input.bundle.bundleFingerprint,
    });
    if (!applied.ok) {
      if (await rollbackCleanStartTransaction(client, input.testHooks)) {
        discardPooledClient = true;
      }
      return applied;
    }
    if (input.testHooks?.failAfter === "apply") {
      throw new Error("TEST_FAIL_AFTER_APPLY");
    }

    commitAttempted = true;
    if (input.testHooks?.failCommit) {
      throw new Error("Simulated commit response loss.");
    }
    await client.query("COMMIT");
    if (input.testHooks?.simulateCommitTransportTimeout) {
      discardPooledClient = true;
      throw new Error("Query read timeout");
    }
    if (input.testHooks?.loseCommitAckAfterSuccessfulCommit) {
      throw new Error("Simulated commit response loss after successful COMMIT.");
    }
    commitConfirmed = true;

    applyReport = {
      mode: "apply",
      targetDb: targetIdentity,
      bundleFingerprint: input.bundle.bundleFingerprint,
      legacyRemoved,
      bitrixLabelsRevoked,
      loaded: applied.counts,
    };
    return { ok: true, report: applyReport };
  } catch (error) {
    primaryMessage = error instanceof Error ? error.message : String(error);
    if (shouldDiscardPgClientAfterError(error)) {
      discardPooledClient = true;
    }
    if (commitAttempted && !commitConfirmed) {
      return resolveCleanStartCommitUncertainty({
        databaseUrl: input.databaseUrl,
        bundleFingerprint: input.bundle.bundleFingerprint,
        confirmTargetDbFingerprint: input.confirmTargetDbFingerprint,
        pendingLegacyRemoved: legacyRemoved,
        pendingBitrixLabelsRevoked: bitrixLabelsRevoked,
      });
    }
    if (!commitAttempted && !discardPooledClient) {
      if (await rollbackCleanStartTransaction(client, input.testHooks)) {
        discardPooledClient = true;
      }
    }
    return {
      ok: false,
      errorCode: primaryErrorCode,
      message: primaryMessage,
    };
  } finally {
    if (!discardPooledClient) {
      if (await releaseCleanStartImportLock(client, input.testHooks)) {
        discardPooledClient = true;
      }
    }
    client.release(discardPooledClient);
  }
}

export function loadValidatedBundleFromBytes(bundle: {
  holdingsBytes: Buffer;
  clientsBytes: Buffer;
  retailBytes: Buffer;
  employeesBytes: Buffer;
}): { ok: true; bundle: V3ValidatedBundle } | { ok: false; errorCode: string; message: string } {
  return validateExchangeV3Bundle(bundle);
}
