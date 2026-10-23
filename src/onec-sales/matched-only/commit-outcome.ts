import type { PoolClient } from "pg";
import { createImportPool } from "../../onec-clients/apply";
import { loadApplyRun } from "./apply-ops";
import { captureScopedAfterStateDigest } from "./state-digest";
import type { MatchedOnlyApplyReceiptV1, MatchedOnlyBundlePlanV1 } from "./types";

export function isCommitTransportUncertainty(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const record = error as { code?: string; message?: string };
  const code = record.code ?? "";
  if (code === "ETIMEDOUT" || code === "ECONNRESET" || code === "ECONNREFUSED" || code === "57P01") {
    return true;
  }
  const message = record.message?.toLowerCase() ?? "";
  return message.includes("timeout") || message.includes("connection terminated");
}

export async function reconcileAppliedPlanAfterCommitUncertainty(
  databaseUrl: string,
  plan: MatchedOnlyBundlePlanV1,
  approvedPlanHash: string,
  expectedReceipt: MatchedOnlyApplyReceiptV1,
): Promise<MatchedOnlyApplyReceiptV1 | null> {
  const pool = createImportPool(databaseUrl);
  const client = await pool.connect();
  try {
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
  } finally {
    client.release();
    await pool.end();
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
