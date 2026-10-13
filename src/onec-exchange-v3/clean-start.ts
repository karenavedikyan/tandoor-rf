import type { PoolClient } from "pg";
import { tryAcquireImportLock, releaseImportLock } from "../onec-clients/import-lock";
import { requirePool } from "../db/pool";
import { validateExchangeV3Bundle } from "./validate-bundle";
import type { V3ValidatedBundle } from "./types";
import { countLegacyClientScope, purgeLegacyClientDomain } from "./legacy-client-purge";
import { revokeLegacyBitrixClientLabels, purgeV3Domain } from "./clean-start-purge";
import { applyExchangeV3BundleOnClient } from "./apply";
import {
  computeTargetDbFingerprint,
  parseTargetDbDescriptor,
  type TargetDbDescriptor,
} from "./target-db-fingerprint";

export type CleanStartDryRunReport = {
  mode: "dry_run";
  targetDb: TargetDbDescriptor & { fingerprint: string };
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
  targetDb: TargetDbDescriptor & { fingerprint: string };
  bundleFingerprint: string;
  legacyRemoved: Awaited<ReturnType<typeof purgeLegacyClientDomain>>;
  bitrixLabelsRevoked: number;
  loaded: { holdings: number; legalEntities: number; retailOutlets: number; employees: number };
};

export type CleanStartTestHooks = {
  failAfter?: "lock" | "purge_legacy" | "bitrix" | "apply";
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
  const fingerprint = computeTargetDbFingerprint(databaseUrl) ?? "";
  const desc = parseTargetDbDescriptor(databaseUrl);
  const parsed = {
    host: desc?.host ?? "",
    port: desc?.port ?? "",
    database: desc?.database ?? "",
    fingerprint,
  };

  const wouldRemove = await countLegacyClientScope(client);
  const preserved = await countPreserved(client);
  const blockers: string[] = [];
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
    targetDb: parsed,
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

export async function runExchangeV3CleanStartApply(input: {
  databaseUrl: string;
  bundle: V3ValidatedBundle;
  confirmTargetDbFingerprint: string;
  confirmBundleFingerprint: string;
  forceCleanStart?: boolean;
  testHooks?: CleanStartTestHooks;
}): Promise<
  | { ok: true; report: CleanStartApplyReport }
  | { ok: false; errorCode: string; message: string; report?: Partial<CleanStartApplyReport> }
> {
  const targetFp = computeTargetDbFingerprint(input.databaseUrl);
  if (!targetFp || targetFp !== input.confirmTargetDbFingerprint) {
    return { ok: false, errorCode: "TARGET_DB_MISMATCH", message: "targetDbFingerprint не совпадает" };
  }
  if (input.confirmBundleFingerprint !== input.bundle.bundleFingerprint) {
    return { ok: false, errorCode: "BUNDLE_FINGERPRINT_MISMATCH", message: "bundleFingerprint не совпадает" };
  }

  const pool = requirePool();
  const client = await pool.connect();
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

    await client.query("COMMIT");

    const desc = parseTargetDbDescriptor(input.databaseUrl);
    return {
      ok: true,
      report: {
        mode: "apply",
        targetDb: {
          host: desc?.host ?? "",
          port: desc?.port ?? "",
          database: desc?.database ?? "",
          fingerprint: targetFp,
        },
        bundleFingerprint: input.bundle.bundleFingerprint,
        legacyRemoved,
        bitrixLabelsRevoked,
        loaded: applied.counts,
      },
    };
  } catch (error) {
    await client.query("ROLLBACK");
    return {
      ok: false,
      errorCode: "CLEAN_START_FAILED",
      message: error instanceof Error ? error.message : String(error),
    };
  } finally {
    await releaseImportLock(client);
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
