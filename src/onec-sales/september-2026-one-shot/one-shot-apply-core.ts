import { tryAcquireImportLock } from "../../onec-clients/import-lock";
import { createImportPool } from "../../onec-clients/apply";
import { readTargetDbIdentityFromClient } from "../../onec-exchange-v3/target-db-identity";
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
  EXPECTED_TARGET_DB_FINGERPRINT,
  FIXED_SOURCE_SNAPSHOT_DIRECTORY,
} from "./scope-pins";
import { loadAndVerifyOperatorDataScope, unknownUnionSha256FromGuids, type OperatorDataScopeV1 } from "./operator-data-scope";
import { loadVerifiedSourceSnapshotFromDirectory } from "./source-snapshot-loader";
import { parseSeptemberSourceRosters } from "./source-pins";
import { assertSeptemberWriteGrant } from "./write-grants";
import { assertWritePreflightGatesAfterImportLock } from "./write-preflight-gates";
import { verifySeptember047048Metadata } from "./verify-047-048-metadata";
import {
  assertFinancialTotalsMatchScope,
  buildOperatorFinancialTotalsFromPartition,
} from "./operator-financial-budget";
import type { ReadOnlyPreflightTestContext } from "./read-only-preflight-types";
import { assertProductionReadOnlyPreflightDatabaseUrl } from "./operator-guard";
import { assertSeptemberProductionApplyChannelOpen } from "./operator-production-apply-channel";
import { verifySeptemberBackupReceiptForApply } from "./backup-receipt-verify";

const SIDECAR = { sidecar049: false };

export type OneShotApplyTestContext = ReadOnlyPreflightTestContext & {
  skipOperatorDataScopeShaPin?: boolean;
  skipSnapshotManifestSha?: boolean;
  skipBeforeDigestPin?: boolean;
  skipSnapshotPathSecurity?: boolean;
  skipSourcePinVerification?: boolean;
  /** Local synthetic apply only — not available from operator .cjs */
  syntheticApplyAllowed?: boolean;
  syntheticOperatorScope?: OperatorDataScopeV1;
  snapshotDirectory?: string;
  backupReceiptFilePath?: string;
  backupPayloadFilePath?: string;
  skipBackupPayloadPathSecurity?: boolean;
  /** When true, post-COMMIT read throws (commit must still be classified committed). */
  injectPostCommitReadFailure?: boolean;
};

export type OneShotApplyReceipt = {
  v: 1;
  kind: "september-2026-apply-receipt";
  commitStatus: "committed" | "rolled_back" | "commit_uncertain";
  planHash: string;
  beforeStateDigest: string;
  afterStateDigest: string | null;
  expectedAfterStateDigest?: string;
  postCommitVerifyOk?: boolean;
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
  backupReceiptFilePath?: string;
  backupPayloadFilePath?: string;
  snapshotDirectory?: string;
  testContext?: OneShotApplyTestContext;
}): Promise<{ ok: true; receipt: OneShotApplyReceipt } | { ok: false; code: string; message: string }> {
  const urlCheck = assertProductionReadOnlyPreflightDatabaseUrl(input.databaseUrl, input.testContext);
  if (!urlCheck.ok) {
    return urlCheck;
  }

  const synthetic = input.testContext?.syntheticApplyAllowed === true;
  if (!synthetic) {
    const channel = assertSeptemberProductionApplyChannelOpen();
    if (!channel.ok) {
      return channel;
    }
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

  const grant = assertSeptemberWriteGrant("apply", scope, input.applyGrantRef, {
    allowAuthorizedScope: scope.applyAuthorized === true,
  });
  if (!grant.ok) return grant;

  const receiptPath =
    input.backupReceiptFilePath?.trim() ??
    input.testContext?.backupReceiptFilePath?.trim() ??
    process.env.SEPTEMBER_2026_BACKUP_RECEIPT_PATH?.trim();
  const payloadPath =
    input.backupPayloadFilePath?.trim() ??
    input.testContext?.backupPayloadFilePath?.trim() ??
    process.env.SEPTEMBER_2026_BACKUP_PAYLOAD_PATH?.trim();
  if (!receiptPath || !input.backupReceiptSha256?.trim() || !payloadPath) {
    return {
      ok: false,
      code: "BACKUP_RECEIPT_REQUIRED",
      message: "Verified backup receipt path/SHA and backup payload path required for apply.",
    };
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
    !synthetic &&
    !input.testContext?.syntheticOperatorScope &&
    snapshotDir !== FIXED_SOURCE_SNAPSHOT_DIRECTORY
  ) {
    return { ok: false, code: "SNAPSHOT_DIRECTORY_MISMATCH", message: "Snapshot directory mismatch." };
  }

  const snapshot = await loadVerifiedSourceSnapshotFromDirectory({
    directory: snapshotDir,
    skipManifestShaPin: input.testContext?.skipSnapshotManifestSha,
    skipSourcePinVerification: synthetic || input.testContext?.skipSourcePinVerification === true,
    skipPathSecurity: input.testContext?.skipSnapshotPathSecurity,
    scope: synthetic ? undefined : scope,
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

    const identity = await readTargetDbIdentityFromClient(client, input.databaseUrl);
    const fingerprintOk =
      input.testContext?.skipTargetFingerprintPin === true ||
      identity.fingerprint === EXPECTED_TARGET_DB_FINGERPRINT;
    if (!fingerprintOk) {
      await client.query("ROLLBACK");
      txOpen = false;
      return { ok: false, code: "TARGET_FINGERPRINT_MISMATCH", message: "Database fingerprint mismatch." };
    }

    const locked = await tryAcquireImportLock(client);
    if (!locked) {
      await client.query("ROLLBACK");
      txOpen = false;
      return { ok: false, code: "IMPORT_LOCK_BUSY", message: "Import lock busy." };
    }

    const gates = await assertWritePreflightGatesAfterImportLock(client, input.testContext);
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

    const backupVerify = await verifySeptemberBackupReceiptForApply({
      receiptFilePath: receiptPath,
      expectedReceiptSha256: input.backupReceiptSha256.trim(),
      backupPayloadFilePath: payloadPath,
      scope,
      scopeFileSha256: scopeSha,
      liveTargetFingerprint: identity.fingerprint,
      liveBeforeStateDigest: beforeDigest,
      approvedPrivateBackupRoot: process.env.SEPTEMBER_2026_BACKUP_PRIVATE_ROOT?.trim(),
      skipBackupPayloadPathSecurity: input.testContext?.skipBackupPayloadPathSecurity,
    });
    if (!backupVerify.ok) {
      await client.query("ROLLBACK");
      txOpen = false;
      return backupVerify;
    }

    const { plan } = await buildMatchedOnlyBundlePlan(client, {
      ...bundle,
      targetDbFingerprint: identity.fingerprint,
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
      if (!synthetic) {
        await client.query("ROLLBACK");
        txOpen = false;
        return { ok: false, code: "MATCHED_ROW_COUNT_MISMATCH", message: "Matched row counts mismatch." };
      }
    }

    const afterInsideTx = await captureSeptember047048BeforeState(client);
    const expectedAfterDigest = afterInsideTx.digest;

    try {
      await client.query("COMMIT");
      txOpen = false;
    } catch (commitError) {
      if (isCommitTransportUncertainty(commitError)) {
        return {
          ok: false,
          code: "COMMIT_UNCERTAIN",
          message: `Commit outcome uncertain; expected after digest ${expectedAfterDigest}. Do not retry apply or blind rollback.`,
        };
      }
      await client.query("ROLLBACK").catch(() => undefined);
      txOpen = false;
      throw commitError;
    }

    let afterDigest: string | null = expectedAfterDigest;
    let postCommitVerifyOk = true;
    if (input.testContext?.injectPostCommitReadFailure) {
      postCommitVerifyOk = false;
      afterDigest = expectedAfterDigest;
    } else {
      try {
        const afterPost = await captureSeptember047048BeforeState(client);
        if (afterPost.digest !== expectedAfterDigest) {
          postCommitVerifyOk = false;
        }
        afterDigest = afterPost.digest;
      } catch {
        postCommitVerifyOk = false;
        afterDigest = expectedAfterDigest;
      }
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
        expectedAfterStateDigest: expectedAfterDigest,
        postCommitVerifyOk,
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
