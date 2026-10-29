import assert from "node:assert/strict";
import { after, before, it } from "node:test";
import { Pool } from "pg";
import { chmod, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { resetPoolForTests, closePool } from "../../src/db/pool";
import { getIntegrationDatabaseUrl, prepareDatabase, setIntegrationEnv } from "../helpers/test-db";
import { LEGAL_A, LEGAL_B } from "../helpers/legal-sales-fixtures";
import { runSeptember2026OneShotApply } from "../../src/onec-sales/september-2026-one-shot/one-shot-apply-core";
import { runSeptember2026OneShotRollback } from "../../src/onec-sales/september-2026-one-shot/one-shot-rollback-core";
import { captureSeptember047048BeforeState } from "../../src/onec-sales/september-2026-one-shot/before-state-047-048";
import { readTargetDbIdentityFromClient } from "../../src/onec-exchange-v3/target-db-identity";
import { captureSeptember047048Backup } from "../../src/onec-sales/september-2026-one-shot/backup";
import { tryAcquireImportLock } from "../../src/onec-clients/import-lock";
import {
  buildSyntheticOperatorScope,
  writeSyntheticSeptemberSnapshot,
  writeSyntheticVerifiedBackupReceiptPair,
} from "../helpers/september-2026-synthetic-fixtures";
import { loadKnownLegalGuidSet } from "../../src/onec-sales/matched-only/catalog";

let url: string;
const scratch: string[] = [];
const SYNTHETIC_EXT_AUTH = "synthetic-test-not-human-consent";

async function mkPrivateBackupWorkDir(prefix: string): Promise<{ workDir: string; snapDir: string }> {
  const workDir = await mkdtemp(join(tmpdir(), prefix));
  await chmod(workDir, 0o700);
  scratch.push(workDir);
  const snapDir = join(workDir, "snapshot");
  return { workDir, snapDir };
}

before(async () => {
  url = getIntegrationDatabaseUrl();
  setIntegrationEnv(url);
  await resetPoolForTests();
  await prepareDatabase(url);
  const pool = new Pool({ connectionString: url });
  await pool.query(
    `INSERT INTO onec_v3_legal_entities (guid_client,name_client,type_category,other_fields,last_source_sha256)
     VALUES ($1::uuid,'A','{}'::jsonb,'{}'::jsonb,'test'),($2::uuid,'B','{}'::jsonb,'{}'::jsonb,'test')
     ON CONFLICT DO NOTHING`,
    [LEGAL_A, LEGAL_B],
  );
  await pool.end();
});

after(async () => {
  await closePool();
  for (const d of scratch) await rm(d, { recursive: true, force: true });
});

async function prepareEmptySeptemberAndBackupPair(workDir: string, snapDir: string) {
  const { buffers } = await writeSyntheticSeptemberSnapshot(snapDir);
  const pool = new Pool({ connectionString: url });
  await pool.query(`DELETE FROM onec_v3_legal_sales_lines WHERE sale_month = '2026-09-01'::date`);
  const client = await pool.connect();
  const identity = await readTargetDbIdentityFromClient(client, url);
  const before = await captureSeptember047048BeforeState(client);
  const known = await loadKnownLegalGuidSet(client);
  const backup = await captureSeptember047048Backup(client, identity.fingerprint);
  client.release();
  await pool.end();
  const scope = buildSyntheticOperatorScope({
    beforeStateDigest: before.digest,
    known,
    buffers,
    applyAuthorized: true,
    targetFingerprint: identity.fingerprint,
  });
  const pair = await writeSyntheticVerifiedBackupReceiptPair({
    dir: workDir,
    approvedPrivateRoot: workDir,
    backup,
    scopeFileSha256: "synthetic",
  });
  return { buffers, identity, before, scope, pair };
}

it("one-shot rollback: CLI --rollback requires external authorization before scope", () => {
  const bundlePath = join(process.cwd(), "operator-bundles/september-2026-one-shot-operator.cjs");
  const r = spawnSync(process.execPath, [bundlePath, "--rollback"], {
    env: {
      ...process.env,
      DATABASE_URL: "postgres://local-dummy:5432/dummy",
      SEPTEMBER_2026_OPERATOR_DATA_SCOPE_PATH: "/tmp/dummy-scope.json",
      SEPTEMBER_2026_ROLLBACK_GRANT_REF: "future-dummy-grant-ref",
      SEPTEMBER_2026_BACKUP_RECEIPT_SHA256: "deadbeef",
      SEPTEMBER_2026_BACKUP_RECEIPT_PATH: "/tmp/receipt.json",
      SEPTEMBER_2026_BACKUP_PAYLOAD_PATH: "/tmp/payload.json",
      SEPTEMBER_2026_EXPECTED_LIVE_AFTER_DIGEST: "deadbeef",
      SEPTEMBER_2026_SYNTHETIC_HARNESS: undefined,
    },
    encoding: "utf8",
  });
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  assert.match(out, /EXTERNAL_AUTHORIZATION_REQUIRED/);
});

it("one-shot rollback: synthetic backup -> apply -> rollback restores before digest", async () => {
  const { workDir, snapDir } = await mkPrivateBackupWorkDir("sep-rb-happy-");
  const { scope, pair, before } = await prepareEmptySeptemberAndBackupPair(workDir, snapDir);
  process.env.SEPTEMBER_2026_EXTERNAL_AUTHORIZATION_REF = SYNTHETIC_EXT_AUTH;
  process.env.SEPTEMBER_2026_BACKUP_PRIVATE_ROOT = workDir;
  process.env.SEPTEMBER_2026_APPLY_GRANT_REF = "synthetic-apply-grant";
  delete process.env.TEST_DATABASE_URL;
  const apply = await runSeptember2026OneShotApply({
    databaseUrl: url,
    operatorDataScopePath: join(snapDir, "scope.json"),
    operatorDataScopeSha256: "synthetic",
    applyGrantRef: "synthetic-apply-grant",
    backupReceiptSha256: pair.receiptSha256,
    backupReceiptFilePath: pair.receiptPath,
    backupPayloadFilePath: pair.backupPayloadPath,
    snapshotDirectory: snapDir,
    testContext: {
      allowNonProductionDatabaseUrl: true,
      skipTargetFingerprintPin: true,
      skipCatalogPin: true,
      skipBeforeDigestPin: true,
      skipSnapshotManifestSha: true,
      skipSnapshotPathSecurity: true,
      skipNightlySchedulerPin: true,
      syntheticApplyAllowed: true,
      syntheticOperatorScope: scope,
    },
  });
  assert.equal(apply.ok, true, JSON.stringify(apply));
  const liveAfter = apply.receipt.afterStateDigest;
  assert.ok(liveAfter);
  process.env.SEPTEMBER_2026_ROLLBACK_GRANT_REF = "synthetic-rollback-grant";
  const rollback = await runSeptember2026OneShotRollback({
    databaseUrl: url,
    operatorDataScopePath: join(snapDir, "scope.json"),
    operatorDataScopeSha256: "synthetic",
    rollbackGrantRef: "synthetic-rollback-grant",
    externalAuthorizationRef: SYNTHETIC_EXT_AUTH,
    backupReceiptSha256: pair.receiptSha256,
    backupReceiptFilePath: pair.receiptPath,
    backupPayloadFilePath: pair.backupPayloadPath,
    expectedLiveAfterStateDigest: liveAfter!,
    testContext: {
      allowNonProductionDatabaseUrl: true,
      skipTargetFingerprintPin: true,
      skipCatalogPin: true,
      skipNightlySchedulerPin: true,
      skipBackupPayloadPathSecurity: true,
      syntheticOperatorScope: scope,
    },
  });
  delete process.env.SEPTEMBER_2026_APPLY_GRANT_REF;
  delete process.env.SEPTEMBER_2026_ROLLBACK_GRANT_REF;
  delete process.env.SEPTEMBER_2026_EXTERNAL_AUTHORIZATION_REF;
  delete process.env.SEPTEMBER_2026_BACKUP_PRIVATE_ROOT;
  assert.equal(rollback.ok, true, JSON.stringify(rollback));
  assert.equal(rollback.receipt.restoredBeforeStateDigest, before.digest);
  const verifyPool = new Pool({ connectionString: url });
  const check = await verifyPool.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM onec_v3_legal_sales_lines WHERE sale_month = '2026-09-01'::date`,
  );
  assert.equal(Number(check.rows[0]?.n ?? 0), 0);
  await verifyPool.end();
});

it("one-shot rollback: wrong live-after digest stops under lock", async () => {
  const { workDir, snapDir } = await mkPrivateBackupWorkDir("sep-rb-live-");
  const { scope, pair } = await prepareEmptySeptemberAndBackupPair(workDir, snapDir);
  process.env.SEPTEMBER_2026_EXTERNAL_AUTHORIZATION_REF = SYNTHETIC_EXT_AUTH;
  process.env.SEPTEMBER_2026_ROLLBACK_GRANT_REF = "synthetic-rollback-grant";
  delete process.env.TEST_DATABASE_URL;
  const r = await runSeptember2026OneShotRollback({
    databaseUrl: url,
    operatorDataScopePath: join(snapDir, "scope.json"),
    operatorDataScopeSha256: "synthetic",
    rollbackGrantRef: "synthetic-rollback-grant",
    externalAuthorizationRef: SYNTHETIC_EXT_AUTH,
    backupReceiptSha256: pair.receiptSha256,
    backupReceiptFilePath: pair.receiptPath,
    backupPayloadFilePath: pair.backupPayloadPath,
    expectedLiveAfterStateDigest: "deadbeef".repeat(8),
    testContext: {
      allowNonProductionDatabaseUrl: true,
      skipTargetFingerprintPin: true,
      skipCatalogPin: true,
      skipNightlySchedulerPin: true,
      skipBackupPayloadPathSecurity: true,
      syntheticOperatorScope: scope,
    },
  });
  delete process.env.SEPTEMBER_2026_ROLLBACK_GRANT_REF;
  delete process.env.SEPTEMBER_2026_EXTERNAL_AUTHORIZATION_REF;
  assert.equal(r.ok, false);
  assert.equal(r.code, "LIVE_AFTER_DRIFT");
});

it("one-shot rollback: wrong backup receipt SHA fails before restore", async () => {
  const { workDir, snapDir } = await mkPrivateBackupWorkDir("sep-rb-payload-");
  const { scope, pair } = await prepareEmptySeptemberAndBackupPair(workDir, snapDir);
  process.env.SEPTEMBER_2026_EXTERNAL_AUTHORIZATION_REF = SYNTHETIC_EXT_AUTH;
  process.env.SEPTEMBER_2026_ROLLBACK_GRANT_REF = "synthetic-rollback-grant";
  delete process.env.TEST_DATABASE_URL;
  const pool = new Pool({ connectionString: url });
  const client = await pool.connect();
  const liveAfter = (await captureSeptember047048BeforeState(client)).digest;
  client.release();
  await pool.end();
  const r = await runSeptember2026OneShotRollback({
    databaseUrl: url,
    operatorDataScopePath: join(snapDir, "scope.json"),
    operatorDataScopeSha256: "synthetic",
    rollbackGrantRef: "synthetic-rollback-grant",
    externalAuthorizationRef: SYNTHETIC_EXT_AUTH,
    backupReceiptSha256: "0".repeat(64),
    backupReceiptFilePath: pair.receiptPath,
    backupPayloadFilePath: pair.backupPayloadPath,
    expectedLiveAfterStateDigest: liveAfter,
    testContext: {
      allowNonProductionDatabaseUrl: true,
      skipTargetFingerprintPin: true,
      skipCatalogPin: true,
      skipNightlySchedulerPin: true,
      skipBackupPayloadPathSecurity: true,
      syntheticOperatorScope: scope,
    },
  });
  delete process.env.SEPTEMBER_2026_ROLLBACK_GRANT_REF;
  delete process.env.SEPTEMBER_2026_EXTERNAL_AUTHORIZATION_REF;
  assert.equal(r.ok, false);
  assert.equal(r.code, "BACKUP_RECEIPT_SHA_MISMATCH");
});

it("one-shot rollback: production target fingerprint pin rejects test DB", async () => {
  const { workDir, snapDir } = await mkPrivateBackupWorkDir("sep-rb-target-");
  const { scope, pair } = await prepareEmptySeptemberAndBackupPair(workDir, snapDir);
  process.env.SEPTEMBER_2026_EXTERNAL_AUTHORIZATION_REF = SYNTHETIC_EXT_AUTH;
  process.env.SEPTEMBER_2026_ROLLBACK_GRANT_REF = "synthetic-rollback-grant";
  delete process.env.TEST_DATABASE_URL;
  const r = await runSeptember2026OneShotRollback({
    databaseUrl: url,
    operatorDataScopePath: join(snapDir, "scope.json"),
    operatorDataScopeSha256: "synthetic",
    rollbackGrantRef: "synthetic-rollback-grant",
    externalAuthorizationRef: SYNTHETIC_EXT_AUTH,
    backupReceiptSha256: pair.receiptSha256,
    backupReceiptFilePath: pair.receiptPath,
    backupPayloadFilePath: pair.backupPayloadPath,
    expectedLiveAfterStateDigest: "deadbeef".repeat(8),
    testContext: {
      allowNonProductionDatabaseUrl: true,
      skipCatalogPin: true,
      skipNightlySchedulerPin: true,
      skipBackupPayloadPathSecurity: true,
      syntheticOperatorScope: scope,
    },
  });
  delete process.env.SEPTEMBER_2026_ROLLBACK_GRANT_REF;
  delete process.env.SEPTEMBER_2026_EXTERNAL_AUTHORIZATION_REF;
  assert.equal(r.ok, false);
  assert.equal(r.code, "TARGET_FINGERPRINT_MISMATCH");
});

it("one-shot rollback: import lock busy stops before restore", async () => {
  const { workDir, snapDir } = await mkPrivateBackupWorkDir("sep-rb-lock-");
  const { scope, pair } = await prepareEmptySeptemberAndBackupPair(workDir, snapDir);
  process.env.SEPTEMBER_2026_EXTERNAL_AUTHORIZATION_REF = SYNTHETIC_EXT_AUTH;
  process.env.SEPTEMBER_2026_ROLLBACK_GRANT_REF = "synthetic-rollback-grant";
  delete process.env.TEST_DATABASE_URL;
  const holder = await new Pool({ connectionString: url }).connect();
  await holder.query("BEGIN");
  const locked = await tryAcquireImportLock(holder);
  assert.equal(locked, true);
  const pool = new Pool({ connectionString: url });
  const client = await pool.connect();
  const liveAfter = (await captureSeptember047048BeforeState(client)).digest;
  client.release();
  await pool.end();
  const r = await runSeptember2026OneShotRollback({
    databaseUrl: url,
    operatorDataScopePath: join(snapDir, "scope.json"),
    operatorDataScopeSha256: "synthetic",
    rollbackGrantRef: "synthetic-rollback-grant",
    externalAuthorizationRef: SYNTHETIC_EXT_AUTH,
    backupReceiptSha256: pair.receiptSha256,
    backupReceiptFilePath: pair.receiptPath,
    backupPayloadFilePath: pair.backupPayloadPath,
    expectedLiveAfterStateDigest: liveAfter,
    testContext: {
      allowNonProductionDatabaseUrl: true,
      skipTargetFingerprintPin: true,
      skipCatalogPin: true,
      skipNightlySchedulerPin: true,
      skipBackupPayloadPathSecurity: true,
      syntheticOperatorScope: scope,
    },
  });
  await holder.query("ROLLBACK");
  holder.release();
  delete process.env.SEPTEMBER_2026_ROLLBACK_GRANT_REF;
  delete process.env.SEPTEMBER_2026_EXTERNAL_AUTHORIZATION_REF;
  assert.equal(r.ok, false);
  assert.equal(r.code, "IMPORT_LOCK_BUSY");
});
