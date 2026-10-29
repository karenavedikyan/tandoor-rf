import assert from "node:assert/strict";
import { after, before, it } from "node:test";
import { Pool } from "pg";
import { chmod, mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { resetPoolForTests, closePool } from "../../src/db/pool";
import { getIntegrationDatabaseUrl, prepareDatabase, setIntegrationEnv } from "../helpers/test-db";
import { LEGAL_A, LEGAL_B } from "../helpers/legal-sales-fixtures";
import { captureSeptember047048Backup } from "../../src/onec-sales/september-2026-one-shot/backup";
import { readTargetDbIdentityFromClient } from "../../src/onec-exchange-v3/target-db-identity";
import {
  backupReceiptSha256,
  buildSeptemberBackupReceiptFromVerifiedPayload,
  verifySeptemberBackupReceiptForApply,
} from "../../src/onec-sales/september-2026-one-shot/backup-receipt-verify";
import {
  buildSyntheticOperatorScope,
  writeSyntheticSeptemberSnapshot,
  writeSyntheticVerifiedBackupReceiptPair,
} from "../helpers/september-2026-synthetic-fixtures";
import { loadKnownLegalGuidSet } from "../../src/onec-sales/matched-only/catalog";
import { captureSeptember047048BeforeState } from "../../src/onec-sales/september-2026-one-shot/before-state-047-048";

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

it("backup receipt: metadata-only receipt with fake payload SHA fails without payload file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sep-backup-meta-"));
  scratch.push(dir);
  const receipt = buildSeptemberBackupReceiptFromVerifiedPayload({
    targetDbFingerprint: "a".repeat(64),
    scopeFileSha256: "b".repeat(64),
    beforeStateSha256: "c".repeat(64),
    backupPayloadFileSha256: "f".repeat(64),
  });
  const receiptText = JSON.stringify(receipt);
  const receiptPath = join(dir, "receipt.json");
  await writeFile(receiptPath, receiptText, { mode: 0o600 });
  const receiptSha = createHash("sha256").update(receiptText, "utf8").digest("hex");
  const scope = buildSyntheticOperatorScope({
    beforeStateDigest: receipt.beforeStateSha256,
    known: new Set([LEGAL_A.toLowerCase()]),
    buffers: (await writeSyntheticSeptemberSnapshot(join(dir, "snap"))).buffers,
    applyAuthorized: true,
    targetFingerprint: receipt.targetDbFingerprint,
  });
  const r = await verifySeptemberBackupReceiptForApply({
    receiptFilePath: receiptPath,
    expectedReceiptSha256: receiptSha,
    backupPayloadFilePath: join(dir, "missing-backup.json"),
    scope,
    scopeFileSha256: receipt.operatorDataScopeSha256,
    liveTargetFingerprint: receipt.targetDbFingerprint,
    liveBeforeStateDigest: receipt.beforeStateSha256,
    skipBackupPayloadPathSecurity: true,
  });
  assert.equal(r.ok, false);
  assert.equal(r.code, "BACKUP_PAYLOAD_FILE_MISSING");
});

it("backup receipt: wrong payload bytes refuse binding", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sep-backup-wrong-"));
  await chmod(dir, 0o700);
  scratch.push(dir);
  const pool = new Pool({ connectionString: url });
  const client = await pool.connect();
  const identity = await readTargetDbIdentityFromClient(client, url);
  const backup = await captureSeptember047048Backup(client, identity.fingerprint);
  client.release();
  await pool.end();
  const pair = await writeSyntheticVerifiedBackupReceiptPair({
    dir,
    approvedPrivateRoot: dir,
    backup,
    scopeFileSha256: "synthetic-scope",
  });
  const payloadPath = join(dir, "tampered.json");
  await writeFile(payloadPath, '{"v":1,"kind":"tampered"}\n', { mode: 0o600 });
  const scope = buildSyntheticOperatorScope({
    beforeStateDigest: backup.beforeStateSha256,
    known: new Set([LEGAL_A.toLowerCase(), LEGAL_B.toLowerCase()]),
    buffers: (await writeSyntheticSeptemberSnapshot(join(dir, "snap2"))).buffers,
    applyAuthorized: true,
    targetFingerprint: identity.fingerprint,
  });
  const r = await verifySeptemberBackupReceiptForApply({
    receiptFilePath: pair.receiptPath,
    expectedReceiptSha256: pair.receiptSha256,
    backupPayloadFilePath: payloadPath,
    scope,
    scopeFileSha256: "synthetic-scope",
    liveTargetFingerprint: identity.fingerprint,
    liveBeforeStateDigest: backup.beforeStateSha256,
    approvedPrivateBackupRoot: dir,
  });
  assert.equal(r.ok, false);
  assert.equal(r.code, "BACKUP_PAYLOAD_SHA_MISMATCH");
});

it("backup receipt: payload before digest mismatch refuses", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sep-backup-before-"));
  await chmod(dir, 0o700);
  scratch.push(dir);
  const pool = new Pool({ connectionString: url });
  const client = await pool.connect();
  const identity = await readTargetDbIdentityFromClient(client, url);
  const backup = await captureSeptember047048Backup(client, identity.fingerprint);
  client.release();
  await pool.end();
  const pair = await writeSyntheticVerifiedBackupReceiptPair({
    dir,
    approvedPrivateRoot: dir,
    backup,
    scopeFileSha256: "synthetic-scope",
  });
  const scope = buildSyntheticOperatorScope({
    beforeStateDigest: backup.beforeStateSha256,
    known: new Set([LEGAL_A.toLowerCase(), LEGAL_B.toLowerCase()]),
    buffers: (await writeSyntheticSeptemberSnapshot(join(dir, "snap3"))).buffers,
    applyAuthorized: true,
    targetFingerprint: identity.fingerprint,
  });
  const r = await verifySeptemberBackupReceiptForApply({
    receiptFilePath: pair.receiptPath,
    expectedReceiptSha256: pair.receiptSha256,
    backupPayloadFilePath: pair.backupPayloadPath,
    scope,
    scopeFileSha256: "synthetic-scope",
    liveTargetFingerprint: identity.fingerprint,
    liveBeforeStateDigest: "deadbeef".repeat(8),
    approvedPrivateBackupRoot: dir,
  });
  assert.equal(r.ok, false);
  assert.match(r.code, /BACKUP_RECEIPT_BEFORE_LIVE|BACKUP_PAYLOAD_BEFORE/);
});

it("backup receipt: verified synthetic payload passes binding", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sep-backup-ok-"));
  scratch.push(dir);
  await chmod(dir, 0o700);
  const pool = new Pool({ connectionString: url });
  const client = await pool.connect();
  const identity = await readTargetDbIdentityFromClient(client, url);
  const before = await captureSeptember047048BeforeState(client);
  const backup = await captureSeptember047048Backup(client, identity.fingerprint);
  const known = await loadKnownLegalGuidSet(client);
  client.release();
  await pool.end();
  const pair = await writeSyntheticVerifiedBackupReceiptPair({
    dir,
    approvedPrivateRoot: dir,
    backup,
    scopeFileSha256: "synthetic-scope",
  });
  const scope = buildSyntheticOperatorScope({
    beforeStateDigest: before.digest,
    known,
    buffers: (await writeSyntheticSeptemberSnapshot(join(dir, "snap4"))).buffers,
    applyAuthorized: true,
    targetFingerprint: identity.fingerprint,
  });
  const r = await verifySeptemberBackupReceiptForApply({
    receiptFilePath: pair.receiptPath,
    expectedReceiptSha256: pair.receiptSha256,
    backupPayloadFilePath: pair.backupPayloadPath,
    scope,
    scopeFileSha256: "synthetic-scope",
    liveTargetFingerprint: identity.fingerprint,
    liveBeforeStateDigest: before.digest,
    approvedPrivateBackupRoot: dir,
  });
  assert.equal(r.ok, true);
  assert.equal(r.receipt.backupPayloadSha256, pair.backupPayloadSha256);
  assert.equal(backupReceiptSha256(r.receipt), pair.receiptSha256);
});
