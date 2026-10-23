import { Pool } from "pg";
import { createPgPoolOptions } from "../../../config/pg-ssl";
import { resolveTargetDbIdentityFromUrl } from "../../../onec-exchange-v3/target-db-identity";
import { parseLegalReturnItemsJsonBytes } from "../../parse-returne-items-json";
import { parseLegalReturnsJsonBytes } from "../../parse-returne-json";
import { parseLegalSaleItemsJsonBytes } from "../../parse-sale-items-json";
import { parseLegalSalesJsonBytes } from "../../parse-sale-json";
import { readSalesBundleFilesFromPaths } from "../../run-bundle-import";
import { buildMatchedOnlyBundlePlan } from "../plan-build";
import { backupSha256 } from "../backup";
import { readBackupFile } from "../backup";
import { validateBackupAgainstPlan } from "../guards";
import type { ExecutionManifestV2 } from "./manifest-types";
import { resolveProductionDatabaseUrl } from "./database-url";
import { assertMatchedOnlySchemaReady } from "./schema-readiness";
import { withReadOnlyPreflightSession, PREFLIGHT_CONNECT_TIMEOUT_MS } from "./read-only-session";
import { validateExecutionManifestForRun } from "./manifest-validate";
import { EXPECTED_PRODUCTION_DB_FINGERPRINT } from "./target-policy";
import { assertManifestCodeProvenance, resolveRuntimeCodeArtifactLabel } from "./runtime-provenance";

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
  backupProof?: {
    backupSha256: string;
    beforeStateSha256: string;
    planHash: string;
  };
};

export type ProductionPreflightResult =
  | ProductionPreflightProof
  | { ok: false; code: string; message: string };

function loadRostersFromManifest(manifest: ExecutionManifestV2) {
  return readSalesBundleFilesFromPaths(manifest.sourcePaths).then(async (files) => {
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
  });
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
  const runtime = resolveRuntimeCodeArtifactLabel();
  const provenanceCheck = assertManifestCodeProvenance(
    manifest.provenance.codeArtifactLabel,
    runtime,
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
    const schema = await withReadOnlyPreflightSession(pool, async (client) => {
      return assertMatchedOnlySchemaReady(client);
    });
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
        runtimeCodeArtifactLabel: runtime.ok ? runtime.label : null,
      };
    }

    const rosters = await loadRostersFromManifest(manifest);
    const built = await withReadOnlyPreflightSession(pool, async (client) => {
      return buildMatchedOnlyBundlePlan(client, {
        ...rosters,
        targetDbFingerprint: identity.fingerprint,
      });
    });
    if (built.planHash !== manifest.planHash) {
      return {
        ok: false,
        code: "MANIFEST_SOURCE_DRIFT",
        message: "Live source-derived plan hash does not match manifest.",
      };
    }

    let backupProof: ProductionPreflightProof["backupProof"];
    if (manifest.backup.filePath && manifest.backup.expectedSha256) {
      const backup = await readBackupFile(manifest.backup.filePath);
      const failure = validateBackupAgainstPlan(backup, manifest.plan!, manifest.backup.expectedSha256);
      if (failure) {
        return { ok: false, code: failure.code, message: failure.message };
      }
      backupProof = {
        backupSha256: backupSha256(backup),
        beforeStateSha256: backup.beforeStateSha256,
        planHash: manifest.planHash!,
      };
    } else if (options.operation === "apply" && options.writeMode) {
      return {
        ok: false,
        code: "BACKUP_PROOF_MISSING",
        message: "Write apply requires backup path and expected SHA in manifest.",
      };
    }

    return {
      ok: true,
      mode: "preflight",
      executionId: manifest.executionId,
      operation: options.operation,
      planHash: manifest.planHash!,
      liveDbFingerprint: identity.fingerprint,
      schemaReady: true,
      runtimeCodeArtifactLabel: runtime.ok ? runtime.label : null,
      backupProof,
    };
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
