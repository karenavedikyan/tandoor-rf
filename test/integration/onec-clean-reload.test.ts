import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import { Pool } from "pg";
import request from "supertest";
import { runCleanReload } from "../../src/onec-clean-reload/clean-reload";
import { tryAcquireCleanReloadLock, releaseCleanReloadLock } from "../../src/onec-clean-reload/preflight";
import { computeTargetDbFingerprint } from "../../src/onec-clean-reload/target-db";
import { applyCatalogImport } from "../../src/onec-catalog/apply";
import { parseCatalogSet } from "../../src/onec-catalog/parse-catalog-set";
import { validateCatalogSet } from "../../src/onec-catalog/validate-catalog-set";
import { applyClientsImport } from "../../src/onec-clients/apply";
import { validateClientsForApplyTest } from "../helpers/onec-clients-extended-fixtures";
import { closePool, resetPoolForTests } from "../../src/db/pool";
import { insertSyntheticClients } from "../helpers/clients-db-fixtures";
import {
  buildCleanReloadBundleEmployeesBytes,
  UNASSIGNED_ROSTER_EMPLOYEE,
  writeCleanReloadBundleDir,
} from "../helpers/onec-clean-reload-fixtures";
import {
  buildExtendedClientsFileBytes,
  EXTENDED_FIXTURE_GUIDS,
  sampleExtendedChild,
  sampleExtendedHolding,
} from "../helpers/onec-clients-extended-fixtures";
import {
  catalogEntriesFromXmlSet,
  buildMinimalCatalogXmlSet,
} from "../helpers/onec-catalog-fixtures";
import { buildClientsFileBytes, sampleClient } from "../helpers/onec-clients-fixtures";
import { verificationFingerprintFromPayload } from "../../src/onec-clients/import-verification-fingerprint";
import { linkUserToEmployee } from "../helpers/access-db-fixtures";
import {
  createTestUser,
  getIntegrationDatabaseUrl,
  prepareDatabase,
  setIntegrationEnv,
} from "../helpers/test-db";
import { BUNDLE_EMPLOYEES_FILE } from "../../src/onec-clean-reload/constants";

const ORIGIN = "http://127.0.0.1:3000";
const TEST_PASSWORD = "StrongPass123!";
const OLD_CLIENT = "11111111-1111-4111-8111-111111111111";
const STALE_EMPLOYEE = "33333333-3333-4333-8333-333333333333";

type CatalogSnapshot = {
  activeVersionId: string | null;
  manifestSha256: string | null;
  productCount: number;
  imageAssetCount: number;
};

async function readCatalogSnapshot(databaseUrl: string): Promise<CatalogSnapshot> {
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  try {
    const state = await pool.query<{ active_version_id: string | null; last_successful_manifest_sha256: string | null }>(
      `SELECT active_version_id::text, last_successful_manifest_sha256 FROM onec_catalog_state WHERE id = 1`,
    );
    const products = await pool.query<{ count: string }>(
      `
        SELECT COUNT(*)::text AS count
        FROM onec_catalog_products cp
        JOIN onec_catalog_versions cv ON cv.id = cp.version_id
        JOIN onec_catalog_state cs ON cs.active_version_id = cv.id
      `,
    );
    const images = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM onec_catalog_image_assets`,
    );
    return {
      activeVersionId: state.rows[0]?.active_version_id ?? null,
      manifestSha256: state.rows[0]?.last_successful_manifest_sha256 ?? null,
      productCount: Number(products.rows[0]?.count ?? "0"),
      imageAssetCount: Number(images.rows[0]?.count ?? "0"),
    };
  } finally {
    await pool.end();
  }
}

async function applyCleanReload(databaseUrl: string, bundleDir: string) {
  const dryRun = await runCleanReload({
    mode: "dry_run",
    bundleDir,
    databaseUrl,
    confirmExtendedContract: true,
    operatorReference: "integration-test",
  });
  assert.equal(dryRun.ok, true, JSON.stringify(dryRun));
  return runCleanReload({
    mode: "apply",
    bundleDir,
    databaseUrl,
    expectedBundleFingerprint: dryRun.plan.bundleFingerprint,
    confirmTargetDb: dryRun.plan.targetDbFingerprint,
    confirmExtendedContract: true,
    operatorReference: "integration-test",
  });
}

describe("onec clean reload integration", { concurrency: false }, () => {
  let databaseUrl = "";
  let bundleDir = "";
  let adminEmail = "admin@example.com";
  let catalogBefore: CatalogSnapshot;

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

    await createTestUser({
      databaseUrl,
      email: "manager-a@example.com",
      password: TEST_PASSWORD,
      fullName: "Manager A",
      role: "manager",
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
    catalogBefore = await readCatalogSnapshot(databaseUrl);

    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
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
    assert.equal(dryRun.plan.stats.clientsRecordCount, 2);
    assert.equal(dryRun.plan.stats.wholesaleEmployeeCount, 4);
    assert.equal(dryRun.plan.purgeScope.catalogUntouched, true);

    const poolAfter = new Pool({ connectionString: databaseUrl, max: 1 });
    const afterClients = await poolAfter.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM onec_clients`,
    );
    await poolAfter.end();
    assert.equal(beforeClients.rows[0]?.count, afterClients.rows[0]?.count);
  });

  it("apply replaces legacy clients and roster; catalog unchanged; admin login preserved", async () => {
    const apply = await applyCleanReload(databaseUrl, bundleDir);
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

    const grantCount = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM access_grants WHERE grant_type = 'client'`,
    );
    assert.equal(grantCount.rows[0]?.count, "0");

    const closedOutlet = await pool.query<{ is_closed: boolean }>(
      `
        SELECT is_closed
        FROM onec_retail_outlets
        WHERE guid_store = $1::uuid
      `,
      [EXTENDED_FIXTURE_GUIDS.STORE_ONE],
    );
    assert.equal(closedOutlet.rows[0]?.is_closed, false);

    const rosterCount = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM onec_wholesale_employee_roster`,
    );
    assert.equal(rosterCount.rows[0]?.count, "4");

    const unassigned = await pool.query<{ name_manager: string }>(
      `SELECT name_manager FROM onec_wholesale_employee_roster WHERE guid_manager = $1::uuid`,
      [UNASSIGNED_ROSTER_EMPLOYEE],
    );
    assert.equal(unassigned.rows[0]?.name_manager, "Unassigned Wholesale Employee");

    const catalogAfter = await readCatalogSnapshot(databaseUrl);
    assert.deepEqual(catalogAfter, catalogBefore);

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

    const employees = await request(app)
      .get("/api/clients/wholesale-employees")
      .set("Origin", ORIGIN)
      .set("Cookie", cookie);
    assert.equal(employees.status, 200);
    assert.equal(employees.body.total, 4);
  });

  it("rejects apply when bundle bytes change after dry-run", async () => {
    const dryRun = await runCleanReload({
      mode: "dry_run",
      bundleDir,
      databaseUrl,
    });
    assert.equal(dryRun.ok, true);

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
    });
    assert.equal(apply.ok, false);
    if (!apply.ok) {
      assert.equal(apply.code, "BUNDLE_FINGERPRINT_MISMATCH");
    }
  });

  it("rejects empty employee roster before purge", async () => {
    await writeFile(path.join(bundleDir, BUNDLE_EMPLOYEES_FILE), Buffer.from("[]", "utf8"));
    const dryRun = await runCleanReload({ mode: "dry_run", bundleDir, databaseUrl });
    assert.equal(dryRun.ok, false);
    if (!dryRun.ok) {
      assert.equal(dryRun.code, "EMPLOYEE_ROSTER_EMPTY");
    }
  });

  it("rejects apply when clean reload lock is held", async () => {
    const dryRun = await runCleanReload({ mode: "dry_run", bundleDir, databaseUrl });
    assert.equal(dryRun.ok, true);

    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    const client = await pool.connect();
    assert.equal(await tryAcquireCleanReloadLock(client), true);

    const apply = await runCleanReload({
      mode: "apply",
      bundleDir,
      databaseUrl,
      expectedBundleFingerprint: dryRun.plan.bundleFingerprint,
      confirmTargetDb: dryRun.plan.targetDbFingerprint,
      confirmExtendedContract: true,
      operatorReference: "lock-test",
    });
    assert.equal(apply.ok, false);
    if (!apply.ok) {
      assert.equal(apply.code, "CLEAN_RELOAD_LOCKED");
    }

    await releaseCleanReloadLock(client);
    client.release();
    await pool.end();
  });

  it("rolls back when failure happens after purge", async () => {
    const dryRun = await runCleanReload({ mode: "dry_run", bundleDir, databaseUrl });
    assert.equal(dryRun.ok, true);

    const apply = await runCleanReload({
      mode: "apply",
      bundleDir,
      databaseUrl,
      expectedBundleFingerprint: dryRun.plan.bundleFingerprint,
      confirmTargetDb: dryRun.plan.targetDbFingerprint,
      confirmExtendedContract: true,
      operatorReference: "rollback-purge",
      testHooks: {
        afterPurge: async () => {
          throw Object.assign(new Error("Injected purge-stage failure."), { code: "TEST_PURGE_FAILURE" });
        },
      },
    });
    assert.equal(apply.ok, false);

    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    const legacyStill = await pool.query(`SELECT 1 FROM onec_clients WHERE guid_client = $1::uuid`, [OLD_CLIENT]);
    assert.equal(legacyStill.rowCount, 1);
    await pool.end();
  });

  it("rolls back when failure happens before roster replace", async () => {
    const dryRun = await runCleanReload({ mode: "dry_run", bundleDir, databaseUrl });
    assert.equal(dryRun.ok, true);

    const apply = await runCleanReload({
      mode: "apply",
      bundleDir,
      databaseUrl,
      expectedBundleFingerprint: dryRun.plan.bundleFingerprint,
      confirmTargetDb: dryRun.plan.targetDbFingerprint,
      confirmExtendedContract: true,
      operatorReference: "rollback-roster",
      testHooks: {
        beforeRosterReplace: async () => {
          throw Object.assign(new Error("Injected roster-stage failure."), { code: "TEST_ROSTER_FAILURE" });
        },
      },
    });
    assert.equal(apply.ok, false);

    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    const legacyStill = await pool.query(`SELECT 1 FROM onec_clients WHERE guid_client = $1::uuid`, [OLD_CLIENT]);
    assert.equal(legacyStill.rowCount, 1);
    const rosterCount = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM onec_wholesale_employee_roster`,
    );
    assert.equal(rosterCount.rows[0]?.count, "0");
    await pool.end();
  });

  it("revokes stale employee links and does not grant manager access to new clients", async () => {
    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    const managerUser = await pool.query<{ id: string }>(
      `SELECT id::text FROM users WHERE email = 'manager-a@example.com' LIMIT 1`,
    );
    const adminUser = await pool.query<{ id: string }>(
      `SELECT id::text FROM users WHERE email = $1 LIMIT 1`,
      [adminEmail],
    );
    await pool.end();

    await linkUserToEmployee({
      databaseUrl,
      userId: managerUser.rows[0]!.id,
      employeeId: STALE_EMPLOYEE,
      confirmedByUserId: adminUser.rows[0]!.id,
    });

    const apply = await applyCleanReload(databaseUrl, bundleDir);
    assert.equal(apply.ok, true);
    if (apply.ok) {
      assert.ok((apply.apply?.revokedEmployeeLinks ?? 0) >= 1);
    }

    const poolAfter = new Pool({ connectionString: databaseUrl, max: 1 });
    const revoked = await poolAfter.query<{ count: string }>(
      `
        SELECT COUNT(*)::text AS count
        FROM user_onec_employee_links
        WHERE employee_id = $1::uuid AND revoked_at IS NOT NULL
      `,
      [STALE_EMPLOYEE],
    );
    assert.equal(revoked.rows[0]?.count, "1");
    await poolAfter.end();

    const { createApp } = await import("../../src/server");
    const app = createApp();
    const login = await request(app)
      .post("/api/auth/login")
      .set("Origin", ORIGIN)
      .send({ email: "manager-a@example.com", password: TEST_PASSWORD });
    const cookie = login.headers["set-cookie"]?.[0]?.split(";")[0] ?? "";
    const list = await request(app)
      .get("/api/clients")
      .set("Origin", ORIGIN)
      .set("Cookie", cookie);
    assert.equal(list.status, 403);
  });

  it("repeat apply does not create duplicate clients or roster rows", async () => {
    const first = await applyCleanReload(databaseUrl, bundleDir);
    assert.equal(first.ok, true);
    const second = await applyCleanReload(databaseUrl, bundleDir);
    assert.equal(second.ok, true);

    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    const clients = await pool.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM onec_clients`);
    const roster = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM onec_wholesale_employee_roster`,
    );
    await pool.end();
    assert.equal(clients.rows[0]?.count, "2");
    assert.equal(roster.rows[0]?.count, "4");
  });
});
