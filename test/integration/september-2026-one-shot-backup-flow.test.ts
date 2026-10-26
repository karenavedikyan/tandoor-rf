import assert from "node:assert/strict";
import { after, before, it } from "node:test";
import { Pool } from "pg";
import { chmod, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { resetPoolForTests, closePool } from "../../src/db/pool";
import { getIntegrationDatabaseUrl, prepareDatabase, setIntegrationEnv } from "../helpers/test-db";
import { LEGAL_A, LEGAL_B } from "../helpers/legal-sales-fixtures";
import { runSeptember2026OneShotBackup } from "../../src/onec-sales/september-2026-one-shot/one-shot-backup-core";
import { runSeptember2026OneShotApply } from "../../src/onec-sales/september-2026-one-shot/one-shot-apply-core";
import { readTargetDbIdentityFromClient } from "../../src/onec-exchange-v3/target-db-identity";
import { loadKnownLegalGuidSet } from "../../src/onec-sales/matched-only/catalog";
import {
  buildSyntheticOperatorScope,
  writeSyntheticSeptemberSnapshot,
} from "../helpers/september-2026-synthetic-fixtures";
import { runSeptember2026BackupToPrivateFile } from "../../src/onec-sales/september-2026-one-shot/backup";
import { verifySeptember047048BackupPayloadBinding } from "../../src/onec-sales/september-2026-one-shot/backup-payload-verify";
import { operatorDataScopeSha256 } from "../../src/onec-sales/september-2026-one-shot/operator-data-scope";

let url: string;
const scratch: string[] = [];

async function privateRoot(dir: string): Promise<string> {
  await chmod(dir, 0o700);
  return dir;
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
  delete process.env.SEPTEMBER_2026_EXTERNAL_AUTHORIZATION_REF;
  delete process.env.SEPTEMBER_2026_BACKUP_GRANT_REF;
  delete process.env.SEPTEMBER_2026_BACKUP_PRIVATE_ROOT;
  delete process.env.SEPTEMBER_2026_APPLY_GRANT_REF;
});

it("backup publish: file SHA matches payload verifier (not compact JSON digest)", async () => {
  const root = await privateRoot(await mkdtemp(join(tmpdir(), "sep-backup-sha-")));
  scratch.push(root);
  const pool = new Pool({ connectionString: url });
  const client = await pool.connect();
  const identity = await readTargetDbIdentityFromClient(client, url);
  process.env.SEPTEMBER_2026_EXTERNAL_AUTHORIZATION_REF = "synthetic-test-not-human-consent";
  delete process.env.TEST_DATABASE_URL;
  const dest = join(root, "payload.json");
  const published = await runSeptember2026BackupToPrivateFile({
    client,
    targetDbFingerprint: identity.fingerprint,
    destinationPath: dest,
    approvedPrivateRoot: root,
  });
  client.release();
  await pool.end();
  assert.equal(published.ok, true);
  const bytes = await readFile(dest);
  const fileSha = createHash("sha256").update(bytes).digest("hex");
  assert.equal(published.fileSha256, fileSha);
  const backup = JSON.parse(bytes.toString("utf8"));
  const compactSha = createHash("sha256").update(JSON.stringify(backup), "utf8").digest("hex");
  assert.notEqual(published.fileSha256, compactSha);
  const verify = await verifySeptember047048BackupPayloadBinding({
    backupPayloadFilePath: dest,
    expectedPayloadSha256: published.fileSha256,
    targetDbFingerprint: identity.fingerprint,
    beforeStateSha256: backup.beforeStateSha256,
    approvedPrivateRoot: root,
  });
  assert.equal(verify.ok, true);
});

it("backup flow: one-shot backup then apply via same cores with private root", async () => {
  const workDir = await privateRoot(await mkdtemp(join(tmpdir(), "sep-backup-apply-")));
  scratch.push(workDir);
  const snapDir = join(workDir, "snapshot");
  const { buffers } = await writeSyntheticSeptemberSnapshot(snapDir);
  const pool = new Pool({ connectionString: url });
  await pool.query(`DELETE FROM onec_v3_legal_sales_lines WHERE sale_month = '2026-09-01'::date`);
  const client = await pool.connect();
  const identity = await readTargetDbIdentityFromClient(client, url);
  const known = await loadKnownLegalGuidSet(client);
  const { captureSeptember047048BeforeState } = await import(
    "../../src/onec-sales/september-2026-one-shot/before-state-047-048"
  );
  const before = await captureSeptember047048BeforeState(client);
  client.release();
  await pool.end();
  const scope = buildSyntheticOperatorScope({
    beforeStateDigest: before.digest,
    known,
    buffers,
    applyAuthorized: true,
    targetFingerprint: identity.fingerprint,
  });
  const scopePath = join(workDir, "scope.json");
  const scopeBytes = JSON.stringify(scope);
  await writeFile(scopePath, scopeBytes, { mode: 0o600 });
  const scopeSha = operatorDataScopeSha256(Buffer.from(scopeBytes, "utf8"));
  process.env.SEPTEMBER_2026_EXTERNAL_AUTHORIZATION_REF = "synthetic-test-not-human-consent";
  process.env.SEPTEMBER_2026_BACKUP_GRANT_REF = "synthetic-backup-grant";
  process.env.SEPTEMBER_2026_BACKUP_PRIVATE_ROOT = workDir;
  delete process.env.TEST_DATABASE_URL;
  const backup = await runSeptember2026OneShotBackup({
    databaseUrl: url,
    operatorDataScopePath: scopePath,
    operatorDataScopeSha256: scopeSha,
    backupGrantRef: "synthetic-backup-grant",
    backupPayloadDestinationPath: join(workDir, "payload.json"),
    backupReceiptDestinationPath: join(workDir, "receipt.json"),
    approvedPrivateRoot: workDir,
    testContext: {
      allowNonProductionDatabaseUrl: true,
      skipTargetFingerprintPin: true,
      skipCatalogPin: true,
      skipBeforeDigestPin: true,
      skipNightlySchedulerPin: true,
      skipOperatorDataScopeShaPin: true,
    },
  });
  assert.equal(backup.ok, true, JSON.stringify(backup));
  process.env.SEPTEMBER_2026_APPLY_GRANT_REF = "synthetic-apply-grant";
  const apply = await runSeptember2026OneShotApply({
    databaseUrl: url,
    operatorDataScopePath: scopePath,
    operatorDataScopeSha256: scopeSha,
    applyGrantRef: "synthetic-apply-grant",
    backupReceiptSha256: backup.result.backupReceiptSha256,
    backupReceiptFilePath: backup.result.backupReceiptPath,
    backupPayloadFilePath: backup.result.backupPayloadPath,
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
      syntheticApplyAllowed: true,
      syntheticOperatorScope: scope,
    },
  });
  assert.equal(apply.ok, true, JSON.stringify(apply));
});

it("apply: missing BACKUP_PRIVATE_ROOT refuses outside test bypass", async () => {
  delete process.env.SEPTEMBER_2026_BACKUP_PRIVATE_ROOT;
  const r = await verifySeptember047048BackupPayloadBinding({
    backupPayloadFilePath: "/tmp/nope",
    expectedPayloadSha256: "a".repeat(64),
    targetDbFingerprint: "b".repeat(64),
    beforeStateSha256: "c".repeat(64),
  });
  assert.equal(r.ok, false);
  assert.equal(r.code, "BACKUP_PRIVATE_ROOT_REQUIRED");
});

it("backup private root: symlink root refuses publish", async () => {
  const real = await privateRoot(await mkdtemp(join(tmpdir(), "sep-root-real-")));
  const linkParent = await mkdtemp(join(tmpdir(), "sep-root-link-parent-"));
  scratch.push(real, linkParent);
  const link = join(linkParent, "linked-root");
  await symlink(real, link);
  const pool = new Pool({ connectionString: url });
  const client = await pool.connect();
  const identity = await readTargetDbIdentityFromClient(client, url);
  process.env.SEPTEMBER_2026_EXTERNAL_AUTHORIZATION_REF = "synthetic-test-not-human-consent";
  delete process.env.TEST_DATABASE_URL;
  const r = await runSeptember2026BackupToPrivateFile({
    client,
    targetDbFingerprint: identity.fingerprint,
    destinationPath: join(link, "payload.json"),
    approvedPrivateRoot: link,
  });
  client.release();
  await pool.end();
  assert.equal(r.ok, false);
  assert.equal(r.code, "BACKUP_PRIVATE_ROOT_SYMLINK");
});

it("backup private root: mode 0755 refuses publish", async () => {
  const root = await mkdtemp(join(tmpdir(), "sep-root-755-"));
  scratch.push(root);
  await chmod(root, 0o755);
  const pool = new Pool({ connectionString: url });
  const client = await pool.connect();
  const identity = await readTargetDbIdentityFromClient(client, url);
  process.env.SEPTEMBER_2026_EXTERNAL_AUTHORIZATION_REF = "synthetic-test-not-human-consent";
  delete process.env.TEST_DATABASE_URL;
  const r = await runSeptember2026BackupToPrivateFile({
    client,
    targetDbFingerprint: identity.fingerprint,
    destinationPath: join(root, "payload.json"),
    approvedPrivateRoot: root,
  });
  client.release();
  await pool.end();
  assert.equal(r.ok, false);
  assert.match(r.code, /BACKUP_PRIVATE_ROOT|BACKUP_DESTINATION/);
});
