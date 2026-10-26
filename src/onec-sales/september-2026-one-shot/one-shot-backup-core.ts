import { tryAcquireImportLock } from "../../onec-clients/import-lock";
import { createImportPool } from "../../onec-clients/apply";
import { readTargetDbIdentityFromClient } from "../../onec-exchange-v3/target-db-identity";
import { captureSeptember047048Backup } from "./backup";
import { captureSeptember047048BeforeState } from "./before-state-047-048";
import { assertSeptember047048EmptyBeforeState } from "./before-state-empty-verify";
import { EXPECTED_EMPTY_BEFORE_STATE_DIGEST, EXPECTED_TARGET_DB_FINGERPRINT } from "./scope-pins";
import { loadAndVerifyOperatorDataScope } from "./operator-data-scope";
import { assertWritePreflightGatesAfterImportLock } from "./write-preflight-gates";
import type { ReadOnlyPreflightTestContext } from "./read-only-preflight-types";
import { assertProductionReadOnlyPreflightDatabaseUrl, assertExternalWriteAuthorization } from "./operator-guard";
import { assertSeptemberWriteGrant } from "./write-grants";
import { publishPrivateBackupJson, publishPrivateTextFile } from "./private-backup-publish";
import { buildSeptemberBackupReceiptFromVerifiedPayload } from "./backup-receipt-verify";

export type OneShotBackupTestContext = ReadOnlyPreflightTestContext & {
  skipBeforeDigestPin?: boolean;
  skipOperatorDataScopeShaPin?: boolean;
};

export type OneShotBackupResult = {
  v: 1;
  kind: "september-2026-backup-result";
  targetDbFingerprint: string;
  beforeStateDigest: string;
  operatorDataScopeSha256: string;
  backupPayloadPath: string;
  backupPayloadSha256: string;
  backupReceiptPath: string;
  backupReceiptSha256: string;
};

export async function runSeptember2026OneShotBackup(input: {
  databaseUrl: string;
  operatorDataScopePath: string;
  operatorDataScopeSha256: string;
  backupGrantRef: string;
  backupPayloadDestinationPath: string;
  backupReceiptDestinationPath: string;
  approvedPrivateRoot: string;
  testContext?: OneShotBackupTestContext;
}): Promise<{ ok: true; result: OneShotBackupResult } | { ok: false; code: string; message: string }> {
  const urlCheck = assertProductionReadOnlyPreflightDatabaseUrl(input.databaseUrl, input.testContext);
  if (!urlCheck.ok) return urlCheck;
  const auth = assertExternalWriteAuthorization();
  if (!auth.ok) return auth;
  if (!input.approvedPrivateRoot?.trim()) {
    return { ok: false, code: "BACKUP_PRIVATE_ROOT_REQUIRED", message: "SEPTEMBER_2026_BACKUP_PRIVATE_ROOT is required." };
  }

  const loaded = await loadAndVerifyOperatorDataScope({
    scopeFilePath: input.operatorDataScopePath,
    expectedSha256: input.operatorDataScopeSha256,
    skipProductionShaPin: input.testContext?.skipOperatorDataScopeShaPin,
  });
  if (!loaded.ok) return loaded;
  const scope = loaded.scope;
  const scopeSha = loaded.sha256;

  const grant = assertSeptemberWriteGrant("backup", scope, input.backupGrantRef);
  if (!grant.ok) return grant;

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

    const resolvedBeforeDigest = input.testContext?.skipBeforeDigestPin
      ? (await captureSeptember047048BeforeState(client)).digest
      : EXPECTED_EMPTY_BEFORE_STATE_DIGEST;
    const beforeCheck = await assertSeptember047048EmptyBeforeState(client, resolvedBeforeDigest);
    if (!beforeCheck.ok) {
      await client.query("ROLLBACK");
      txOpen = false;
      return beforeCheck;
    }
    if (resolvedBeforeDigest !== scope.beforeStateDigest) {
      await client.query("ROLLBACK");
      txOpen = false;
      return { ok: false, code: "SCOPE_BEFORE_MISMATCH", message: "Live before digest does not match scope." };
    }

    const backup = await captureSeptember047048Backup(client, identity.fingerprint);
    await client.query("COMMIT");
    txOpen = false;

    const published = await publishPrivateBackupJson({
      destinationPath: input.backupPayloadDestinationPath,
      approvedPrivateRoot: input.approvedPrivateRoot,
      payload: backup,
    });
    if (!published.ok) return published;

    const receipt = buildSeptemberBackupReceiptFromVerifiedPayload({
      targetDbFingerprint: identity.fingerprint,
      scopeFileSha256: scopeSha,
      beforeStateSha256: resolvedBeforeDigest,
      backupPayloadFileSha256: published.fileSha256,
      capturedAt: backup.capturedAt,
    });
    const receiptText = JSON.stringify(receipt);
    const receiptPublished = await publishPrivateTextFile({
      destinationPath: input.backupReceiptDestinationPath,
      approvedPrivateRoot: input.approvedPrivateRoot,
      text: receiptText,
    });
    if (!receiptPublished.ok) return receiptPublished;

    return {
      ok: true,
      result: {
        v: 1,
        kind: "september-2026-backup-result",
        targetDbFingerprint: identity.fingerprint,
        beforeStateDigest: resolvedBeforeDigest,
        operatorDataScopeSha256: scopeSha,
        backupPayloadPath: input.backupPayloadDestinationPath,
        backupPayloadSha256: published.fileSha256,
        backupReceiptPath: input.backupReceiptDestinationPath,
        backupReceiptSha256: receiptPublished.fileSha256,
      },
    };
  } catch (e) {
    if (txOpen) {
      await client.query("ROLLBACK").catch(() => undefined);
    }
    return { ok: false, code: "BACKUP_FAILED", message: e instanceof Error ? e.message : "Backup failed." };
  } finally {
    client.release();
    await pool.end();
  }
}
