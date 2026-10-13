import type { PoolClient } from "pg";
import { tryAcquireImportLock, releaseImportLock } from "../onec-clients/import-lock";
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
  readTargetDbIdentityFromClient,
  resolveTargetDbIdentityFromUrl,
  type TargetDbIdentity,
} from "./target-db-identity";

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
  legacyRemoved: Awaited<ReturnType<typeof purgeLegacyClientDomain>>;
  bitrixLabelsRevoked: number;
  loaded: { holdings: number; legalEntities: number; retailOutlets: number; employees: number };
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

async function resolveCommitUncertainty(input: {
  databaseUrl: string;
  bundleFingerprint: string;
  confirmTargetDbFingerprint: string;
}): Promise<
  | { ok: true; report: CleanStartApplyReport }
  | { ok: false; errorCode: "COMMIT_UNCERTAIN"; message: string; report: CleanStartCommitUncertainReport }
> {
  const observed = await observeCleanStartState(input.databaseUrl);
  const fallbackIdentity = await resolveTargetDbIdentityFromUrl(input.databaseUrl).catch(() => null);
  const targetDb: TargetDbIdentity =
    observed?.targetDb ?? fallbackIdentity ?? {
      host: "",
      port: "",
      database: parseTargetDbDescriptor(input.databaseUrl)?.database ?? "",
      fingerprint: input.confirmTargetDbFingerprint,
      systemIdentifier: "",
      serverHost: "",
      serverPort: "",
      urlHost: "",
      urlPort: "",
    };

  if (
    observed?.legacyCleanStartCompletedAt &&
    observed.legacyCleanStartBundleFingerprint === input.bundleFingerprint &&
    observed.v3HoldingsCount > 0
  ) {
    return {
      ok: true,
      report: {
        mode: "apply",
        targetDb,
        bundleFingerprint: input.bundleFingerprint,
        legacyRemoved: {
          onecClients: 0,
          onecRetailOutlets: 0,
          accessGrantsClient: 0,
          clientReviewRecords: 0,
          holdingV2LegalLinks: 0,
          importJobs: 0,
          accessGrantsRemoved: 0,
        },
        bitrixLabelsRevoked: 0,
        loaded: {
          holdings: observed.v3HoldingsCount,
          legalEntities: observed.v3LegalCount,
          retailOutlets: observed.v3RetailCount,
          employees: observed.v3EmployeeRosterCount,
        },
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
  let targetIdentity: TargetDbIdentity;
  try {
    targetIdentity = await resolveTargetDbIdentityFromUrl(input.databaseUrl);
  } catch {
    return { ok: false, errorCode: "TARGET_DB_MISMATCH", message: "Не удалось определить идентичность целевой БД" };
  }
  const dbMismatch = databaseNameMismatchBlocker(targetIdentity, input.databaseUrl);
  if (dbMismatch) {
    return { ok: false, errorCode: "TARGET_DB_MISMATCH", message: dbMismatch };
  }
  if (targetIdentity.fingerprint !== input.confirmTargetDbFingerprint) {
    return { ok: false, errorCode: "TARGET_DB_MISMATCH", message: "targetDbFingerprint не совпадает с подключением" };
  }
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

  try {
    await client.query("BEGIN");
    const locked = await tryAcquireImportLock(client);
    if (!locked) {
      await client.query("ROLLBACK");
      return { ok: false, errorCode: "IMPORT_LOCKED", message: "Не удалось захватить import lock" };
    }
    if (input.testHooks?.failAfter === "lock") {
      throw new Error("TEST_FAIL_AFTER_LOCK");
    }

    const jobBlocker = await assertNoConcurrentJobs(client);
    if (jobBlocker) {
      await client.query("ROLLBACK");
      return { ok: false, errorCode: "CONCURRENT_JOBS", message: jobBlocker };
    }

    const state = await client.query<{ legacy_clean_start_completed_at: string | null }>(
      `SELECT legacy_clean_start_completed_at FROM onec_v3_exchange_state WHERE id = 1 FOR UPDATE`,
    );
    if (state.rows[0]?.legacy_clean_start_completed_at && !input.forceCleanStart) {
      await client.query("ROLLBACK");
      return {
        ok: false,
        errorCode: "CLEAN_START_ALREADY_DONE",
        message: "Clean start уже выполнен; передайте --force-clean-start для повторного сброса",
      };
    }

    const legacyRemoved = await purgeLegacyClientDomain(client);
    if (input.testHooks?.failAfter === "purge_legacy") {
      throw new Error("TEST_FAIL_AFTER_PURGE");
    }

    const bitrixLabelsRevoked = await revokeLegacyBitrixClientLabels(client);
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
      await client.query("ROLLBACK");
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
    if (commitAttempted && !commitConfirmed) {
      return resolveCommitUncertainty({
        databaseUrl: input.databaseUrl,
        bundleFingerprint: input.bundle.bundleFingerprint,
        confirmTargetDbFingerprint: input.confirmTargetDbFingerprint,
      });
    }
    if (!commitAttempted) {
      try {
        await client.query("ROLLBACK");
      } catch {
        primaryErrorCode = "CLEAN_START_FAILED";
        primaryMessage =
          "Clean start failed; откат транзакции не подтверждён — проверьте состояние БД новым подключением.";
      }
    }
    return {
      ok: false,
      errorCode: primaryErrorCode,
      message: primaryMessage,
    };
  } finally {
    try {
      await releaseImportLock(client);
    } catch {
      // Lock release must not mask apply outcome.
    }
    client.release();
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
