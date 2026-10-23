import { tryAcquireImportLock } from "../../onec-clients/import-lock";
import { createImportPool } from "../../onec-clients/apply";
import {
  applyMatchedOnlyReturnItems,
  applyMatchedOnlyReturnsAggregate,
  applyMatchedOnlySaleAggregate,
  applyMatchedOnlySaleItems,
} from "../matched-only/apply-ops";
import { loadKnownLegalGuidSet } from "../matched-only/catalog";
import { partitionSalesBundle } from "../matched-only/partition";
import type { MatchedOnlyBundleInput } from "../matched-only/guards";
import { verifyMatchedMaterializedRows } from "../matched-only/apply-persist-materialization";
import { assertLiveTargetMatchesPlan } from "../matched-only/guards";
import { runMatchedOnlyBundlePlan } from "../matched-only/run";
import { assertExternalWriteAuthorization } from "./operator-guard";
import { verifySeptember047048Metadata } from "./verify-047-048-metadata";
import { EXPECTED_SOURCE_FILES } from "./scope-pins";
import { verifySourceFilePin } from "./source-pins";
import { issueTestExecutionCapability } from "../matched-only/execution-capability";

const SIDECAR = { sidecar049: false };

export async function executeSeptember2026Apply(input: {
  databaseUrl: string;
  localSourcePaths: Record<keyof typeof EXPECTED_SOURCE_FILES, string>;
  externalAuthorizationRef: string;
}): Promise<{ ok: true; receipt: Record<string, unknown> } | { ok: false; code: string; message: string }> {
  const auth = assertExternalWriteAuthorization();
  if (!auth.ok) return auth;
  if (auth.ref !== input.externalAuthorizationRef) {
    return { ok: false, code: "EXTERNAL_AUTHORIZATION_MISMATCH", message: "Authorization ref mismatch." };
  }
  for (const key of Object.keys(EXPECTED_SOURCE_FILES) as (keyof typeof EXPECTED_SOURCE_FILES)[]) {
    const pin = await verifySourceFilePin(key, input.localSourcePaths[key]);
    if (!pin.ok) return pin;
  }
  const { readSalesBundleFilesFromPaths } = await import("../run-bundle-import");
  const { parseLegalSalesJsonBytes } = await import("../parse-sale-json");
  const { parseLegalSaleItemsJsonBytes } = await import("../parse-sale-items-json");
  const { parseLegalReturnsJsonBytes } = await import("../parse-returne-json");
  const { parseLegalReturnItemsJsonBytes } = await import("../parse-returne-items-json");
  const files = await readSalesBundleFilesFromPaths(input.localSourcePaths);
  const saleAggregate = parseLegalSalesJsonBytes(files.saleAggregate!);
  const saleItems = parseLegalSaleItemsJsonBytes(files.saleItems!);
  const returnsAggregate = parseLegalReturnsJsonBytes(files.returnsAggregate!);
  const returnItems = parseLegalReturnItemsJsonBytes(files.returnItems!);
  if (!saleAggregate.ok || !saleAggregate.roster) {
    return { ok: false, code: "SOURCE_PARSE_FAILED", message: "sale.json parse failed." };
  }
  if (!saleItems.ok || !saleItems.roster) {
    return { ok: false, code: "SOURCE_PARSE_FAILED", message: "sale(items).json parse failed." };
  }
  if (!returnsAggregate.ok || !returnsAggregate.roster) {
    return { ok: false, code: "SOURCE_PARSE_FAILED", message: "returne.json parse failed." };
  }
  if (!returnItems.ok || !returnItems.roster) {
    return { ok: false, code: "SOURCE_PARSE_FAILED", message: "returne(items).json parse failed." };
  }
  const rosters: MatchedOnlyBundleInput = {
    saleAggregate: saleAggregate.roster,
    saleItems: saleItems.roster,
    returnsAggregate: returnsAggregate.roster,
    returnItems: returnItems.roster,
  };
  const planned = await runMatchedOnlyBundlePlan(input.databaseUrl, rosters);
  if (!planned.ok) {
    return { ok: false, code: planned.code, message: planned.message };
  }
  if (!planned.plan || !planned.planHash) {
    return { ok: false, code: "PLAN_INCOMPLETE", message: "Plan missing after successful plan step." };
  }
  const plan = planned.plan;
  const planHash = planned.planHash!;
  try {
    await assertLiveTargetMatchesPlan(input.databaseUrl, plan);
  } catch (e) {
    return { ok: false, code: "TARGET_MISMATCH", message: e instanceof Error ? e.message : "Target mismatch" };
  }
  const pool = createImportPool(input.databaseUrl);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const locked = await tryAcquireImportLock(client);
    if (!locked) {
      await client.query("ROLLBACK");
      return { ok: false, code: "IMPORT_LOCK_BUSY", message: "Import lock busy." };
    }
    const known = await loadKnownLegalGuidSet(client);
    const partition = partitionSalesBundle({ ...rosters, known });
    const sidecarOpts = SIDECAR;
    await applyMatchedOnlySaleAggregate(client, rosters.saleAggregate, partition.saleAggregate, planHash, sidecarOpts);
    await applyMatchedOnlySaleItems(client, rosters.saleItems, partition.saleItems, planHash, sidecarOpts);
    await applyMatchedOnlyReturnsAggregate(client, rosters.returnsAggregate, partition.returnsAggregate, planHash, sidecarOpts);
    await applyMatchedOnlyReturnItems(client, rosters.returnItems, partition.returnItems, planHash, sidecarOpts);
    const materialized = await verifyMatchedMaterializedRows(client, plan, partition, rosters, planHash);
    if (!materialized.ok) {
      await client.query("ROLLBACK");
      return materialized;
    }
    const meta = await verifySeptember047048Metadata(client, partition, rosters);
    if (!meta.ok) {
      await client.query("ROLLBACK");
      return meta;
    }
    await client.query("COMMIT");
    return {
      ok: true,
      receipt: {
        v: 1,
        planHash,
        matchedInserted: {
          saleAggregate: partition.saleAggregate.matched.length,
          saleItems: partition.saleItems.matched.length,
          returnsAggregate: partition.returnsAggregate.matched.length,
          returnItems: partition.returnItems.matched.length,
        },
        excludedCounts: EXPECTED_SOURCE_FILES,
        externalAuthorizationRef: input.externalAuthorizationRef,
      },
    };
  } catch (e) {
    await client.query("ROLLBACK");
    return { ok: false, code: "APPLY_FAILED", message: e instanceof Error ? e.message : "Apply failed." };
  } finally {
    client.release();
    await pool.end();
  }
}

/** Synthetic/local tests only — uses TEST_DATABASE_URL channel. */
export async function executeSeptember2026ApplySyntheticTest(input: {
  databaseUrl: string;
  rosters: MatchedOnlyBundleInput;
  plan: Awaited<ReturnType<typeof runMatchedOnlyBundlePlan>> & { ok: true };
  backup: import("../matched-only/types").MatchedOnlyScopedBackupV1;
  backupSha: string;
}): Promise<{ ok: boolean; code?: string }> {
  const { executeMatchedOnlyApply } = await import("../matched-only/apply-pipeline");
  const capability = issueTestExecutionCapability(input.databaseUrl);
  const r = await executeMatchedOnlyApply(
    capability,
    input.databaseUrl,
    input.rosters,
    input.plan.plan!,
    input.plan.planHash!,
    input.backup,
    input.backupSha,
  );
  return r.ok ? { ok: true } : { ok: false, code: r.code };
}
