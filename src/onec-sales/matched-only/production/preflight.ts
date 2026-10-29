import { Pool } from "pg";
import { createPgPoolOptions } from "../../../config/pg-ssl";
import { resolveTargetDbIdentityFromUrl } from "../../../onec-exchange-v3/target-db-identity";
import { parseLegalReturnItemsJsonBytes } from "../../parse-returne-items-json";
import { parseLegalReturnsJsonBytes } from "../../parse-returne-json";
import { parseLegalSaleItemsJsonBytes } from "../../parse-sale-items-json";
import { parseLegalSalesJsonBytes } from "../../parse-sale-json";
import { readSalesBundleFilesFromPaths } from "../../run-bundle-import";
import { loadApplyRun } from "../apply-ops";
import { buildMatchedOnlyBundlePlan } from "../plan-build";
import { backupSha256 } from "../backup";
import { readBackupFile } from "../backup";
import { validateBackupAgainstPlan } from "../guards";
import { captureScopedAfterStateDigest } from "../state-digest";
import type { ExecutionManifestV2 } from "./manifest-types";
import { resolveProductionDatabaseUrl } from "./database-url";
import { assertMatchedOnlySchemaReady } from "./schema-readiness";
import { withReadOnlyPreflightSession, PREFLIGHT_CONNECT_TIMEOUT_MS } from "./read-only-session";
import { validateExecutionManifestForRun } from "./manifest-validate";
import { validateExecutionBudgetAgainstSource } from "./manifest-budget";
import { loadKnownLegalGuidSet } from "../catalog";
import { EXPECTED_PRODUCTION_DB_FINGERPRINT } from "./target-policy";
import { assertManifestCodeProvenance } from "./runtime-provenance";

export type ProductionPreflightOptions = {
  manifest: ExecutionManifestV2;
  operation: "apply" | "rollback";
  approvedExecutionHash?: string;
  writeMode: boolean;
  /** Test harness only — never set from public production CLI. */
  targetFingerprintPolicy?: string;
};

export type ProductionPreflightProof = {
  ok: true;
  mode: "preflight";
  executionId: string;
  operation: "apply" | "rollback";
  planHash: string;
  liveDbFingerprint: string;
  schemaReady: boolean;
  runtimeCodeArtifactLabel: string | null;
  phase: "template" | "fresh_apply" | "already_applied" | "rollback_ready";
  backupProof?: {
    backupSha256: string;
    beforeStateSha256: string;
    planHash: string;
  };
};

export type ProductionPreflightResult =
  | ProductionPreflightProof
  | { ok: false; code: string; message: string };

async function loadRostersFromManifest(manifest: ExecutionManifestV2) {
  const files = await readSalesBundleFilesFromPaths(manifest.sourcePaths);
  const saleAggregate = parseLegalSalesJsonBytes(files.saleAggregate!);
  const saleItems = parseLegalSaleItemsJsonBytes(files.saleItems!);
  const returnsAggregate = parseLegalReturnsJsonBytes(files.returnsAggregate!);
  const returnItems = parseLegalReturnItemsJsonBytes(files.returnItems!);
  if (!saleAggregate.ok) throw new Error(saleAggregate.message);
  if (!saleItems.ok) throw new Error(saleItems.message);
  if (!returnsAggregate.ok) throw new Error(returnsAggregate.message);
  if (!returnItems.ok) throw new Error(returnItems.message);
  return {
    saleAggregate: saleAggregate.roster,
    saleItems: saleItems.roster,
    returnsAggregate: returnsAggregate.roster,
    returnItems: returnItems.roster,
  };
}

export async function runProductionPreflight(
  options: ProductionPreflightOptions,
): Promise<ProductionPreflightResult> {
  const urlResult = resolveProductionDatabaseUrl();
  if (!urlResult.ok) {
    return { ok: false, code: urlResult.code, message: urlResult.message };
  }
  const allowMissingPlan =
    !options.writeMode && options.manifest.approval.status === "NOT_APPROVED";
  const manifestCheck = validateExecutionManifestForRun({
    manifest: options.manifest,
    operation: options.operation,
    approvedExecutionHash: options.approvedExecutionHash,
    requireApproved: options.writeMode,
    allowMissingPlan,
  });
  if (!manifestCheck.ok) {
    return { ok: false, code: manifestCheck.code, message: manifestCheck.message };
  }
  const manifest = manifestCheck.manifest;
  const provenanceCheck = await assertManifestCodeProvenance(
    manifest.provenance.codeArtifactLabel,
    manifest.provenance.expectedExecutableArtifactSha256,
    options.writeMode,
  );
  if (!provenanceCheck.ok) {
    return { ok: false, code: provenanceCheck.code, message: provenanceCheck.message };
  }

  const identity = await resolveTargetDbIdentityFromUrl(urlResult.databaseUrl);
  const expectedFingerprint = options.targetFingerprintPolicy ?? EXPECTED_PRODUCTION_DB_FINGERPRINT;
  if (identity.fingerprint !== expectedFingerprint) {
    return {
      ok: false,
      code: "TARGET_IDENTITY_POLICY_MISMATCH",
      message: "Live database fingerprint does not match pinned production policy.",
    };
  }
  if (
    manifest.plan &&
    identity.fingerprint !== manifest.plan.identity.targetDbFingerprint
  ) {
    return {
      ok: false,
      code: "MANIFEST_TARGET_LIVE_MISMATCH",
      message: "Manifest plan target fingerprint does not match live database.",
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
    return await withReadOnlyPreflightSession(pool, async (client) => {
      const schema = await assertMatchedOnlySchemaReady(client);
      if (!schema.ok) {
        return { ok: false, code: schema.code, message: schema.message };
      }

      if (!manifest.plan || !manifest.planHash) {
        return {
          ok: true,
          mode: "preflight",
          executionId: manifest.executionId,
          operation: options.operation,
          planHash: "",
          liveDbFingerprint: identity.fingerprint,
          schemaReady: true,
          runtimeCodeArtifactLabel: manifest.provenance.codeArtifactLabel,
          phase: "template",
        };
      }

      let backupProof: ProductionPreflightProof["backupProof"];
      if (manifest.backup.filePath && manifest.backup.expectedSha256) {
        const backup = await readBackupFile(manifest.backup.filePath);
        const failure = validateBackupAgainstPlan(backup, manifest.plan, manifest.backup.expectedSha256);
        if (failure) {
          return { ok: false, code: failure.code, message: failure.message };
        }
        backupProof = {
          backupSha256: backupSha256(backup),
          beforeStateSha256: backup.beforeStateSha256,
          planHash: manifest.planHash,
        };
      } else if (options.writeMode || options.operation === "rollback") {
        return {
          ok: false,
          code: "BACKUP_PROOF_MISSING",
          message: "Backup path and expected SHA are required.",
        };
      }

      if (options.operation === "rollback") {
        const rollback = manifest.rollback;
        if (
          !rollback?.originalApplyPlanHash ||
          !rollback.expectedLiveAfterStateSha256 ||
          !rollback.rollbackScopeHash
        ) {
          return {
            ok: false,
            code: "ROLLBACK_MANIFEST_INCOMPLETE",
            message: "Rollback manifest requires original apply receipt binding fields.",
          };
        }
        if (rollback.originalApplyPlanHash !== manifest.planHash) {
          return {
            ok: false,
            code: "ROLLBACK_PLAN_HASH_MISMATCH",
            message: "Rollback originalApplyPlanHash mismatch.",
          };
        }
        if (rollback.rollbackScopeHash !== manifest.plan.scope.operationsDigest) {
          return {
            ok: false,
            code: "ROLLBACK_SCOPE_MISMATCH",
            message: "Rollback scope hash mismatch.",
          };
        }
        const liveAfter = await captureScopedAfterStateDigest(client, manifest.plan.scope.saleMonthsIso);
        if (liveAfter !== rollback.expectedLiveAfterStateSha256) {
          return {
            ok: false,
            code: "ROLLBACK_AFTER_STATE_MISMATCH",
            message: "Live after-state does not match rollback manifest.",
          };
        }
        return {
          ok: true,
          mode: "preflight",
          executionId: manifest.executionId,
          operation: options.operation,
          planHash: manifest.planHash,
          liveDbFingerprint: identity.fingerprint,
          schemaReady: true,
          runtimeCodeArtifactLabel: manifest.provenance.codeArtifactLabel,
          phase: "rollback_ready",
          backupProof,
        };
      }

      const existing = await loadApplyRun(client, manifest.planHash);
      if (existing?.status === "applied" && existing.after_state_sha256) {
        const liveAfter = await captureScopedAfterStateDigest(client, manifest.plan.scope.saleMonthsIso);
        if (liveAfter === existing.after_state_sha256) {
          return {
            ok: true,
            mode: "preflight",
            executionId: manifest.executionId,
            operation: options.operation,
            planHash: manifest.planHash,
            liveDbFingerprint: identity.fingerprint,
            schemaReady: true,
            runtimeCodeArtifactLabel: manifest.provenance.codeArtifactLabel,
            phase: "already_applied",
            backupProof,
          };
        }
        return {
          ok: false,
          code: "APPLY_DRIFT",
          message: "Applied plan receipt does not match live scoped state.",
        };
      }

      const rosters = await loadRostersFromManifest(manifest);
      if (manifest.executionBudget) {
        const known = await loadKnownLegalGuidSet(client);
        const budgetCheck = validateExecutionBudgetAgainstSource(
          manifest.plan!,
          manifest.executionBudget,
          rosters,
          known,
        );
        if (!budgetCheck.ok) {
          return { ok: false, code: budgetCheck.code, message: budgetCheck.message };
        }
      }
      const built = await buildMatchedOnlyBundlePlan(client, {
        ...rosters,
        targetDbFingerprint: identity.fingerprint,
      });
      if (built.planHash !== manifest.planHash) {
        return {
          ok: false,
          code: "MANIFEST_SOURCE_DRIFT",
          message: "Live source-derived plan hash does not match manifest.",
        };
      }

      return {
        ok: true,
        mode: "preflight",
        executionId: manifest.executionId,
        operation: options.operation,
        planHash: manifest.planHash,
        liveDbFingerprint: identity.fingerprint,
        schemaReady: true,
        runtimeCodeArtifactLabel: manifest.provenance.codeArtifactLabel,
        phase: "fresh_apply",
        backupProof,
      };
    });
  } catch (error) {
    return {
      ok: false,
      code: "PREFLIGHT_FAILED",
      message: error instanceof Error ? error.message : "Preflight failed.",
    };
  } finally {
    await pool.end();
  }
}
