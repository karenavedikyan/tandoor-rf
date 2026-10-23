import { readFile } from "node:fs/promises";
import { executeMatchedOnlyApply, executeMatchedOnlyRollback } from "../apply-pipeline";
import type { MatchedOnlyScopedBackupV1 } from "../types";
import type { ExecutionManifestV2 } from "./manifest-types";
import { runProductionPreflight } from "./preflight";
import { resolveProductionDatabaseUrl } from "./database-url";

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

export async function runProductionWriteApply(input: {
  manifest: ExecutionManifestV2;
  approvedExecutionHash: string;
}): Promise<ProductionWriteResult> {
  const preflight = await runProductionPreflight({
    manifest: input.manifest,
    operation: "apply",
    approvedExecutionHash: input.approvedExecutionHash,
    writeMode: true,
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
  const result = await executeMatchedOnlyApply(
    urlResult.databaseUrl,
    rosters,
    manifest.plan,
    manifest.planHash,
    backup,
    manifest.backup.expectedSha256,
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

export async function runProductionWriteRollback(input: {
  manifest: ExecutionManifestV2;
  approvedExecutionHash: string;
}): Promise<ProductionWriteResult> {
  const preflight = await runProductionPreflight({
    manifest: input.manifest,
    operation: "rollback",
    approvedExecutionHash: input.approvedExecutionHash,
    writeMode: true,
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
  const result = await executeMatchedOnlyRollback(
    urlResult.databaseUrl,
    manifest.plan,
    manifest.planHash,
    backup,
    manifest.backup.expectedSha256,
  );
  if (!result.ok) {
    return { ok: false, code: result.code, message: result.message };
  }
  return { ok: true, mode: "write-rollback", planHash: manifest.planHash };
}
