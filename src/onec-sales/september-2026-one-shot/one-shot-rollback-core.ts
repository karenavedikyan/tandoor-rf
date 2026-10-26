import { tryAcquireImportLock } from "../../onec-clients/import-lock";
import { createImportPool } from "../../onec-clients/apply";
import { readTargetDbIdentityFromClient } from "../../onec-exchange-v3/target-db-identity";
import { captureSeptember047048BeforeState } from "./before-state-047-048";
import { EXPECTED_TARGET_DB_FINGERPRINT } from "./scope-pins";
import { loadAndVerifyOperatorDataScope, type OperatorDataScopeV1 } from "./operator-data-scope";
import { assertWritePreflightGatesAfterImportLock } from "./write-preflight-gates";
import type { ReadOnlyPreflightTestContext } from "./read-only-preflight-types";
import { assertProductionReadOnlyPreflightDatabaseUrl, assertExternalWriteAuthorization } from "./operator-guard";
import { assertSeptemberWriteGrant } from "./write-grants";
import { verifySeptemberBackupReceiptForRollback } from "./backup-receipt-verify";
import { restoreSeptember047048Backup } from "./rollback-047-048";
import { isCommitTransportUncertainty } from "../matched-only/commit-outcome";

export type OneShotRollbackTestContext = ReadOnlyPreflightTestContext & {
  skipOperatorDataScopeShaPin?: boolean;
  syntheticOperatorScope?: OperatorDataScopeV1;
  skipBackupPayloadPathSecurity?: boolean;
  injectPostCommitReadFailure?: boolean;
};

export type OneShotRollbackReceipt = {
  v: 1;
  kind: "september-2026-rollback-receipt";
  commitStatus: "committed" | "commit_uncertain";
  expectedLiveAfterStateDigest: string;
  liveAfterStateDigestBeforeRestore: string;
  restoredBeforeStateDigest: string;
  backupBeforeStateDigest: string;
  operatorDataScopeSha256: string;
  rollbackGrantRef: string;
  backupReceiptSha256: string;
  postCommitVerifyOk?: boolean;
};

export async function runSeptember2026OneShotRollback(input: {
  databaseUrl: string;
  operatorDataScopePath: string;
  operatorDataScopeSha256: string;
  rollbackGrantRef: string;
  externalAuthorizationRef: string;
  backupReceiptSha256: string;
  backupReceiptFilePath: string;
  backupPayloadFilePath: string;
  expectedLiveAfterStateDigest: string;
  testContext?: OneShotRollbackTestContext;
}): Promise<{ ok: true; receipt: OneShotRollbackReceipt } | { ok: false; code: string; message: string }> {
  const urlCheck = assertProductionReadOnlyPreflightDatabaseUrl(input.databaseUrl, input.testContext);
  if (!urlCheck.ok) return urlCheck;

  const auth = assertExternalWriteAuthorization();
  if (!auth.ok) return auth;
  if (auth.ref !== input.externalAuthorizationRef.trim()) {
    return { ok: false, code: "EXTERNAL_AUTHORIZATION_MISMATCH", message: "External authorization ref mismatch." };
  }

  const expectedLiveAfter = input.expectedLiveAfterStateDigest?.trim();
  if (!expectedLiveAfter) {
    return {
      ok: false,
      code: "EXPECTED_LIVE_AFTER_REQUIRED",
      message: "SEPTEMBER_2026_EXPECTED_LIVE_AFTER_DIGEST is required for rollback.",
    };
  }
  if (!input.backupReceiptSha256?.trim() || !input.backupReceiptFilePath?.trim() || !input.backupPayloadFilePath?.trim()) {
    return {
      ok: false,
      code: "BACKUP_RECEIPT_REQUIRED",
      message: "Verified backup receipt path/SHA and backup payload path required for rollback.",
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
      skipTargetFingerprintPin: input.testContext?.skipTargetFingerprintPin,
    });
    if (!loaded.ok) return loaded;
    scope = loaded.scope;
    scopeSha = loaded.sha256;
  }

  const grant = assertSeptemberWriteGrant("rollback", scope, input.rollbackGrantRef);
  if (!grant.ok) return grant;

  const privateRoot = process.env.SEPTEMBER_2026_BACKUP_PRIVATE_ROOT?.trim();
  if (!input.testContext?.skipBackupPayloadPathSecurity && !privateRoot) {
    return {
      ok: false,
      code: "BACKUP_PRIVATE_ROOT_REQUIRED",
      message: "SEPTEMBER_2026_BACKUP_PRIVATE_ROOT is required for production rollback.",
    };
  }

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

    const liveAfter = await captureSeptember047048BeforeState(client);
    if (liveAfter.digest !== expectedLiveAfter) {
      await client.query("ROLLBACK");
      txOpen = false;
      return { ok: false, code: "LIVE_AFTER_DRIFT", message: "Live after-state digest drift." };
    }

    const backupVerify = await verifySeptemberBackupReceiptForRollback({
      receiptFilePath: input.backupReceiptFilePath,
      expectedReceiptSha256: input.backupReceiptSha256.trim(),
      backupPayloadFilePath: input.backupPayloadFilePath,
      scope,
      scopeFileSha256: scopeSha,
      liveTargetFingerprint: identity.fingerprint,
      approvedPrivateBackupRoot: privateRoot,
      skipBackupPayloadPathSecurity: input.testContext?.skipBackupPayloadPathSecurity,
    });
    if (!backupVerify.ok) {
      await client.query("ROLLBACK");
      txOpen = false;
      return backupVerify;
    }

    await restoreSeptember047048Backup(client, backupVerify.backup);
    const restored = await captureSeptember047048BeforeState(client);
    if (restored.digest !== backupVerify.backup.beforeStateSha256) {
      await client.query("ROLLBACK");
      txOpen = false;
      return { ok: false, code: "ROLLBACK_VERIFY_FAILED", message: "Restored state digest mismatch." };
    }

    const restoredDigest = restored.digest;
    try {
      await client.query("COMMIT");
      txOpen = false;
    } catch (commitError) {
      if (isCommitTransportUncertainty(commitError)) {
        return {
          ok: false,
          code: "COMMIT_UNCERTAIN",
          message: `Commit outcome uncertain; restored digest ${restoredDigest}. Do not retry rollback or blind apply.`,
        };
      }
      await client.query("ROLLBACK").catch(() => undefined);
      txOpen = false;
      throw commitError;
    }

    let postCommitVerifyOk = true;
    if (input.testContext?.injectPostCommitReadFailure) {
      postCommitVerifyOk = false;
    } else {
      try {
        const afterPost = await captureSeptember047048BeforeState(client);
        if (afterPost.digest !== restoredDigest) {
          postCommitVerifyOk = false;
        }
      } catch {
        postCommitVerifyOk = false;
      }
    }

    return {
      ok: true,
      receipt: {
        v: 1,
        kind: "september-2026-rollback-receipt",
        commitStatus: "committed",
        expectedLiveAfterStateDigest: expectedLiveAfter,
        liveAfterStateDigestBeforeRestore: liveAfter.digest,
        restoredBeforeStateDigest: restoredDigest,
        backupBeforeStateDigest: backupVerify.backup.beforeStateSha256,
        operatorDataScopeSha256: scopeSha,
        rollbackGrantRef: input.rollbackGrantRef,
        backupReceiptSha256: input.backupReceiptSha256.trim(),
        postCommitVerifyOk,
      },
    };
  } catch (e) {
    if (txOpen) {
      await client.query("ROLLBACK").catch(() => undefined);
    }
    return { ok: false, code: "ROLLBACK_FAILED", message: e instanceof Error ? e.message : "Rollback failed." };
  } finally {
    client.release();
    await pool.end();
  }
}
