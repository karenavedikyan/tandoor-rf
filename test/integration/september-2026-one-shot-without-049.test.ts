import assert from "node:assert/strict";
import { after, before, it } from "node:test";
import { Pool, type PoolClient } from "pg";
import { chmod, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resetPoolForTests, closePool } from "../../src/db/pool";
import { getIntegrationDatabaseUrl, prepareDatabase, setIntegrationEnv } from "../helpers/test-db";
import { LEGAL_A, LEGAL_B } from "../helpers/legal-sales-fixtures";
import { runSeptember2026OneShotApply } from "../../src/onec-sales/september-2026-one-shot/one-shot-apply-core";
import { runSeptember2026OneShotRollback } from "../../src/onec-sales/september-2026-one-shot/one-shot-rollback-core";
import { captureSeptember047048BeforeState } from "../../src/onec-sales/september-2026-one-shot/before-state-047-048";
import { readTargetDbIdentityFromClient } from "../../src/onec-exchange-v3/target-db-identity";
import { captureSeptember047048Backup } from "../../src/onec-sales/september-2026-one-shot/backup";
import { loadKnownLegalGuidSet } from "../../src/onec-sales/matched-only/catalog";
import {
  buildSyntheticOperatorScope,
  writeSyntheticSeptemberSnapshot,
  writeSyntheticVerifiedBackupReceiptPair,
} from "../helpers/september-2026-synthetic-fixtures";

const FORBIDDEN_049_TABLES = [
  "onec_v3_legal_sales_import_quarantine_rows",
  "onec_v3_legal_sales_import_month_stats",
  "onec_v3_legal_sales_bundle_apply_runs",
] as const;

const SYNTHETIC_EXT_AUTH = "synthetic-test-not-human-consent";

let url: string;
const scratch: string[] = [];

async function drop049SidecarTables(pool: Pool): Promise<void> {
  for (const table of FORBIDDEN_049_TABLES) {
    await pool.query(`DROP TABLE IF EXISTS ${table} CASCADE`);
  }
}

async function assertTablesAbsent(pool: Pool): Promise<void> {
  for (const table of FORBIDDEN_049_TABLES) {
    const r = await pool.query<{ reg: string | null }>(`SELECT to_regclass($1) AS reg`, [table]);
    assert.equal(r.rows[0]?.reg, null, `${table} must be absent`);
  }
}

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
  await drop049SidecarTables(pool);
  await assertTablesAbsent(pool);
  await pool.end();
});

after(async () => {
  await closePool();
  for (const d of scratch) await rm(d, { recursive: true, force: true });
});

it("one-shot apply/rollback: succeeds with migration 049 sidecar tables absent (production schema)", async () => {
  const pool = new Pool({ connectionString: url });
  await assertTablesAbsent(pool);

  const { workDir, snapDir } = await mkPrivateBackupWorkDir("sep-no049-");
  const { buffers } = await writeSyntheticSeptemberSnapshot(snapDir);
  await pool.query(`DELETE FROM onec_v3_legal_sales_lines WHERE sale_month = '2026-09-01'::date`);
  const client = await pool.connect();
  const identity = await readTargetDbIdentityFromClient(client, url);
  const before = await captureSeptember047048BeforeState(client);
  const known = await loadKnownLegalGuidSet(client);
  const backup = await captureSeptember047048Backup(client, identity.fingerprint);
  client.release();

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
  assert.equal(rollback.ok, true, JSON.stringify(rollback));
  assert.equal(rollback.receipt.restoredBeforeStateDigest, before.digest);

  const check = await pool.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM onec_v3_legal_sales_lines WHERE sale_month = '2026-09-01'::date`,
  );
  assert.equal(Number(check.rows[0]?.n ?? 0), 0);

  delete process.env.SEPTEMBER_2026_APPLY_GRANT_REF;
  delete process.env.SEPTEMBER_2026_ROLLBACK_GRANT_REF;
  delete process.env.SEPTEMBER_2026_EXTERNAL_AUTHORIZATION_REF;
  delete process.env.SEPTEMBER_2026_BACKUP_PRIVATE_ROOT;
  await pool.end();
});

it("buildMatchedOnlyBundlePlan trusted before-state: no SQL references 049 tables", async () => {
  const { buildMatchedOnlyBundlePlan } = await import("../../src/onec-sales/matched-only/plan-build");
  const { parseSeptemberSourceRosters } = await import("../../src/onec-sales/september-2026-one-shot/source-pins");
  const pool = new Pool({ connectionString: url });
  await drop049SidecarTables(pool);
  const snapDir = await mkdtemp(join(tmpdir(), "sep-plan-no049-"));
  scratch.push(snapDir);
  const { buffers } = await writeSyntheticSeptemberSnapshot(snapDir);
  const rosters = parseSeptemberSourceRosters(buffers);
  const client = await pool.connect();
  await client.query("BEGIN");
  const identity = await readTargetDbIdentityFromClient(client, url);
  const before = await captureSeptember047048BeforeState(client);

  const origQuery = client.query.bind(client);
  client.query = ((...args: Parameters<PoolClient["query"]>) => {
    const sql = typeof args[0] === "string" ? args[0] : (args[0] as { text?: string })?.text ?? "";
    for (const table of FORBIDDEN_049_TABLES) {
      assert.ok(!sql.includes(table), `plan build must not query ${table}`);
    }
    return origQuery(...args);
  }) as PoolClient["query"];

  const { plan } = await buildMatchedOnlyBundlePlan(
    client,
    {
      ...rosters,
      targetDbFingerprint: identity.fingerprint,
    },
    { trustedBeforeStateSha256: before.digest },
  );
  assert.equal(plan.beforeStateSha256, before.digest);
  await client.query("ROLLBACK");
  client.release();
  await pool.end();
});
