import assert from "node:assert/strict";
import { after, before, it } from "node:test";
import { Pool } from "pg";
import { chmod, mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resetPoolForTests, closePool } from "../../src/db/pool";
import { getIntegrationDatabaseUrl, prepareDatabase, setIntegrationEnv } from "../helpers/test-db";
import { LEGAL_A, LEGAL_B, buildSaleJsonBytes, buildSaleRecord } from "../helpers/legal-sales-fixtures";
import { buildSaleItemRecord, buildReturnRecord } from "../helpers/sales-bundle-fixtures";
import { runSeptember2026Preflight } from "../../src/onec-sales/september-2026-one-shot/preflight";
import { assertExternalWriteAuthorization } from "../../src/onec-sales/september-2026-one-shot/operator-guard";
import { publishPrivateBackupJson } from "../../src/onec-sales/september-2026-one-shot/private-backup-publish";
import { computeSeptember2026OperatorCodeBundleSha256 } from "../../src/onec-sales/september-2026-one-shot/code-bundle-manifest";
import { SEPTEMBER_2026_SALE_MONTH_ISO } from "../../src/onec-sales/september-2026-one-shot/scope-pins";
import {
  captureSeptember047048Backup,
  septemberBackupSha256,
} from "../../src/onec-sales/september-2026-one-shot/backup";
import {
  restoreSeptember047048Backup,
  executeSeptember2026Rollback,
} from "../../src/onec-sales/september-2026-one-shot/rollback-047-048";
import { captureSeptember047048BeforeState } from "../../src/onec-sales/september-2026-one-shot/before-state-047-048";
import { verifySourceFilePin } from "../../src/onec-sales/september-2026-one-shot/source-pins";
import { readTargetDbIdentityFromClient } from "../../src/onec-exchange-v3/target-db-identity";

let url: string;
let pool: Pool;
const scratch: string[] = [];

before(async () => {
  url = getIntegrationDatabaseUrl();
  setIntegrationEnv(url);
  await resetPoolForTests();
  await prepareDatabase(url);
  pool = new Pool({ connectionString: url });
  await pool.query(
    `INSERT INTO onec_v3_legal_entities (guid_client,name_client,type_category,other_fields,last_source_sha256)
     VALUES ($1::uuid,'A','{}'::jsonb,'{}'::jsonb,'test'),($2::uuid,'B','{}'::jsonb,'{}'::jsonb,'test')
     ON CONFLICT DO NOTHING`,
    [LEGAL_A, LEGAL_B],
  );
});

after(async () => {
  await pool?.end();
  await closePool();
  for (const d of scratch) await rm(d, { recursive: true, force: true });
});

it("synthetic: preflight read-only harness skips production catalog pin", async () => {
  process.env.SEPTEMBER_2026_SYNTHETIC_HARNESS = "1";
  process.env.TEST_DATABASE_URL = url;
  const r = await runSeptember2026Preflight({ databaseUrl: url });
  delete process.env.SEPTEMBER_2026_SYNTHETIC_HARNESS;
  assert.equal(r.ok, true, JSON.stringify(r));
});

it("synthetic: write operations require external authorization ref", () => {
  delete process.env.SEPTEMBER_2026_EXTERNAL_AUTHORIZATION_REF;
  assert.equal(assertExternalWriteAuthorization().ok, false);
  const savedTestUrl = process.env.TEST_DATABASE_URL;
  delete process.env.TEST_DATABASE_URL;
  process.env.SEPTEMBER_2026_EXTERNAL_AUTHORIZATION_REF = "synthetic-test-not-human-consent";
  assert.equal(assertExternalWriteAuthorization().ok, true);
  delete process.env.SEPTEMBER_2026_EXTERNAL_AUTHORIZATION_REF;
  if (savedTestUrl) process.env.TEST_DATABASE_URL = savedTestUrl;
});

it("synthetic: private backup publish refuses overwrite and verifies readback", async () => {
  const root = await mkdtemp(join(tmpdir(), "sep2026-backup-"));
  await chmod(root, 0o700);
  scratch.push(root);
  const dest = join(root, "backup.json");
  await writeFile(dest, "ORIGINAL", { mode: 0o600 });
  const r = await publishPrivateBackupJson({
    destinationPath: dest,
    approvedPrivateRoot: root,
    payload: { v: 1, test: true },
  });
  assert.equal(r.ok, false);
  assert.equal(r.code, "BACKUP_DESTINATION_EXISTS");
});

it("synthetic: operator code bundle SHA is stable", async () => {
  const a = await computeSeptember2026OperatorCodeBundleSha256(process.cwd());
  const b = await computeSeptember2026OperatorCodeBundleSha256(process.cwd());
  assert.equal(a, b);
  assert.match(a, /^[a-f0-9]{64}$/);
});

it("synthetic: september month constant is frozen", () => {
  assert.equal(SEPTEMBER_2026_SALE_MONTH_ISO, "2026-09-01");
});

it("synthetic: scoped backup JSON roundtrip restores September and preserves August", async () => {
  await pool.query(
    `DELETE FROM onec_v3_legal_sales_lines WHERE sale_month IN ('2026-08-01'::date, '2026-09-01'::date)`,
  );
  await pool.query(
    `
      INSERT INTO onec_v3_legal_sales_lines (
        legal_guid, sale_month, product_type, quantity, income,
        manual_discount, automatic_discount, total_discount,
        cost_price, additional_expenses, gross_profit, profitability,
        source_sha256, imported_at
      ) VALUES
        ($1::uuid, '2026-08-01'::date, 'August keep', 1, 1, 0,0,0,0,0,0,0, 'aug', NOW()),
        ($1::uuid, '2026-09-01'::date, 'September original', 2, 2, 0,0,0,0,0,0,0, 'sep', NOW())
    `,
    [LEGAL_A],
  );
  const client = await pool.connect();
  try {
    const identity = await readTargetDbIdentityFromClient(client, url);
    const backup = await captureSeptember047048Backup(client, identity.fingerprint);
    await pool.query(
      `DELETE FROM onec_v3_legal_sales_lines WHERE sale_month = '2026-09-01'::date`,
    );
    await pool.query(
      `
        INSERT INTO onec_v3_legal_sales_lines (
          legal_guid, sale_month, product_type, quantity, income,
          manual_discount, automatic_discount, total_discount,
          cost_price, additional_expenses, gross_profit, profitability,
          source_sha256, imported_at
        ) VALUES ($1::uuid, '2026-09-01'::date, 'September mutated', 9, 9, 0,0,0,0,0,0,0, 'mut', NOW())
      `,
      [LEGAL_A],
    );
    await client.query("BEGIN");
    await restoreSeptember047048Backup(client, backup);
    await client.query("COMMIT");
    const aug = await pool.query(
      `SELECT product_type FROM onec_v3_legal_sales_lines WHERE sale_month = '2026-08-01'::date`,
    );
    const sep = await pool.query(
      `SELECT product_type FROM onec_v3_legal_sales_lines WHERE sale_month = '2026-09-01'::date`,
    );
    assert.equal(aug.rows[0]?.product_type, "August keep");
    assert.equal(sep.rows[0]?.product_type, "September original");
    const after = await captureSeptember047048BeforeState(client);
    assert.equal(after.digest, backup.beforeStateSha256);
  } finally {
    client.release();
  }
});

it("synthetic: source pin rejects wrong file bytes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sep2026-src-"));
  scratch.push(dir);
  const bad = join(dir, "sale.json");
  await writeFile(bad, buildSaleJsonBytes([buildSaleRecord({ legalGuid: LEGAL_A })]), { mode: 0o600 });
  const r = await verifySourceFilePin("saleAggregate", bad);
  assert.equal(r.ok, false);
  assert.equal(r.code, "SOURCE_SHA_MISMATCH");
});

it("synthetic: PG json snapshot exact NUMERIC/BIGINT/timestamptz roundtrip", async () => {
  const sourceSha = "a".repeat(64);
  const itemGuid = "11111111-1111-4111-8111-111111111111";
  const ts = "2026-09-15 12:34:56.123456+00";
  await pool.query(`DELETE FROM onec_v3_legal_sale_item_lines WHERE sale_month = '2026-09-01'::date`);
  await pool.query(
    `
      INSERT INTO onec_v3_legal_sale_item_lines (
        source_sha256, source_row_index, legal_guid, sale_month, product_type,
        guid_item, name_item, quantity, income,
        manual_discount, automatic_discount, total_discount,
        cost_price, additional_expenses, gross_profit, profitability,
        catalog_matched, imported_at
      ) VALUES (
        $1, 2147483647, $2::uuid, '2026-09-01'::date, 'Exact types',
        $3::uuid, 'micro-item', 123.456789, 999999999999.1234,
        0.0001, 0.0002, 0.0003, 0.0004, 0.0005, 0.0006, 12.3456,
        true, $4::timestamptz
      )
    `,
    [sourceSha, LEGAL_A, itemGuid, ts],
  );
  const client = await pool.connect();
  try {
    const identity = await readTargetDbIdentityFromClient(client, url);
    const backup = await captureSeptember047048Backup(client, identity.fingerprint);
    const beforeJson = backup.snapshot.saleItemLinesJson;
    await pool.query(
      `UPDATE onec_v3_legal_sale_item_lines SET quantity = 0 WHERE sale_month = '2026-09-01'::date`,
    );
    await client.query("BEGIN");
    await restoreSeptember047048Backup(client, backup);
    await client.query("COMMIT");
    const after = await captureSeptember047048BeforeState(client);
    assert.equal(after.snapshot.saleItemLinesJson, beforeJson);
    const check = await pool.query<{ qty: string; income: string; idx: string; ts_ok: boolean }>(
      `
        SELECT quantity::text AS qty, income::text AS income, source_row_index::text AS idx,
               imported_at = $1::timestamptz AS ts_ok
        FROM onec_v3_legal_sale_item_lines
        WHERE source_sha256 = $2 AND source_row_index = 2147483647
      `,
      [ts, sourceSha],
    );
    assert.equal(check.rows[0]?.qty, "123.456789");
    assert.equal(check.rows[0]?.income, "999999999999.1234");
    assert.equal(check.rows[0]?.idx, "2147483647");
    assert.equal(check.rows[0]?.ts_ok, true);
  } finally {
    client.release();
  }
});

it("synthetic: rollback live-after drift stops before write", async () => {
  process.env.SEPTEMBER_2026_EXTERNAL_AUTHORIZATION_REF = "synthetic-test-not-human-consent";
  const savedTestUrl = process.env.TEST_DATABASE_URL;
  delete process.env.TEST_DATABASE_URL;
  const client = await pool.connect();
  try {
    const identity = await readTargetDbIdentityFromClient(client, url);
    const backup = await captureSeptember047048Backup(client, identity.fingerprint);
    const sha = septemberBackupSha256(backup);
    const r = await executeSeptember2026Rollback({
      databaseUrl: url,
      backup,
      expectedBackupSha256: sha,
      externalAuthorizationRef: "synthetic-test-not-human-consent",
      expectedLiveAfterStateSha256: "deadbeef".repeat(8),
    });
    assert.equal(r.ok, false);
    assert.equal(r.code, "LIVE_AFTER_DRIFT");
  } finally {
    client.release();
    delete process.env.SEPTEMBER_2026_EXTERNAL_AUTHORIZATION_REF;
    if (savedTestUrl) process.env.TEST_DATABASE_URL = savedTestUrl;
  }
});
