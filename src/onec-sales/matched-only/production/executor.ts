import { readFile } from "node:fs/promises";
import { executeMatchedOnlyApply, executeMatchedOnlyRollback } from "../apply-pipeline";
import { issueProductionExecutionCapability } from "../execution-capability";
import type { MatchedOnlyScopedBackupV1 } from "../types";
import type { ExecutionManifestV2 } from "./manifest-types";
import { runProductionPreflight } from "./preflight";
import { resolveProductionDatabaseUrl } from "./database-url";
import type { ProductionApplyWriteBinding, ProductionRollbackWriteBinding } from "./apply-write-guard";
import { mintProductionWriteGrant } from "./production-verified-write";

export type ProductionExecutorHarnessOptions = {
  /** Test harness only — never set from public production CLI. */
  targetFingerprintPolicy?: string;
};

export type ProductionWriteResult =
  | { ok: true; mode: "write-apply" | "write-rollback"; planHash: string; receipt?: unknown }
  | { ok: false; code: string; message: string };

async function loadRostersFromManifest(manifest: ExecutionManifestV2) {
  const { readSalesBundleFilesFromPaths } = await import("../../run-bundle-import");
  const { parseLegalSalesJsonBytes } = await import("../../parse-sale-json");
  const { parseLegalSaleItemsJsonBytes } = await import("../../parse-sale-items-json");
  const { parseLegalReturnsJsonBytes } = await import("../../parse-returne-json");
  const { parseLegalReturnItemsJsonBytes } = await import("../../parse-returne-items-json");
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

function productionApplyBinding(manifest: ExecutionManifestV2): ProductionApplyWriteBinding | null {
  if (
    !manifest.executionBudget ||
    !manifest.provenance.codeArtifactLabel ||
    !manifest.provenance.expectedExecutableArtifactSha256 ||
    !manifest.approval.validUntil
  ) {
    return null;
  }
  if (!manifest.backup.expectedSha256) {
    return null;
  }
  return {
    manifestContentHash: manifest.contentHash,
    codeArtifactLabel: manifest.provenance.codeArtifactLabel,
    expectedExecutableArtifactSha256: manifest.provenance.expectedExecutableArtifactSha256,
    approvalValidUntil: manifest.approval.validUntil,
    executionBudget: manifest.executionBudget,
    expectedBackupSha256: manifest.backup.expectedSha256,
  };
}

function productionRollbackBinding(manifest: ExecutionManifestV2): ProductionRollbackWriteBinding | null {
  const rollback = manifest.rollback;
  if (
    !manifest.provenance.codeArtifactLabel ||
    !manifest.provenance.expectedExecutableArtifactSha256 ||
    !manifest.approval.validUntil ||
    !manifest.backup.expectedSha256 ||
    !rollback?.originalApplyPlanHash ||
    !rollback.expectedLiveAfterStateSha256 ||
    !rollback.rollbackScopeHash
  ) {
    return null;
  }
  return {
    manifestContentHash: manifest.contentHash,
    codeArtifactLabel: manifest.provenance.codeArtifactLabel,
    expectedExecutableArtifactSha256: manifest.provenance.expectedExecutableArtifactSha256,
    approvalValidUntil: manifest.approval.validUntil,
    expectedBackupSha256: manifest.backup.expectedSha256,
    originalApplyPlanHash: rollback.originalApplyPlanHash,
    expectedLiveAfterStateSha256: rollback.expectedLiveAfterStateSha256,
    rollbackScopeHash: rollback.rollbackScopeHash,
  };
}

export async function runProductionWriteApply(
  input: {
    manifest: ExecutionManifestV2;
    approvedExecutionHash: string;
  } & ProductionExecutorHarnessOptions,
): Promise<ProductionWriteResult> {
  const preflight = await runProductionPreflight({
    manifest: input.manifest,
    operation: "apply",
    approvedExecutionHash: input.approvedExecutionHash,
    writeMode: true,
    targetFingerprintPolicy: input.targetFingerprintPolicy,
  });
  if (!preflight.ok) {
    return { ok: false, code: preflight.code, message: preflight.message };
  }
  const urlResult = resolveProductionDatabaseUrl();
  if (!urlResult.ok) {
    return { ok: false, code: urlResult.code, message: urlResult.message };
  }
  const manifest = input.manifest;
  if (!manifest.plan || !manifest.planHash || !manifest.backup.filePath || !manifest.backup.expectedSha256) {
    return { ok: false, code: "MANIFEST_INCOMPLETE", message: "Manifest missing plan or backup proof." };
  }
  const backup = JSON.parse(
    await readFile(manifest.backup.filePath, "utf8"),
  ) as MatchedOnlyScopedBackupV1;
  const rosters = await loadRostersFromManifest(manifest);
  const binding = productionApplyBinding(manifest);
  if (!binding) {
    return { ok: false, code: "PRODUCTION_BINDING_INCOMPLETE", message: "Manifest missing execution budget or provenance." };
  }
  const grant = await mintProductionWriteGrant({
    manifest,
    operation: "apply",
    approvedExecutionHash: input.approvedExecutionHash,
    applyBinding: binding,
  });
  if (!grant.ok) {
    return { ok: false, code: grant.code, message: grant.message };
  }
  const result = await executeMatchedOnlyApply(
    issueProductionExecutionCapability(urlResult.databaseUrl),
    urlResult.databaseUrl,
    rosters,
    manifest.plan,
    manifest.planHash,
    backup,
    manifest.backup.expectedSha256,
    undefined,
    binding,
    grant.grantId,
  );
  if (!result.ok) {
    return { ok: false, code: result.code, message: result.message };
  }
  return {
    ok: true,
    mode: "write-apply",
    planHash: manifest.planHash,
    receipt: result.receipt,
  };
}

export async function runProductionWriteRollback(
  input: {
    manifest: ExecutionManifestV2;
    approvedExecutionHash: string;
  } & ProductionExecutorHarnessOptions,
): Promise<ProductionWriteResult> {
  const preflight = await runProductionPreflight({
    manifest: input.manifest,
    operation: "rollback",
    approvedExecutionHash: input.approvedExecutionHash,
    writeMode: true,
    targetFingerprintPolicy: input.targetFingerprintPolicy,
  });
  if (!preflight.ok) {
    return { ok: false, code: preflight.code, message: preflight.message };
  }
  const urlResult = resolveProductionDatabaseUrl();
  if (!urlResult.ok) {
    return { ok: false, code: urlResult.code, message: urlResult.message };
  }
  const manifest = input.manifest;
  if (!manifest.plan || !manifest.planHash || !manifest.backup.filePath || !manifest.backup.expectedSha256) {
    return { ok: false, code: "MANIFEST_INCOMPLETE", message: "Manifest missing plan or backup proof." };
  }
  const backup = JSON.parse(
    await readFile(manifest.backup.filePath, "utf8"),
  ) as MatchedOnlyScopedBackupV1;
  const rollbackBinding = productionRollbackBinding(manifest);
  if (!rollbackBinding) {
    return { ok: false, code: "PRODUCTION_BINDING_INCOMPLETE", message: "Manifest missing rollback binding fields." };
  }
  const grant = await mintProductionWriteGrant({
    manifest,
    operation: "rollback",
    approvedExecutionHash: input.approvedExecutionHash,
    rollbackBinding,
  });
  if (!grant.ok) {
    return { ok: false, code: grant.code, message: grant.message };
  }
  const result = await executeMatchedOnlyRollback(
    issueProductionExecutionCapability(urlResult.databaseUrl),
    urlResult.databaseUrl,
    manifest.plan,
    manifest.planHash,
    backup,
    manifest.backup.expectedSha256,
    rollbackBinding,
    grant.grantId,
  );
  if (!result.ok) {
    return { ok: false, code: result.code, message: result.message };
  }
  return { ok: true, mode: "write-rollback", planHash: manifest.planHash };
}
