import assert from "node:assert/strict";
import { after, before, it } from "node:test";
import { Pool } from "pg";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { resetPoolForTests, closePool } from "../../src/db/pool";
import { getIntegrationDatabaseUrl, prepareDatabase, setIntegrationEnv } from "../helpers/test-db";
import { LEGAL_A, LEGAL_B } from "../helpers/legal-sales-fixtures";
import { runSeptember2026OneShotApply } from "../../src/onec-sales/september-2026-one-shot/one-shot-apply-core";
import { executeSeptember2026Apply } from "../../src/onec-sales/september-2026-one-shot/execute-apply";
import { captureSeptember047048BeforeState } from "../../src/onec-sales/september-2026-one-shot/before-state-047-048";
import { readTargetDbIdentityFromClient } from "../../src/onec-exchange-v3/target-db-identity";
import { captureSeptember047048Backup } from "../../src/onec-sales/september-2026-one-shot/backup";
import {
  buildSyntheticOperatorScope,
  writeSyntheticSeptemberSnapshot,
  writeSyntheticVerifiedBackupReceiptPair,
} from "../helpers/september-2026-synthetic-fixtures";
import { loadKnownLegalGuidSet } from "../../src/onec-sales/matched-only/catalog";
import {
  FROZEN_OPERATOR_DATA_SCOPE_KIND,
  validateOperatorDataScopeDocument,
  type OperatorDataScopeV1,
} from "../../src/onec-sales/september-2026-one-shot/operator-data-scope";
import { PINNED_SEPTEMBER_2026_PRODUCTION_APPLY_CHANNEL_REF } from "../../src/onec-sales/september-2026-one-shot/operator-production-apply-channel";

let url: string;
const scratch: string[] = [];

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

it("operator data scope: structural fixture matches frozen Computer shape", async () => {
  const raw = await readFile(
    join(process.cwd(), "test/fixtures/september-2026-operator-data-scope.structural.json"),
    "utf8",
  );
  const doc = JSON.parse(raw) as OperatorDataScopeV1;
  assert.equal(doc.kind, FROZEN_OPERATOR_DATA_SCOPE_KIND);
  assert.equal(typeof doc.sources.saleAggregate.guidFields, "number");
  assert.equal(typeof doc.allowedMetadata, "string");
  assert.equal(doc.excludedRows, 4024);
  assert.equal(doc.beforeCounts.saleAggregateLinesJson, 0);
  const valid = validateOperatorDataScopeDocument(doc, { skipProductionPins: true });
  assert.equal(valid.ok, true, JSON.stringify(valid));
});

it("one-shot apply: production entry is fail-closed (APPLY_NOT_AUTHORIZED)", async () => {
  const saved = process.env.TEST_DATABASE_URL;
  delete process.env.TEST_DATABASE_URL;
  delete process.env.SEPTEMBER_2026_PRODUCTION_APPLY_CHANNEL_REF;
  const r = await executeSeptember2026Apply({
    databaseUrl: url,
    operatorDataScopePath: "/tmp/unused",
    operatorDataScopeSha256: "deadbeef",
    applyGrantRef: "not-allowed",
  });
  assert.equal(r.ok, false);
  assert.equal(r.code, "APPLY_NOT_AUTHORIZED");
  if (saved) process.env.TEST_DATABASE_URL = saved;
});

it("one-shot apply: CLI --apply returns APPLY_NOT_AUTHORIZED before scope (no test flags)", () => {
  const bundlePath = join(process.cwd(), "operator-bundles/september-2026-one-shot-operator.cjs");
  const r = spawnSync(
    process.execPath,
    [bundlePath, "--apply"],
    {
      env: {
        ...process.env,
        DATABASE_URL: "postgres://local-dummy:5432/dummy",
        SEPTEMBER_2026_OPERATOR_DATA_SCOPE_PATH: "/tmp/dummy-scope.json",
        SEPTEMBER_2026_APPLY_GRANT_REF: "future-dummy-grant-ref",
        SEPTEMBER_2026_BACKUP_RECEIPT_SHA256: "deadbeef",
        SEPTEMBER_2026_SYNTHETIC_HARNESS: undefined,
      },
      encoding: "utf8",
    },
  );
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  assert.match(out, /APPLY_NOT_AUTHORIZED/);
});

it("one-shot apply: production channel without verified backup refuses before writes", async () => {
  const savedTestUrl = process.env.TEST_DATABASE_URL;
  delete process.env.TEST_DATABASE_URL;
  process.env.SEPTEMBER_2026_PRODUCTION_APPLY_CHANNEL_REF = PINNED_SEPTEMBER_2026_PRODUCTION_APPLY_CHANNEL_REF;
  process.env.SEPTEMBER_2026_APPLY_GRANT_REF = "future-human-grant";
  const workDir = await mkdtemp(join(tmpdir(), "sep-snap-nobackup-"));
  scratch.push(workDir);
  const snapDir = join(workDir, "snapshot");
  await writeSyntheticSeptemberSnapshot(snapDir);
  const pool = new Pool({ connectionString: url });
  const client = await pool.connect();
  const identity = await readTargetDbIdentityFromClient(client, url);
  const before = await captureSeptember047048BeforeState(client);
  const known = await loadKnownLegalGuidSet(client);
  client.release();
  await pool.end();
  const scope = buildSyntheticOperatorScope({
    beforeStateDigest: before.digest,
    known,
    buffers: (await writeSyntheticSeptemberSnapshot(snapDir)).buffers,
    applyAuthorized: true,
    targetFingerprint: identity.fingerprint,
  });
  const r = await runSeptember2026OneShotApply({
    databaseUrl: url,
    operatorDataScopePath: join(snapDir, "scope.json"),
    operatorDataScopeSha256: "synthetic",
    applyGrantRef: "future-human-grant",
    backupReceiptSha256: "0".repeat(64),
    backupReceiptFilePath: join(workDir, "missing-receipt.json"),
    snapshotDirectory: snapDir,
    testContext: {
      allowNonProductionDatabaseUrl: true,
      skipTargetFingerprintPin: true,
      skipCatalogPin: true,
      skipBeforeDigestPin: true,
      skipSnapshotManifestSha: true,
      skipSnapshotPathSecurity: true,
      skipNightlySchedulerPin: true,
      skipOperatorDataScopeShaPin: true,
      skipSourcePinVerification: true,
      syntheticOperatorScope: scope,
    },
  });
  assert.equal(r.ok, false);
  assert.match(r.code, /BACKUP_RECEIPT/);
  delete process.env.SEPTEMBER_2026_PRODUCTION_APPLY_CHANNEL_REF;
  delete process.env.SEPTEMBER_2026_APPLY_GRANT_REF;
  if (savedTestUrl) process.env.TEST_DATABASE_URL = savedTestUrl;
});

it("one-shot apply: wrong target fingerprint fails before business writes", async () => {
  const savedTestUrl = process.env.TEST_DATABASE_URL;
  delete process.env.TEST_DATABASE_URL;
  process.env.SEPTEMBER_2026_APPLY_GRANT_REF = "x";
  const snapDir = await mkdtemp(join(tmpdir(), "sep-snap-wrong-"));
  scratch.push(snapDir);
  const { buffers } = await writeSyntheticSeptemberSnapshot(snapDir);
  const scope = buildSyntheticOperatorScope({
    beforeStateDigest: "x",
    known: new Set([LEGAL_A.toLowerCase(), LEGAL_B.toLowerCase()]),
    buffers,
    applyAuthorized: true,
    targetFingerprint: "wrong",
  });
  const r = await runSeptember2026OneShotApply({
    databaseUrl: url,
    operatorDataScopePath: join(snapDir, "scope.json"),
    operatorDataScopeSha256: "x",
    applyGrantRef: "x",
    backupReceiptSha256: "b",
    backupReceiptFilePath: join(snapDir, "missing.json"),
    backupPayloadFilePath: join(snapDir, "missing-payload.json"),
    snapshotDirectory: snapDir,
    testContext: {
      allowNonProductionDatabaseUrl: true,
      syntheticApplyAllowed: true,
      skipSnapshotManifestSha: true,
      skipSnapshotPathSecurity: true,
      skipNightlySchedulerPin: true,
      syntheticOperatorScope: scope,
    },
  });
  assert.equal(r.ok, false);
  assert.equal(r.code, "TARGET_FINGERPRINT_MISMATCH");
  delete process.env.SEPTEMBER_2026_APPLY_GRANT_REF;
  if (savedTestUrl) process.env.TEST_DATABASE_URL = savedTestUrl;
});

it("one-shot apply: non-empty before state stops under lock without matched writes", async () => {
  const snapDir = await mkdtemp(join(tmpdir(), "sep-snap-before-"));
  scratch.push(snapDir);
  const { buffers } = await writeSyntheticSeptemberSnapshot(snapDir);
  const pool = new Pool({ connectionString: url });
  await pool.query(`DELETE FROM onec_v3_legal_sales_lines WHERE sale_month = '2026-09-01'::date`);
  await pool.query(
    `
      INSERT INTO onec_v3_legal_sales_lines (
        legal_guid, sale_month, product_type, quantity, income,
        manual_discount, automatic_discount, total_discount,
        cost_price, additional_expenses, gross_profit, profitability,
        source_sha256, imported_at
      ) VALUES ($1::uuid, '2026-09-01'::date, 'blocker', 1, 1, 0,0,0,0,0,0,0, 'x', NOW())
    `,
    [LEGAL_A],
  );
  const client = await pool.connect();
  const identity = await readTargetDbIdentityFromClient(client, url);
  const before = await captureSeptember047048BeforeState(client);
  const known = await loadKnownLegalGuidSet(client);
  client.release();
  await pool.end();
  const scope = buildSyntheticOperatorScope({
    beforeStateDigest: "b8b0946873bc8079c559c9b5f746e7388bfa6c4555c2d33bcc611947b14b8ce5",
    known,
    buffers,
    applyAuthorized: true,
    targetFingerprint: identity.fingerprint,
  });
  const workDir = join(snapDir, "..");
  const backupClient = await new Pool({ connectionString: url }).connect();
  const backup = await captureSeptember047048Backup(backupClient, identity.fingerprint);
  backupClient.release();
  const pair = await writeSyntheticVerifiedBackupReceiptPair({
    dir: workDir,
    backup,
    scopeFileSha256: "synthetic",
  });
  process.env.SEPTEMBER_2026_APPLY_GRANT_REF = "synthetic-apply-grant";
  delete process.env.TEST_DATABASE_URL;
  const r = await runSeptember2026OneShotApply({
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
      skipSnapshotManifestSha: true,
      skipSnapshotPathSecurity: true,
      skipBackupPayloadPathSecurity: true,
      skipNightlySchedulerPin: true,
      syntheticApplyAllowed: true,
      syntheticOperatorScope: scope,
    },
  });
  delete process.env.SEPTEMBER_2026_APPLY_GRANT_REF;
  assert.equal(r.ok, false);
  assert.match(r.code, /BEFORE_STATE|SCOPE_BEFORE/);
  const verifyPool = new Pool({ connectionString: url });
  const check = await verifyPool.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM onec_v3_legal_sales_lines WHERE sale_month = '2026-09-01'::date AND product_type <> 'blocker'`,
  );
  assert.equal(Number(check.rows[0]?.n ?? 0), 0);
  await verifyPool.query(`DELETE FROM onec_v3_legal_sales_lines WHERE sale_month = '2026-09-01'::date`);
  await verifyPool.end();
});

it("one-shot apply: synthetic core path commits matched rows", async () => {
  const snapDir = await mkdtemp(join(tmpdir(), "sep-snap-"));
  scratch.push(snapDir);
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
    dir: join(snapDir, ".."),
    backup,
    scopeFileSha256: "synthetic",
  });
  process.env.SEPTEMBER_2026_APPLY_GRANT_REF = "synthetic-apply-grant";
  delete process.env.TEST_DATABASE_URL;
  const r = await runSeptember2026OneShotApply({
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
      skipBackupPayloadPathSecurity: true,
      skipNightlySchedulerPin: true,
      syntheticApplyAllowed: true,
      syntheticOperatorScope: scope,
    },
  });
  delete process.env.SEPTEMBER_2026_APPLY_GRANT_REF;
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.receipt.commitStatus, "committed");
  const verifyPool = new Pool({ connectionString: url });
  const check = await verifyPool.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM onec_v3_legal_sales_lines WHERE sale_month = '2026-09-01'::date`,
  );
  assert.equal(Number(check.rows[0]?.n ?? 0), 1);
  await verifyPool.end();
});

it("one-shot apply: post-COMMIT read failure still reports committed (no rollback)", async () => {
  const snapDir = await mkdtemp(join(tmpdir(), "sep-snap-post-"));
  scratch.push(snapDir);
  const { buffers } = await writeSyntheticSeptemberSnapshot(snapDir);
  const pool = new Pool({ connectionString: url });
  await pool.query(`DELETE FROM onec_v3_legal_sale_item_lines WHERE sale_month = '2026-09-01'::date`);
  await pool.query(`DELETE FROM onec_v3_legal_return_item_lines WHERE sale_month = '2026-09-01'::date`);
  await pool.query(`DELETE FROM onec_v3_legal_return_lines WHERE sale_month = '2026-09-01'::date`);
  await pool.query(`DELETE FROM onec_v3_legal_sales_lines WHERE sale_month = '2026-09-01'::date`);
  await pool.query(`DELETE FROM onec_v3_legal_sales_month_activation WHERE sale_month = '2026-09-01'::date`);
  await pool.query(`DELETE FROM onec_v3_legal_sales_import_state WHERE id = 1`);
  await pool.query(`DELETE FROM onec_v3_legal_sale_item_import_state WHERE id = 1`);
  await pool.query(`DELETE FROM onec_v3_legal_return_import_state WHERE id = 1`);
  await pool.query(`DELETE FROM onec_v3_legal_return_item_import_state WHERE id = 1`);
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
    dir: join(snapDir, ".."),
    backup,
    scopeFileSha256: "synthetic",
  });
  process.env.SEPTEMBER_2026_APPLY_GRANT_REF = "synthetic-apply-grant";
  delete process.env.TEST_DATABASE_URL;
  const r = await runSeptember2026OneShotApply({
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
      skipBackupPayloadPathSecurity: true,
      skipNightlySchedulerPin: true,
      syntheticApplyAllowed: true,
      syntheticOperatorScope: scope,
      injectPostCommitReadFailure: true,
    },
  });
  delete process.env.SEPTEMBER_2026_APPLY_GRANT_REF;
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.receipt.commitStatus, "committed");
  assert.equal(r.receipt.postCommitVerifyOk, false);
  assert.notEqual(r.receipt.expectedAfterStateDigest, null);
});
