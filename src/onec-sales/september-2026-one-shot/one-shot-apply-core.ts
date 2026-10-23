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
import { buildMatchedOnlyBundlePlan, planHashFromPlan } from "../matched-only/plan-build";
import { isCommitTransportUncertainty } from "../matched-only/commit-outcome";
import { captureSeptember047048BeforeState } from "./before-state-047-048";
import { assertSeptember047048EmptyBeforeState } from "./before-state-empty-verify";
import {
  EXPECTED_APPLY_MATCHED_ROWS,
  EXPECTED_EMPTY_BEFORE_STATE_DIGEST,
  FIXED_SOURCE_SNAPSHOT_DIRECTORY,
} from "./scope-pins";
import { loadAndVerifyOperatorDataScope, unknownUnionSha256FromGuids, type OperatorDataScopeV1 } from "./operator-data-scope";
import { loadVerifiedSourceSnapshotFromDirectory } from "./source-snapshot-loader";
import { parseSeptemberSourceRosters } from "./source-pins";
import { assertSeptemberWriteGrant } from "./write-grants";
import { assertWritePreflightGatesUnderLock } from "./write-preflight-gates";
import { verifySeptember047048Metadata } from "./verify-047-048-metadata";
import {
  assertFinancialTotalsMatchScope,
  buildOperatorFinancialTotalsFromPartition,
} from "./operator-financial-budget";
import type { ReadOnlyPreflightTestContext } from "./read-only-preflight-types";
import { assertProductionReadOnlyPreflightDatabaseUrl } from "./operator-guard";

const SIDECAR = { sidecar049: false };

export type OneShotApplyTestContext = ReadOnlyPreflightTestContext & {
  skipOperatorDataScopeShaPin?: boolean;
  skipSnapshotManifestSha?: boolean;
  skipBeforeDigestPin?: boolean;
  /** Local synthetic apply only — not available from operator .cjs */
  syntheticApplyAllowed?: boolean;
  syntheticOperatorScope?: OperatorDataScopeV1;
  snapshotDirectory?: string;
};

export type OneShotApplyReceipt = {
  v: 1;
  kind: "september-2026-apply-receipt";
  commitStatus: "committed" | "rolled_back" | "commit_uncertain";
  planHash: string;
  beforeStateDigest: string;
  afterStateDigest: string | null;
  matchedInserted: {
    saleAggregate: number;
    saleItems: number;
    returnsAggregate: number;
    returnItems: number;
  };
  operatorDataScopeSha256: string;
  applyGrantRef: string;
  backupReceiptSha256: string | null;
};

export async function runSeptember2026OneShotApply(input: {
  databaseUrl: string;
  operatorDataScopePath: string;
  operatorDataScopeSha256: string;
  applyGrantRef: string;
  backupReceiptSha256?: string | null;
  snapshotDirectory?: string;
  testContext?: OneShotApplyTestContext;
}): Promise<{ ok: true; receipt: OneShotApplyReceipt } | { ok: false; code: string; message: string }> {
  const urlCheck = assertProductionReadOnlyPreflightDatabaseUrl(input.databaseUrl, input.testContext);
  if (!urlCheck.ok) {
    return urlCheck;
  }

  if (!input.testContext?.syntheticApplyAllowed) {
    return {
      ok: false,
      code: "APPLY_NOT_AUTHORIZED",
      message: "Apply is not authorized for this operation; scope remains read-only candidate.",
    };
  }

  let scope: OperatorDataScopeV1;
  let scopeSha: string;
  if (input.testContext?.syntheticOperatorScope) {
    scope = input.testContext.syntheticOperatorScope;
    scopeSha = input.operatorDataScopeSha256;
  } else {
    const loaded = await loadAndVerifyOperatorDataScope({
      scopeFilePath: input.operatorDataScopePath,
      expectedSha256: input.operatorDataScopeSha256,
      skipProductionShaPin: input.testContext?.skipOperatorDataScopeShaPin,
    });
    if (!loaded.ok) return loaded;
    scope = loaded.scope;
    scopeSha = loaded.sha256;
  }

  const grant = assertSeptemberWriteGrant(
    "apply",
    { ...scope, applyAuthorized: true },
    input.applyGrantRef,
    { allowAuthorizedScope: true },
  );
  if (!grant.ok) return grant;
  if (!input.backupReceiptSha256) {
    return { ok: false, code: "BACKUP_RECEIPT_REQUIRED", message: "Verified backup receipt SHA required for apply." };
  }

  const snapshotDir =
    input.snapshotDirectory ??
    input.testContext?.snapshotDirectory ??
    (input.testContext?.skipOperatorDataScopeShaPin ? undefined : FIXED_SOURCE_SNAPSHOT_DIRECTORY);
  if (!snapshotDir) {
    return { ok: false, code: "SNAPSHOT_DIRECTORY_MISSING", message: "Snapshot directory required." };
  }
  if (
    !input.testContext?.skipOperatorDataScopeShaPin &&
    !input.testContext?.syntheticApplyAllowed &&
    snapshotDir !== FIXED_SOURCE_SNAPSHOT_DIRECTORY
  ) {
    return { ok: false, code: "SNAPSHOT_DIRECTORY_MISMATCH", message: "Snapshot directory mismatch." };
  }

  const snapshot = await loadVerifiedSourceSnapshotFromDirectory({
    directory: snapshotDir,
    skipManifestShaPin: input.testContext?.skipSnapshotManifestSha,
    skipSourcePinVerification: input.testContext?.syntheticApplyAllowed,
  });
  if (!snapshot.ok) return snapshot;

  const rosters = parseSeptemberSourceRosters(snapshot.buffers);
  const bundle: MatchedOnlyBundleInput = rosters;

  const pool = createImportPool(input.databaseUrl);
  const client = await pool.connect();
  let txOpen = false;
  try {
    await client.query("BEGIN");
    txOpen = true;
    const gates = await assertWritePreflightGatesUnderLock(client, input.databaseUrl, input.testContext);
    if (!gates.ok) {
      await client.query("ROLLBACK");
      txOpen = false;
      return gates;
    }
    const beforeDigest = input.testContext?.skipBeforeDigestPin
      ? (await captureSeptember047048BeforeState(client)).digest
      : EXPECTED_EMPTY_BEFORE_STATE_DIGEST;
    const beforeCheck = await assertSeptember047048EmptyBeforeState(client, beforeDigest);
    if (!beforeCheck.ok) {
      await client.query("ROLLBACK");
      txOpen = false;
      return beforeCheck;
    }
    if (beforeDigest !== scope.beforeStateDigest) {
      await client.query("ROLLBACK");
      txOpen = false;
      return { ok: false, code: "SCOPE_BEFORE_MISMATCH", message: "Live before digest does not match scope." };
    }

    const locked = await tryAcquireImportLock(client);
    if (!locked) {
      await client.query("ROLLBACK");
      txOpen = false;
      return { ok: false, code: "IMPORT_LOCK_BUSY", message: "Import lock busy." };
    }

    const { plan } = await buildMatchedOnlyBundlePlan(client, {
      ...bundle,
      targetDbFingerprint: gates.fingerprint,
    });
    const planHash = planHashFromPlan(plan);
    const known = await loadKnownLegalGuidSet(client);
    const partition = partitionSalesBundle({ ...bundle, known });
    const unknownSha = unknownUnionSha256FromGuids(partition.unknownGuids);
    if (unknownSha !== scope.unknownUnionSha256) {
      await client.query("ROLLBACK");
      txOpen = false;
      return { ok: false, code: "UNKNOWN_UNION_SHA_MISMATCH", message: "Unknown GUID union SHA mismatch." };
    }
    const financial = buildOperatorFinancialTotalsFromPartition(partition);
    const finCheck = assertFinancialTotalsMatchScope(scope, financial);
    if (!finCheck.ok) {
      await client.query("ROLLBACK");
      txOpen = false;
      return finCheck;
    }

    await applyMatchedOnlySaleAggregate(client, bundle.saleAggregate, partition.saleAggregate, planHash, SIDECAR);
    await applyMatchedOnlySaleItems(client, bundle.saleItems, partition.saleItems, planHash, SIDECAR);
    await applyMatchedOnlyReturnsAggregate(client, bundle.returnsAggregate, partition.returnsAggregate, planHash, SIDECAR);
    await applyMatchedOnlyReturnItems(client, bundle.returnItems, partition.returnItems, planHash, SIDECAR);

    const materialized = await verifyMatchedMaterializedRows(client, plan, partition, bundle, planHash, {
      skip049Metadata: true,
    });
    if (!materialized.ok) {
      await client.query("ROLLBACK");
      txOpen = false;
      return materialized;
    }
    const meta = await verifySeptember047048Metadata(client, partition, bundle);
    if (!meta.ok) {
      await client.query("ROLLBACK");
      txOpen = false;
      return meta;
    }

    const inserted = {
      saleAggregate: partition.saleAggregate.matched.length,
      saleItems: partition.saleItems.matched.length,
      returnsAggregate: partition.returnsAggregate.matched.length,
      returnItems: partition.returnItems.matched.length,
    };
    if (
      inserted.saleAggregate !== EXPECTED_APPLY_MATCHED_ROWS.saleAggregate ||
      inserted.saleItems !== EXPECTED_APPLY_MATCHED_ROWS.saleItems ||
      inserted.returnsAggregate !== EXPECTED_APPLY_MATCHED_ROWS.returnsAggregate ||
      inserted.returnItems !== EXPECTED_APPLY_MATCHED_ROWS.returnItems
    ) {
      if (!input.testContext?.syntheticApplyAllowed) {
        await client.query("ROLLBACK");
        txOpen = false;
        return { ok: false, code: "MATCHED_ROW_COUNT_MISMATCH", message: "Matched row counts mismatch." };
      }
    }

    let afterDigest: string | null = null;
    try {
      await client.query("COMMIT");
      txOpen = false;
      const after = await captureSeptember047048BeforeState(client);
      afterDigest = after.digest;
    } catch (commitError) {
      if (isCommitTransportUncertainty(commitError)) {
        return {
          ok: false,
          code: "COMMIT_UNCERTAIN",
          message: "Commit outcome uncertain; do not retry apply or rollback automatically.",
        };
      }
      await client.query("ROLLBACK").catch(() => undefined);
      txOpen = false;
      throw commitError;
    }

    return {
      ok: true,
      receipt: {
        v: 1,
        kind: "september-2026-apply-receipt",
        commitStatus: "committed",
        planHash,
        beforeStateDigest: beforeDigest,
        afterStateDigest: afterDigest,
        matchedInserted: inserted,
        operatorDataScopeSha256: scopeSha,
        applyGrantRef: input.applyGrantRef,
        backupReceiptSha256: input.backupReceiptSha256 ?? null,
      },
    };
  } catch (e) {
    if (txOpen) {
      await client.query("ROLLBACK").catch(() => undefined);
    }
    return { ok: false, code: "APPLY_FAILED", message: e instanceof Error ? e.message : "Apply failed." };
  } finally {
    client.release();
    await pool.end();
  }
}
