import type { PoolClient } from "pg";
import { createImportPool } from "../../onec-clients/apply";
import { loadApplyRun } from "./apply-ops";
import { safeDisposeMatchedOnlySession } from "./connection-cleanup";
import { captureScopedAfterStateDigest } from "./state-digest";
import type { MatchedOnlyApplyReceiptV1, MatchedOnlyBundlePlanV1 } from "./types";

export function isCommitTransportUncertainty(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const record = error as { code?: string; message?: string };
  const code = record.code ?? "";
  if (code === "ETIMEDOUT" || code === "ECONNRESET" || code === "57P01") {
    return true;
  }
  const message = record.message?.toLowerCase() ?? "";
  return (
    message.includes("timeout") ||
    message.includes("connection terminated") ||
    message.includes("connection terminated unexpectedly")
  );
}

export async function reconcileAppliedPlanAfterCommitUncertainty(
  databaseUrl: string,
  plan: MatchedOnlyBundlePlanV1,
  approvedPlanHash: string,
  expectedReceipt: MatchedOnlyApplyReceiptV1,
): Promise<MatchedOnlyApplyReceiptV1 | null> {
  const pool = createImportPool(databaseUrl);
  let client: PoolClient | undefined;
  try {
    client = await pool.connect();
    const run = await loadApplyRun(client, approvedPlanHash);
    if (!run || run.status !== "applied" || !run.after_state_sha256) {
      return null;
    }
    const liveAfter = await captureScopedAfterStateDigest(client, plan.scope.saleMonthsIso);
    if (liveAfter !== run.after_state_sha256) {
      return null;
    }
    if (liveAfter !== expectedReceipt.afterStateSha256) {
      return null;
    }
    const receipt = run.receipt_json as MatchedOnlyApplyReceiptV1;
    return { ...receipt, status: "applied" };
  } catch {
    return null;
  } finally {
    if (client) {
      await safeDisposeMatchedOnlySession(client, pool, false);
    } else {
      try {
        await pool.end();
      } catch {
        /* ignore */
      }
    }
  }
}

export async function markCommitUncertain(
  client: PoolClient,
  plan: MatchedOnlyBundlePlanV1,
  approvedPlanHash: string,
  backupSha256: string,
): Promise<void> {
  await client.query(
    `
      INSERT INTO onec_v3_legal_sales_bundle_apply_runs (
        plan_hash, status, target_db_fingerprint, catalog_fingerprint,
        backup_sha256, before_state_sha256, after_state_sha256, receipt_json
      )
      VALUES ($1, 'commit_uncertain', $2, $3, $4, $5, NULL, $6::jsonb)
      ON CONFLICT (plan_hash) DO UPDATE SET
        status = CASE
          WHEN onec_v3_legal_sales_bundle_apply_runs.status = 'applied'
            AND onec_v3_legal_sales_bundle_apply_runs.after_state_sha256 IS NOT NULL
          THEN onec_v3_legal_sales_bundle_apply_runs.status
          ELSE 'commit_uncertain'
        END,
        receipt_json = CASE
          WHEN onec_v3_legal_sales_bundle_apply_runs.status = 'applied'
            AND onec_v3_legal_sales_bundle_apply_runs.after_state_sha256 IS NOT NULL
          THEN onec_v3_legal_sales_bundle_apply_runs.receipt_json
          ELSE EXCLUDED.receipt_json
        END
    `,
    [
      approvedPlanHash,
      plan.identity.targetDbFingerprint,
      plan.catalog.fingerprint,
      backupSha256,
      plan.beforeStateSha256,
      JSON.stringify({ v: 1, planHash: approvedPlanHash, status: "commit_uncertain" }),
    ],
  );
}

export async function tryMarkCommitUncertain(
  databaseUrl: string,
  plan: MatchedOnlyBundlePlanV1,
  approvedPlanHash: string,
  backupSha256: string,
): Promise<void> {
  const pool = createImportPool(databaseUrl);
  let client: PoolClient | undefined;
  try {
    client = await pool.connect();
    await client.query("BEGIN");
    await markCommitUncertain(client, plan, approvedPlanHash, backupSha256);
    await client.query("COMMIT");
  } catch {
    /* Marker is best-effort when recovery connection is unavailable. */
  } finally {
    if (client) {
      await safeDisposeMatchedOnlySession(client, pool, false);
    } else {
      try {
        await pool.end();
      } catch {
        /* ignore */
      }
    }
  }
}

export type CommitUncertaintyResolution =
  | { kind: "reconciled"; receipt: MatchedOnlyApplyReceiptV1 }
  | { kind: "uncertain" };

export async function resolveCommitTransportUncertainty(
  databaseUrl: string,
  plan: MatchedOnlyBundlePlanV1,
  approvedPlanHash: string,
  receipt: MatchedOnlyApplyReceiptV1,
  expectedBackupSha256: string,
): Promise<CommitUncertaintyResolution> {
  const reconciled = await reconcileAppliedPlanAfterCommitUncertainty(
    databaseUrl,
    plan,
    approvedPlanHash,
    receipt,
  );
  if (reconciled) {
    return { kind: "reconciled", receipt: reconciled };
  }
  await tryMarkCommitUncertain(databaseUrl, plan, approvedPlanHash, expectedBackupSha256);
  return { kind: "uncertain" };
}
