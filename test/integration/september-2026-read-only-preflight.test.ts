import assert from "node:assert/strict";
import { after, before, it } from "node:test";
import { Pool } from "pg";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resetPoolForTests, closePool } from "../../src/db/pool";
import { getIntegrationDatabaseUrl, prepareDatabase, setIntegrationEnv } from "../helpers/test-db";
import { LEGAL_A, LEGAL_B } from "../helpers/legal-sales-fixtures";
import { runSeptember2026ReadOnlyPreflight } from "../../src/onec-sales/september-2026-one-shot/read-only-preflight-core";
import { parseSeptemberReadOnlyRuntimeConfig } from "../../src/onec-sales/september-2026-one-shot/read-only-preflight-runtime-config";
import { EXPECTED_SOURCE_FILES } from "../../src/onec-sales/september-2026-one-shot/scope-pins";
import type { SeptemberSourceBuffers } from "../../src/onec-sales/september-2026-one-shot/source-pins";

let url: string;

function fourDummySources(): SeptemberSourceBuffers {
  return {
    saleAggregate: Buffer.from("not-pinned"),
    saleItems: Buffer.from("not-pinned"),
    returnsAggregate: Buffer.from("not-pinned"),
    returnItems: Buffer.from("not-pinned"),
  };
}

before(async () => {
  url = getIntegrationDatabaseUrl();
  setIntegrationEnv(url);
  await resetPoolForTests();
  await prepareDatabase(url);
  const pool = new Pool({ connectionString: url });
  await pool.query(
    `INSERT INTO onec_v3_legal_entities (guid_client,name_client,type_category,other_fields,last_source_sha256)
     VALUES ($1::uuid,'SecretNameA','{}'::jsonb,'{}'::jsonb,'test'),($2::uuid,'SecretNameB','{}'::jsonb,'{}'::jsonb,'test')
     ON CONFLICT DO NOTHING`,
    [LEGAL_A, LEGAL_B],
  );
  await pool.end();
});

after(async () => {
  await closePool();
});

it("read-only: missing runtime source fails before success", () => {
  const r = parseSeptemberReadOnlyRuntimeConfig({
    v: 1,
    databaseUrl: "postgres://example",
    sources: {
      saleAggregate: { path: EXPECTED_SOURCE_FILES.saleAggregate.path, contentBase64: Buffer.from("x").toString("base64") },
    },
  });
  assert.equal(r.ok, false);
  assert.equal(r.code, "SOURCE_INPUT_MISSING");
});

it("read-only: TEST_DATABASE_URL blocked without explicit testContext", async () => {
  process.env.TEST_DATABASE_URL = url;
  const r = await runSeptember2026ReadOnlyPreflight({
    databaseUrl: url,
    sources: fourDummySources(),
  });
  delete process.env.TEST_DATABASE_URL;
  assert.equal(r.ok, false);
  assert.equal(r.code, "TEST_DATABASE_URL_NOT_ALLOWED");
});

it("read-only: wrong target fingerprint stops before catalog/before reads", async () => {
  const r = await runSeptember2026ReadOnlyPreflight({
    databaseUrl: url,
    sources: fourDummySources(),
    testContext: { allowNonProductionDatabaseUrl: true },
  });
  assert.equal(r.ok, false);
  assert.equal(r.code, "TARGET_FINGERPRINT_MISMATCH");
  assert.equal(r.report.catalog.code, "NOT_RUN_WRONG_TARGET");
  assert.equal(r.report.beforeStateDigest, null);
  assert.equal(r.report.jobState, null);
});

it("read-only: wrong source SHA fails with all four pins attempted", async () => {
  const r = await runSeptember2026ReadOnlyPreflight({
    databaseUrl: url,
    sources: fourDummySources(),
    testContext: {
      allowNonProductionDatabaseUrl: true,
      skipTargetFingerprintPin: true,
      skipCatalogPin: true,
    },
  });
  assert.equal(r.ok, false);
  assert.match(r.code, /SOURCE_/);
  assert.equal(r.report.sources.saleAggregate.ok, false);
});

it("read-only: report JSON is sanitized (no entity names or row payloads)", async () => {
  const r = await runSeptember2026ReadOnlyPreflight({
    databaseUrl: url,
    sources: fourDummySources(),
    testContext: {
      allowNonProductionDatabaseUrl: true,
      skipTargetFingerprintPin: true,
      skipCatalogPin: true,
      skipSourcePinChecks: true,
    },
  });
  const text = JSON.stringify(r.report);
  assert.equal(text.includes("SecretNameA"), false);
  assert.equal(text.includes("SecretNameB"), false);
  assert.equal(text.includes("saleAggregateLinesJson"), false);
  assert.equal(r.report.readOnlyProof.noPersistence, true);
  assert.equal(r.report.appReleaseRef.kind, "compatibility_constraint");
});

it("read-only: SYNTHETIC_HARNESS env rejected on production entry", async () => {
  process.env.SEPTEMBER_2026_SYNTHETIC_HARNESS = "1";
  const r = await runSeptember2026ReadOnlyPreflight({
    databaseUrl: "postgres://runtime/production",
    sources: fourDummySources(),
  });
  delete process.env.SEPTEMBER_2026_SYNTHETIC_HARNESS;
  assert.equal(r.ok, false);
  assert.equal(r.code, "OPERATOR_BYPASS_FORBIDDEN");
});

it("read-only: executable .cjs bundle SHA is reproducible", async () => {
  const bundlePath = join(process.cwd(), "operator-bundles/september-2026-one-shot-operator.cjs");
  const bytes = readFileSync(bundlePath);
  const sha = createHash("sha256").update(bytes).digest("hex");
  const again = createHash("sha256").update(readFileSync(bundlePath)).digest("hex");
  assert.equal(sha, again);
  assert.match(sha, /^[a-f0-9]{64}$/);
});
