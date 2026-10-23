import assert from "node:assert/strict";
import { after, before, it } from "node:test";
import { Pool } from "pg";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resetPoolForTests, closePool } from "../../src/db/pool";
import { getIntegrationDatabaseUrl, prepareDatabase, setIntegrationEnv } from "../helpers/test-db";
import { LEGAL_A, LEGAL_B } from "../helpers/legal-sales-fixtures";
import { runSeptember2026OneShotApply } from "../../src/onec-sales/september-2026-one-shot/one-shot-apply-core";
import { executeSeptember2026Apply } from "../../src/onec-sales/september-2026-one-shot/execute-apply";
import { captureSeptember047048BeforeState } from "../../src/onec-sales/september-2026-one-shot/before-state-047-048";
import { readTargetDbIdentityFromClient } from "../../src/onec-exchange-v3/target-db-identity";
import {
  buildSyntheticOperatorScope,
  writeSyntheticSeptemberSnapshot,
} from "../helpers/september-2026-synthetic-fixtures";
import { loadKnownLegalGuidSet } from "../../src/onec-sales/matched-only/catalog";

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

it("one-shot apply: production entry is fail-closed (APPLY_NOT_AUTHORIZED)", async () => {
  const saved = process.env.TEST_DATABASE_URL;
  delete process.env.TEST_DATABASE_URL;
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

it("one-shot apply: wrong target fingerprint fails before business writes", async () => {
  const savedTestUrl = process.env.TEST_DATABASE_URL;
  delete process.env.TEST_DATABASE_URL;
  process.env.SEPTEMBER_2026_APPLY_GRANT_REF = "x";
  const snapDir = await mkdtemp(join(tmpdir(), "sep-snap-wrong-"));
  scratch.push(snapDir);
  const { buffers } = await writeSyntheticSeptemberSnapshot(snapDir);
  const r = await runSeptember2026OneShotApply({
    databaseUrl: url,
    operatorDataScopePath: join(snapDir, "scope.json"),
    operatorDataScopeSha256: "x",
    applyGrantRef: "x",
    backupReceiptSha256: "b",
    snapshotDirectory: snapDir,
    testContext: {
      allowNonProductionDatabaseUrl: true,
      syntheticApplyAllowed: true,
      skipSnapshotManifestSha: true,
      syntheticOperatorScope: buildSyntheticOperatorScope({
        beforeStateDigest: "x",
        known: new Set([LEGAL_A.toLowerCase(), LEGAL_B.toLowerCase()]),
        buffers,
        applyAuthorized: true,
        targetFingerprint: "wrong",
      }),
    },
  });
  assert.equal(r.ok, false);
  assert.equal(r.code, "TARGET_FINGERPRINT_MISMATCH");
  delete process.env.SEPTEMBER_2026_APPLY_GRANT_REF;
  if (savedTestUrl) process.env.TEST_DATABASE_URL = savedTestUrl;
});

it("one-shot apply: synthetic core path commits matched rows", async () => {
  const snapDir = await mkdtemp(join(tmpdir(), "sep-snap-"));
  scratch.push(snapDir);
  const { buffers } = await writeSyntheticSeptemberSnapshot(snapDir);
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
    buffers,
    applyAuthorized: true,
    targetFingerprint: identity.fingerprint,
  });
  process.env.SEPTEMBER_2026_APPLY_GRANT_REF = "synthetic-apply-grant";
  delete process.env.TEST_DATABASE_URL;
  const r = await runSeptember2026OneShotApply({
    databaseUrl: url,
    operatorDataScopePath: join(snapDir, "scope.json"),
    operatorDataScopeSha256: "synthetic",
    applyGrantRef: "synthetic-apply-grant",
    backupReceiptSha256: "synthetic-backup-receipt",
    snapshotDirectory: snapDir,
    testContext: {
      allowNonProductionDatabaseUrl: true,
      skipTargetFingerprintPin: true,
      skipCatalogPin: true,
      skipBeforeDigestPin: true,
      skipSnapshotManifestSha: true,
      syntheticApplyAllowed: true,
      syntheticOperatorScope: scope,
    },
  });
  delete process.env.SEPTEMBER_2026_APPLY_GRANT_REF;
  assert.equal(r.ok, true, JSON.stringify(r));
  const verifyPool = new Pool({ connectionString: url });
  const check = await verifyPool.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM onec_v3_legal_sales_lines WHERE sale_month = '2026-09-01'::date`,
  );
  assert.equal(Number(check.rows[0]?.n ?? 0), 1);
  await verifyPool.end();
});
