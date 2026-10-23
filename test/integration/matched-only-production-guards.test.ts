import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { Pool } from "pg";
import { resetPoolForTests, closePool } from "../../src/db/pool";
import { getIntegrationDatabaseUrl, prepareDatabase, setIntegrationEnv } from "../helpers/test-db";
import { buildNotApprovedExecutionManifestTemplate } from "../../src/onec-sales/matched-only/production/manifest-template";
import { resolveProductionDatabaseUrl } from "../../src/onec-sales/matched-only/production/database-url";
import { runProductionPreflight } from "../../src/onec-sales/matched-only/production/preflight";
import { runProductionPreflightHarness } from "../../src/onec-sales/matched-only/production/harness";
import { resolveTargetDbIdentityFromUrl } from "../../src/onec-exchange-v3/target-db-identity";
import { EXPECTED_PRODUCTION_DB_FINGERPRINT } from "../../src/onec-sales/matched-only/production/target-policy";

describe("matched-only production executor guards", { concurrency: false }, () => {
  let url: string;
  let pool: Pool;

  before(async () => {
    url = getIntegrationDatabaseUrl();
    setIntegrationEnv(url);
    await resetPoolForTests();
    await prepareDatabase(url);
    pool = new Pool({ connectionString: url });
  });

  after(async () => {
    await pool?.end();
    await closePool();
  });

  it("rejects production DATABASE_URL equal to TEST_DATABASE_URL", () => {
    const prevDb = process.env.DATABASE_URL;
    const prevTest = process.env.TEST_DATABASE_URL;
    process.env.DATABASE_URL = url;
    process.env.TEST_DATABASE_URL = url;
    const result = resolveProductionDatabaseUrl();
    process.env.DATABASE_URL = prevDb;
    process.env.TEST_DATABASE_URL = prevTest;
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, "PRODUCTION_USES_TEST_DATABASE");
    }
  });

  it("public preflight rejects wrong production fingerprint on local PG", async () => {
    const template = buildNotApprovedExecutionManifestTemplate("apply");
    const prevDb = process.env.DATABASE_URL;
    process.env.DATABASE_URL = url;
    delete process.env.TEST_DATABASE_URL;
    const result = await runProductionPreflight({
      manifest: template,
      operation: "apply",
      writeMode: false,
    });
    process.env.DATABASE_URL = prevDb;
    process.env.TEST_DATABASE_URL = url;
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, "TARGET_IDENTITY_POLICY_MISMATCH");
    }
    const identity = await resolveTargetDbIdentityFromUrl(url);
    assert.notEqual(identity.fingerprint, EXPECTED_PRODUCTION_DB_FINGERPRINT);
  });

  it("harness preflight passes schema on test DB with injectable fingerprint policy", async () => {
    const template = buildNotApprovedExecutionManifestTemplate("apply");
    const identity = await resolveTargetDbIdentityFromUrl(url);
    const prevDb = process.env.DATABASE_URL;
    process.env.DATABASE_URL = url;
    delete process.env.TEST_DATABASE_URL;
    const result = await runProductionPreflightHarness({
      manifest: template,
      operation: "apply",
      writeMode: false,
      targetFingerprintPolicy: identity.fingerprint,
    });
    process.env.DATABASE_URL = prevDb;
    process.env.TEST_DATABASE_URL = url;
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.schemaReady, true);
      assert.equal(result.planHash, "");
    }
  });
});
