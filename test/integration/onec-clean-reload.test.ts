import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import { Pool } from "pg";
import request from "supertest";
import { runCleanReload } from "../../src/onec-clean-reload/clean-reload";
import { computeTargetDbFingerprint } from "../../src/onec-clean-reload/target-db";
import { applyCatalogImport } from "../../src/onec-catalog/apply";
import { parseCatalogSet } from "../../src/onec-catalog/parse-catalog-set";
import { validateCatalogSet } from "../../src/onec-catalog/validate-catalog-set";
import { applyClientsImport } from "../../src/onec-clients/apply";
import { validateClientsForApplyTest } from "../helpers/onec-clients-extended-fixtures";
import { validateClientsFileBytes } from "../../src/onec-clients/validate";
import { closePool, resetPoolForTests } from "../../src/db/pool";
import { insertSyntheticClients } from "../helpers/clients-db-fixtures";
import { writeCleanReloadBundleDir } from "../helpers/onec-clean-reload-fixtures";
import {
  buildExtendedClientsFileBytes,
  sampleExtendedChild,
  sampleExtendedHolding,
} from "../helpers/onec-clients-extended-fixtures";
import {
  catalogEntriesFromXmlSet,
  buildMinimalCatalogXmlSet,
} from "../helpers/onec-catalog-fixtures";
import { buildClientsFileBytes, sampleClient } from "../helpers/onec-clients-fixtures";
import { verificationFingerprintFromPayload } from "../../src/onec-clients/import-verification-fingerprint";
import {
  createTestUser,
  getIntegrationDatabaseUrl,
  prepareDatabase,
  setIntegrationEnv,
} from "../helpers/test-db";
import { EXTENDED_FIXTURE_GUIDS } from "../helpers/onec-clients-extended-fixtures";

const ORIGIN = "http://127.0.0.1:3000";
const TEST_PASSWORD = "StrongPass123!";
const OLD_CLIENT = "11111111-1111-4111-8111-111111111111";

describe("onec clean reload integration", { concurrency: false }, () => {
  let databaseUrl = "";
  let bundleDir = "";
  let adminEmail = "admin@example.com";

  before(async () => {
    databaseUrl = getIntegrationDatabaseUrl();
    setIntegrationEnv(databaseUrl, ORIGIN);
    await prepareDatabase(databaseUrl);
  });

  beforeEach(async () => {
    await resetPoolForTests();
    await prepareDatabase(databaseUrl);
    bundleDir = await mkdtemp(path.join(os.tmpdir(), "onec-clean-reload-"));

    await createTestUser({
      databaseUrl,
      email: adminEmail,
      password: TEST_PASSWORD,
      fullName: "Clean Reload Admin",
      role: "admin",
    });

    await insertSyntheticClients(databaseUrl, [
      {
        guid_client: OLD_CLIENT,
        name_client: "Legacy Test Client",
        guid_manager: EXTENDED_FIXTURE_GUIDS.MANAGER_A,
        name_manager: "Legacy Manager",
        address: "Old address",
      },
    ]);

    const legacyBytes = buildClientsFileBytes([sampleClient()]);
    const legacyValidated = validateClientsForApplyTest(legacyBytes);
    assert.equal(legacyValidated.ok, true);
    if (!legacyValidated.ok) return;
    const legacyApply = await applyClientsImport({
      databaseUrl,
      payload: legacyValidated.payload,
      expectedVerificationFingerprint: verificationFingerprintFromPayload({
        payload: legacyValidated.payload,
      }),
    });
    assert.equal(legacyApply.ok, true);

    const catalogEntries = catalogEntriesFromXmlSet(buildMinimalCatalogXmlSet());
    const parsed = await parseCatalogSet(
      catalogEntries.map((file) => ({ relativePath: file.relativePath, bytes: file.bytes })),
    );
    assert.equal(parsed.ok, true);
    const validatedCatalog = validateCatalogSet(parsed.data!);
    assert.equal(validatedCatalog.ok, true);
    const catalogApply = await applyCatalogImport(databaseUrl, validatedCatalog.data!);
    assert.equal(catalogApply.ok, true);

    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    const reviewTable = await pool.query<{ exists: boolean }>(
      `SELECT to_regclass('public.client_review_records') IS NOT NULL AS exists`,
    );
    if (reviewTable.rows[0]?.exists) {
      await pool.query(
        `
          INSERT INTO client_review_records (guid_client, review_state, version)
          VALUES ($1::uuid, 'in_progress', 1)
        `,
        [OLD_CLIENT],
      );
    }
    await pool.query(
      `
        INSERT INTO access_grants (user_id, grant_type, object_id, basis, granted_by_user_id)
        SELECT id, 'client', $1::uuid, 'manual', id FROM users WHERE email = $2 LIMIT 1
      `,
      [OLD_CLIENT, adminEmail],
    );
    await pool.end();

    await writeCleanReloadBundleDir(bundleDir);
  });

  after(async () => {
    if (bundleDir) {
      await rm(bundleDir, { recursive: true, force: true });
    }
    await closePool();
  });

  async function loginAdmin(): Promise<string> {
    const { createApp } = await import("../../src/server");
    const app = createApp();
    const res = await request(app)
      .post("/api/auth/login")
      .set("Origin", ORIGIN)
      .send({ email: adminEmail, password: TEST_PASSWORD });
    assert.equal(res.status, 200);
    return res.headers["set-cookie"]?.[0]?.split(";")[0] ?? "";
  }

  it("dry-run validates bundle and returns fingerprints without mutating data", async () => {
    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    const beforeClients = await pool.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM onec_clients`);
    await pool.end();

    const dryRun = await runCleanReload({
      mode: "dry_run",
      bundleDir,
      databaseUrl,
      confirmExtendedContract: true,
      operatorReference: "dry-run-test",
    });
    assert.equal(dryRun.ok, true);
    assert.ok(dryRun.plan.bundleFingerprint);
    assert.equal(dryRun.plan.targetDbFingerprint, computeTargetDbFingerprint(databaseUrl));
    assert.equal(dryRun.plan.clientsRecordCount, 2);

    const poolAfter = new Pool({ connectionString: databaseUrl, max: 1 });
    const afterClients = await poolAfter.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM onec_clients`,
    );
    await poolAfter.end();
    assert.equal(beforeClients.rows[0]?.count, afterClients.rows[0]?.count);
  });

  it("apply purges legacy scope and loads pinned bundle; admin login preserved", async () => {
    const dryRun = await runCleanReload({
      mode: "dry_run",
      bundleDir,
      databaseUrl,
      confirmExtendedContract: true,
      operatorReference: "integration-test",
    });
    assert.equal(dryRun.ok, true);

    const wrongTarget = await runCleanReload({
      mode: "apply",
      bundleDir,
      databaseUrl,
      expectedBundleFingerprint: dryRun.plan.bundleFingerprint,
      confirmTargetDb: "0".repeat(64),
      confirmExtendedContract: true,
      operatorReference: "integration-test",
      skipImageSync: true,
    });
    assert.equal(wrongTarget.ok, false);
    if (!wrongTarget.ok) {
      assert.equal(wrongTarget.code, "TARGET_DB_MISMATCH");
    }

    const apply = await runCleanReload({
      mode: "apply",
      bundleDir,
      databaseUrl,
      expectedBundleFingerprint: dryRun.plan.bundleFingerprint,
      confirmTargetDb: dryRun.plan.targetDbFingerprint,
      confirmExtendedContract: true,
      operatorReference: "integration-test",
      skipImageSync: true,
    });
    assert.equal(apply.ok, true, JSON.stringify(apply));

    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    const oldRow = await pool.query(`SELECT 1 FROM onec_clients WHERE guid_client = $1::uuid`, [OLD_CLIENT]);
    assert.equal(oldRow.rowCount, 0);

    const newRows = await pool.query<{ guid_client: string }>(
      `SELECT guid_client::text FROM onec_clients ORDER BY guid_client`,
    );
    assert.deepEqual(
      newRows.rows.map((row) => row.guid_client),
      [EXTENDED_FIXTURE_GUIDS.CHILD_GUID, EXTENDED_FIXTURE_GUIDS.HOLDING_GUID].sort(),
    );

    const reviewTableAfter = await pool.query<{ exists: boolean }>(
      `SELECT to_regclass('public.client_review_records') IS NOT NULL AS exists`,
    );
    if (reviewTableAfter.rows[0]?.exists) {
      const reviewCount = await pool.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM client_review_records`,
      );
      assert.equal(reviewCount.rows[0]?.count, "0");
    }

    const grantCount = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM access_grants WHERE grant_type = 'client'`,
    );
    assert.equal(grantCount.rows[0]?.count, "0");

    const outletCount = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM onec_retail_outlets`,
    );
    assert.ok(Number(outletCount.rows[0]?.count ?? "0") >= 1);

    const catalogProducts = await pool.query<{ count: string }>(
      `
        SELECT COUNT(*)::text AS count
        FROM onec_catalog_products cp
        JOIN onec_catalog_versions cv ON cv.id = cp.version_id
        JOIN onec_catalog_state cs ON cs.active_version_id = cv.id
      `,
    );
    assert.equal(catalogProducts.rows[0]?.count, "2");

    const adminCount = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM users WHERE email = $1 AND role = 'admin'`,
      [adminEmail],
    );
    assert.equal(adminCount.rows[0]?.count, "1");
    await pool.end();

    const cookie = await loginAdmin();
    assert.ok(cookie.length > 0);

    const { createApp } = await import("../../src/server");
    const app = createApp();
    const list = await request(app)
      .get("/api/clients?view=all")
      .set("Origin", ORIGIN)
      .set("Cookie", cookie);
    assert.equal(list.status, 200);
    assert.equal(list.body.total, 2);
  });

  it("rejects apply when bundle bytes change after dry-run", async () => {
    const dryRun = await runCleanReload({
      mode: "dry_run",
      bundleDir,
      databaseUrl,
      skipCatalog: true,
    });
    assert.equal(dryRun.ok, true);

    const { writeFile } = await import("node:fs/promises");
    const mutatedBytes = buildExtendedClientsFileBytes([
      sampleExtendedHolding({ address: "Mutated HQ address" }),
      sampleExtendedChild(),
    ]);
    await writeFile(path.join(bundleDir, "all_clients.json"), mutatedBytes);

    const apply = await runCleanReload({
      mode: "apply",
      bundleDir,
      databaseUrl,
      expectedBundleFingerprint: dryRun.plan.bundleFingerprint,
      confirmTargetDb: dryRun.plan.targetDbFingerprint,
      confirmExtendedContract: true,
      operatorReference: "changed-bundle",
      skipCatalog: true,
      skipImageSync: true,
    });
    assert.equal(apply.ok, false);
    if (!apply.ok) {
      assert.equal(apply.code, "BUNDLE_FINGERPRINT_MISMATCH");
    }
  });
});
