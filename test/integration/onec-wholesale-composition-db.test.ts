import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { Pool } from "pg";
import { runClientsImport } from "../../src/onec-clients/run-import";
import { loadExistingCompositionContext } from "../../src/onec-clients/wholesale-composition-db";
import { buildWholesaleCompositionPrepReport } from "../../src/onec-clients/wholesale-composition";
import { validateClientsFileBytes } from "../../src/onec-clients/validate";
import {
  buildClientsFileBytes,
  sampleClient,
  sampleClientTwo,
} from "../helpers/onec-clients-fixtures";
import { createTestUser, getIntegrationDatabaseUrl, prepareDatabase, setIntegrationEnv } from "../helpers/test-db";

const databaseUrl = getIntegrationDatabaseUrl();
const clientA = sampleClient();
const clientB = sampleClientTwo();

describe("wholesale composition db integration", () => {
  before(async () => {
    setIntegrationEnv(databaseUrl);
    await prepareDatabase(databaseUrl);
  });

  after(async () => {
    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    await pool.query("DELETE FROM onec_clients");
    await pool.end();
  });

  it("loads dependency counts from real SQL and supports legacy incoming guids", async () => {
    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    await pool.query(
      `
        INSERT INTO onec_clients (guid_client, name_client, guid_holding, name_holding, guid_manager, name_manager, address, telephone, source_sha256)
        VALUES ($1::uuid, 'Legacy Only', NULL, '', $2::uuid, 'Mgr', '', '[]'::jsonb, 'abc')
      `,
      [clientA.guid_client, clientA.guid_manager],
    );
    const user = await createTestUser({
      databaseUrl,
      email: "grant-holder@example.com",
      password: "TestPassword123!",
      fullName: "Grant Holder",
      role: "manager",
    });
    await pool.query(
      `
        INSERT INTO access_grants (user_id, grant_type, object_id, basis, granted_by_user_id)
        VALUES ($1, 'client', $2::uuid, 'test', $1)
      `,
      [user.id, clientA.guid_client],
    );
    const client = await pool.connect();
    const existing = await loadExistingCompositionContext(client);
    client.release();
    await pool.end();

    assert.equal(existing.baselineAvailability, "loaded");
    assert.ok(existing.clientGuids.has(String(clientA.guid_client).toLowerCase()));

    const reducedBytes = buildClientsFileBytes([clientB]);
    const validated = validateClientsFileBytes(reducedBytes);
    assert.equal(validated.ok, true);
    if (!validated.ok) return;

    const report = buildWholesaleCompositionPrepReport({
      payload: validated.payload,
      holdingLinkPolicy: "tolerant",
      employeeRosterLoaded: false,
      employeeRosterSourceSha256: null,
      wholesaleEmployeeCount: null,
      existing,
    });

    assert.equal(report.incomingRecordCount, 1);
    assert.equal(report.existingRecordCount, 1);
    assert.equal(report.clientsToKeep.count, 0);
    assert.equal(report.clientsToExclude.count, 1);
    assert.ok((report.excludedDependencies.samples[0]?.activeAccessGrantCount ?? 0) >= 1);
  });

  it("marks baseline unavailable when database is not connected for prep", async () => {
    const env = {
      ONEC_FTP_ENABLED: "true",
      ONEC_FTP_SECURITY: "plain",
      ONEC_FTP_HOST: "127.0.0.1",
      ONEC_FTP_PORT: "21",
      ONEC_FTP_USER: "lc_exchange",
      ONEC_FTP_PASSWORD: "test",
      ONEC_FTP_BASE_PATH: "/LC",
    };
    const result = await runClientsImport({
      env: { ...env, DATABASE_URL: "" },
      argv: ["--dry-run", "--wholesale-composition-prep"],
      fileBytes: buildClientsFileBytes([clientA]),
    });
    assert.equal(result.status, "SUCCESS");
    assert.equal(result.wholesaleCompositionPrep?.baselineAvailability, "unavailable");
    assert.equal(result.wholesaleCompositionPrep?.existingRecordCount, null);
    assert.equal(result.wholesaleCompositionPrep?.clientsToAdd.count, null);
    assert.ok(
      result.wholesaleCompositionPrep?.operationBlockers.includes("database_baseline_unavailable"),
    );
  });
});
