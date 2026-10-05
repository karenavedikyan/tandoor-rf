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
  buildCleanReloadBundleClientsBytes,
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
import {
  buildEmployeeRosterBytes,
  buildEmployeeRosterEntry,
} from "../helpers/onec-clients-employee-roster-fixtures";
import { calendarDateToTimestamptz } from "../../src/shared/calendar-date";
import type { FtpReader } from "../../src/onec-clients/ftp-read";
import { buildImportVerificationFingerprint } from "../helpers/onec-clients-fixtures";
import { runOneImportJob } from "../../src/onec-import/worker";
import { runClientsImport } from "../../src/onec-clients/run-import";

const ORIGIN = "http://127.0.0.1:3000";
const FTP_ENV = {
  ONEC_FTP_ENABLED: "true",
  ONEC_FTP_SECURITY: "plain",
  ONEC_FTP_HOST: "gw.toopatch.ru",
  ONEC_FTP_PORT: "21",
  ONEC_FTP_USER: "test",
  ONEC_FTP_PASSWORD: "secret-test-value",
  ONEC_FTP_BASE_PATH: "/LC",
  ONEC_FTP_TIMEOUT_MS: "1000",
};
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

    const seedPool = new Pool({ connectionString: databaseUrl, max: 1 });
    await seedPool.query(
      `
        INSERT INTO onec_catalog_image_assets (source_path, status, content_sha256, byte_size)
        VALUES ('images/clean-reload-seed.png', 'ready', $1, 128)
        ON CONFLICT (source_path) DO NOTHING
      `,
      ["a".repeat(64)],
    );
    await seedPool.end();

    catalogBefore = await readCatalogSnapshot(databaseUrl);
    assert.ok(catalogBefore.imageAssetCount >= 1);

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
    assert.equal(dryRun.plan.stats.retailOutletsOpen, 1);
    assert.equal(dryRun.plan.stats.retailOutletsClosed, 1);
    assert.equal(dryRun.plan.stats.retailOutletsWithoutGuidStore, 0);
    assert.equal(dryRun.plan.purgeScope.catalogUntouched, true);
    assert.ok(dryRun.plan.targetDb.host);
    assert.ok(dryRun.plan.schemaDependencies.includes("table:onec_wholesale_employee_roster"));
    assert.equal(dryRun.plan.blockers.length, 0);

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

    const outletRows = await pool.query<{ guid_store: string; is_closed: boolean }>(
      `SELECT guid_store::text, is_closed FROM onec_retail_outlets ORDER BY guid_store`,
    );
    assert.deepEqual(
      outletRows.rows.map((row) => row.guid_store).sort(),
      [EXTENDED_FIXTURE_GUIDS.STORE_ONE, EXTENDED_FIXTURE_GUIDS.STORE_TWO].sort(),
    );
    const openOutlet = outletRows.rows.find((row) => row.guid_store === EXTENDED_FIXTURE_GUIDS.STORE_ONE);
    const closedOutlet = outletRows.rows.find((row) => row.guid_store === EXTENDED_FIXTURE_GUIDS.STORE_TWO);
    assert.equal(openOutlet?.is_closed, false);
    assert.equal(closedOutlet?.is_closed, true);

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

    const parsedClients = JSON.parse(buildCleanReloadBundleClientsBytes().toString("utf8")) as Array<Record<string, unknown>>;
    parsedClients[0]!.address = "Mutated HQ address";
    await writeFile(path.join(bundleDir, "all_clients.json"), Buffer.from(JSON.stringify(parsedClients), "utf8"));

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

  it("rejects bundle with anonymous retail outlets before purge", async () => {
    const badClients = buildExtendedClientsFileBytes([
      sampleExtendedHolding(),
      sampleExtendedChild({
        retail_outlets: [
          {
            holding: "Holding Alpha",
            warehouse: false,
            address: { store_address: "No guid" },
          },
        ],
      }),
    ]);
    await writeFile(path.join(bundleDir, "all_clients.json"), badClients);

    const dryRun = await runCleanReload({ mode: "dry_run", bundleDir, databaseUrl });
    assert.equal(dryRun.ok, false);
    if (!dryRun.ok) {
      assert.equal(dryRun.code, "OUTLET_IDENTITY_REQUIRED");
    }
  });

  it("stores roster date_of_assumption from DD.MM.YYYY without timezone shift", async () => {
    const employees = [
      buildEmployeeRosterEntry(EXTENDED_FIXTURE_GUIDS.MANAGER_A, {
        name_manager: "Synthetic Manager A",
        email: "mgr-a@example.test",
        date_of_assumption: "05.10.2026",
      }),
      buildEmployeeRosterEntry(EXTENDED_FIXTURE_GUIDS.MANAGER_B, {
        name_manager: "Synthetic Manager B",
        email: "mgr-b@example.test",
        date_of_assumption: "29.02.2024",
      }),
      buildEmployeeRosterEntry(EXTENDED_FIXTURE_GUIDS.REGIONAL, {
        name_manager: "Synthetic Regional",
        email: "regional@example.test",
      }),
      buildEmployeeRosterEntry(UNASSIGNED_ROSTER_EMPLOYEE, {
        name_manager: "Unassigned Wholesale Employee",
        email: "unassigned@example.test",
      }),
    ];
    await writeFile(path.join(bundleDir, BUNDLE_EMPLOYEES_FILE), buildEmployeeRosterBytes(employees));

    const apply = await applyCleanReload(databaseUrl, bundleDir);
    assert.equal(apply.ok, true, JSON.stringify(apply));

    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    const rows = await pool.query<{ guid_manager: string; date_of_assumption: Date }>(
      `
        SELECT guid_manager::text, date_of_assumption
        FROM onec_wholesale_employee_roster
        WHERE guid_manager IN ($1::uuid, $2::uuid)
        ORDER BY guid_manager
      `,
      [EXTENDED_FIXTURE_GUIDS.MANAGER_A, EXTENDED_FIXTURE_GUIDS.MANAGER_B],
    );
    await pool.end();

    assert.equal(rows.rowCount, 2);
    const byGuid = new Map(rows.rows.map((row) => [row.guid_manager, row.date_of_assumption.toISOString()]));
    assert.equal(byGuid.get(EXTENDED_FIXTURE_GUIDS.MANAGER_A), calendarDateToTimestamptz("2026-10-05"));
    assert.equal(byGuid.get(EXTENDED_FIXTURE_GUIDS.MANAGER_B), calendarDateToTimestamptz("2024-02-29"));
  });

  it("rejects roster with invalid date_of_assumption before purge", async () => {
    const badEmployees = buildCleanReloadBundleEmployeesBytes();
    const parsed = JSON.parse(badEmployees.toString("utf8")) as Array<Record<string, unknown>>;
    parsed[0]!.date_of_assumption = "not-a-date";
    await writeFile(path.join(bundleDir, BUNDLE_EMPLOYEES_FILE), Buffer.from(JSON.stringify(parsed), "utf8"));

    const dryRun = await runCleanReload({ mode: "dry_run", bundleDir, databaseUrl });
    assert.equal(dryRun.ok, false);
    if (!dryRun.ok) {
      assert.equal(dryRun.code, "ROSTER_FIELD_INVALID");
    }
  });

  it("dry-run reports migrations_not_ready when roster tables are absent", async () => {
    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    await pool.query(`DROP TABLE IF EXISTS onec_wholesale_employee_roster CASCADE`);
    await pool.query(`DROP TABLE IF EXISTS onec_wholesale_roster_state CASCADE`);
    await pool.end();

    const dryRun = await runCleanReload({ mode: "dry_run", bundleDir, databaseUrl });
    assert.equal(dryRun.ok, false);
    if (!dryRun.ok) {
      assert.equal(dryRun.code, "MIGRATIONS_NOT_READY");
      assert.ok(dryRun.plan?.blockers.some((item) => item.includes("onec_wholesale_employee_roster")));
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

  it("rolls back when roster INSERT fails at SQL layer", async () => {
    const dryRun = await runCleanReload({ mode: "dry_run", bundleDir, databaseUrl });
    assert.equal(dryRun.ok, true);

    const apply = await runCleanReload({
      mode: "apply",
      bundleDir,
      databaseUrl,
      expectedBundleFingerprint: dryRun.plan.bundleFingerprint,
      confirmTargetDb: dryRun.plan.targetDbFingerprint,
      confirmExtendedContract: true,
      operatorReference: "rollback-roster-sql",
      testHooks: {
        beforeRosterReplace: async (client) => {
          await client.query(
            `ALTER TABLE onec_wholesale_employee_roster ADD CONSTRAINT clean_reload_test_block CHECK (FALSE)`,
          );
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

  it("apply refuses when pending or running import jobs exist", async () => {
    const dryRun = await runCleanReload({ mode: "dry_run", bundleDir, databaseUrl });
    assert.equal(dryRun.ok, true);

    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    await pool.query(`
      INSERT INTO onec_import_jobs (mode, status, expires_at)
      VALUES ('dry_run', 'pending', NOW() + INTERVAL '1 hour')
    `);
    await pool.end();

    const apply = await runCleanReload({
      mode: "apply",
      bundleDir,
      databaseUrl,
      expectedBundleFingerprint: dryRun.plan.bundleFingerprint,
      confirmTargetDb: dryRun.plan.targetDbFingerprint,
      confirmExtendedContract: true,
      operatorReference: "pending-job-block",
    });
    assert.equal(apply.ok, false);
    if (!apply.ok) {
      assert.equal(apply.code, "PENDING_IMPORT_JOBS");
    }

    const poolAfter = new Pool({ connectionString: databaseUrl, max: 1 });
    const legacyStill = await poolAfter.query(`SELECT 1 FROM onec_clients WHERE guid_client = $1::uuid`, [OLD_CLIENT]);
    assert.equal(legacyStill.rowCount, 1);
    await poolAfter.end();
  });

  it("refuses apply while import worker holds a running job after claim", async () => {
    const dryRun = await runCleanReload({
      mode: "dry_run",
      bundleDir,
      databaseUrl,
      confirmExtendedContract: true,
      operatorReference: "worker-race-dry-run",
    });
    assert.equal(dryRun.ok, true);

    const staleBytes = buildExtendedClientsFileBytes([
      sampleExtendedHolding({ name_client: "STALE WORKER Holding Alpha" }),
      sampleExtendedChild({
        name_client: "STALE WORKER Child Shop",
        retail_outlets: [
          {
            guid_store: EXTENDED_FIXTURE_GUIDS.STORE_TWO,
            closed: true,
            holding: "Holding Alpha",
            warehouse: false,
            address: { store_address: "Child store", delivery_address: "", direction_of_the_route: "" },
            information_loading: { loading_on_friday: true, loading_time: "10:30" },
            managers: {
              guid_manager: EXTENDED_FIXTURE_GUIDS.MANAGER_B,
              name_manager: "Manager Two",
              guid_regional_manager: "",
              name_regional_manager: "",
              guid_hardware_manager: "",
              name_hardware_manager: "",
              guid_head_of_the_sales_department: "",
              name_head_of_the_sales_department: "",
            },
            contact_information: { store_phone: "", accountant_phone: "", accountant_email: "" },
            LPR_information: {},
            additional_information: {},
          },
        ],
      }),
    ]);
    const staleFingerprint = buildImportVerificationFingerprint(
      JSON.parse(staleBytes.toString("utf8")) as Record<string, unknown>[],
    );

    let releaseFtp!: () => void;
    const ftpBlocked = new Promise<void>((resolve) => {
      releaseFtp = resolve;
    });
    const pausingReader: FtpReader = async () => {
      await ftpBlocked;
      return { ok: true, bytes: staleBytes, remotePath: "/LC/clients/all_clients.json" };
    };

    const pool = new Pool({ connectionString: databaseUrl, max: 2 });
    await pool.query(
      `
        INSERT INTO onec_import_jobs (mode, expected_sha256, expires_at)
        VALUES ('apply', $1, NOW() + INTERVAL '1 hour')
      `,
      [staleFingerprint],
    );

    const workerPromise = runOneImportJob(pool, { ...FTP_ENV, DATABASE_URL: databaseUrl }, pausingReader);

    for (let attempt = 0; attempt < 100; attempt += 1) {
      const status = await pool.query<{ status: string }>(`SELECT status FROM onec_import_jobs LIMIT 1`);
      if (status.rows[0]?.status === "running") {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    const apply = await runCleanReload({
      mode: "apply",
      bundleDir,
      databaseUrl,
      expectedBundleFingerprint: dryRun.plan.bundleFingerprint,
      confirmTargetDb: dryRun.plan.targetDbFingerprint,
      confirmExtendedContract: true,
      operatorReference: "worker-race-apply",
    });
    assert.equal(apply.ok, false, JSON.stringify(apply));
    if (!apply.ok) {
      assert.equal(apply.code, "PENDING_IMPORT_JOBS");
    }

    const legacyBeforeRelease = await pool.query<{ name_client: string }>(
      `SELECT name_client FROM onec_clients WHERE guid_client = $1::uuid`,
      [OLD_CLIENT],
    );
    assert.equal(legacyBeforeRelease.rowCount, 1);

    releaseFtp();
    await workerPromise;

    const cleanReloadApplied = await pool.query(
      `
        SELECT 1
        FROM onec_clients
        WHERE guid_client = $1::uuid
          AND name_client = 'Holding Alpha'
      `,
      [EXTENDED_FIXTURE_GUIDS.HOLDING_GUID],
    );
    assert.equal(cleanReloadApplied.rowCount, 0);

    const legacyStill = await pool.query(`SELECT 1 FROM onec_clients WHERE guid_client = $1::uuid`, [OLD_CLIENT]);
    assert.equal(legacyStill.rowCount, 1);
    await pool.end();
  });

  it("dry-run reports migrations_not_ready when required roster column is absent", async () => {
    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    await pool.query(`ALTER TABLE onec_wholesale_employee_roster DROP COLUMN IF EXISTS raw_json`);
    await pool.end();

    const dryRun = await runCleanReload({ mode: "dry_run", bundleDir, databaseUrl });
    assert.equal(dryRun.ok, false);
    if (!dryRun.ok) {
      assert.equal(dryRun.code, "MIGRATIONS_NOT_READY");
      assert.ok(dryRun.plan?.blockers.some((item) => item.includes("raw_json")));
    }

    const poolAfter = new Pool({ connectionString: databaseUrl, max: 1 });
    const legacyStill = await poolAfter.query(`SELECT 1 FROM onec_clients WHERE guid_client = $1::uuid`, [OLD_CLIENT]);
    assert.equal(legacyStill.rowCount, 1);
    await poolAfter.end();
  });

  it("rolls back apply when outlet registry insert is incomplete", async () => {
    const dryRun = await runCleanReload({ mode: "dry_run", bundleDir, databaseUrl });
    assert.equal(dryRun.ok, true);

    const apply = await runCleanReload({
      mode: "apply",
      bundleDir,
      databaseUrl,
      expectedBundleFingerprint: dryRun.plan.bundleFingerprint,
      confirmTargetDb: dryRun.plan.targetDbFingerprint,
      confirmExtendedContract: true,
      operatorReference: "outlet-registry-verify",
      testHooks: {
        afterPurge: async (client) => {
          await client.query(`
            CREATE OR REPLACE FUNCTION clean_reload_test_block_store_two()
            RETURNS trigger
            LANGUAGE plpgsql
            AS $$
            BEGIN
              IF NEW.guid_store = '${EXTENDED_FIXTURE_GUIDS.STORE_TWO}'::uuid THEN
                RETURN NULL;
              END IF;
              RETURN NEW;
            END;
            $$;
          `);
          await client.query(`DROP TRIGGER IF EXISTS clean_reload_test_block_store_two ON onec_retail_outlets`);
          await client.query(
            `
              CREATE TRIGGER clean_reload_test_block_store_two
              BEFORE INSERT ON onec_retail_outlets
              FOR EACH ROW
              EXECUTE FUNCTION clean_reload_test_block_store_two()
            `,
          );
        },
      },
    });
    assert.equal(apply.ok, false);
    if (!apply.ok) {
      assert.equal(apply.code, "OUTLET_REGISTRY_MISMATCH");
    }

    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    const legacyStill = await pool.query(`SELECT 1 FROM onec_clients WHERE guid_client = $1::uuid`, [OLD_CLIENT]);
    assert.equal(legacyStill.rowCount, 1);
    await pool.end();
  });

  it("rolls back apply when outlet registry owner or closed state is wrong", async () => {
    const dryRun = await runCleanReload({ mode: "dry_run", bundleDir, databaseUrl });
    assert.equal(dryRun.ok, true);

    const apply = await runCleanReload({
      mode: "apply",
      bundleDir,
      databaseUrl,
      expectedBundleFingerprint: dryRun.plan.bundleFingerprint,
      confirmTargetDb: dryRun.plan.targetDbFingerprint,
      confirmExtendedContract: true,
      operatorReference: "outlet-registry-owner",
      testHooks: {
        afterClientsImport: async (client) => {
          await client.query(
            `
              UPDATE onec_retail_outlets
              SET is_closed = TRUE
              WHERE guid_store = $1::uuid
            `,
            [EXTENDED_FIXTURE_GUIDS.STORE_ONE],
          );
        },
      },
    });
    assert.equal(apply.ok, false);
    if (!apply.ok) {
      assert.equal(apply.code, "OUTLET_REGISTRY_MISMATCH");
    }

    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    const legacyStill = await pool.query(`SELECT 1 FROM onec_clients WHERE guid_client = $1::uuid`, [OLD_CLIENT]);
    assert.equal(legacyStill.rowCount, 1);
    await pool.end();
  });

  function buildStaleAfterCheckClientsBytes(): Buffer {
    return buildExtendedClientsFileBytes([
      sampleExtendedHolding({ name_client: "STALE AFTER CHECK Holding Alpha" }),
      sampleExtendedChild({
        name_client: "STALE AFTER CHECK Child Shop",
        retail_outlets: [
          {
            guid_store: EXTENDED_FIXTURE_GUIDS.STORE_TWO,
            closed: true,
            holding: "Holding Alpha",
            warehouse: false,
            address: { store_address: "Child store", delivery_address: "", direction_of_the_route: "" },
            information_loading: { loading_on_friday: true, loading_time: "10:30" },
            managers: {
              guid_manager: EXTENDED_FIXTURE_GUIDS.MANAGER_B,
              name_manager: "Manager Two",
              guid_regional_manager: "",
              name_regional_manager: "",
              guid_hardware_manager: "",
              name_hardware_manager: "",
              guid_head_of_the_sales_department: "",
              name_head_of_the_sales_department: "",
            },
            contact_information: { store_phone: "", accountant_phone: "", accountant_email: "" },
            LPR_information: {},
            additional_information: {},
          },
        ],
      }),
    ]);
  }

  async function assertNoStaleAfterCheckClients(pool: Pool): Promise<void> {
    const stale = await pool.query<{ name_client: string }>(
      `SELECT name_client FROM onec_clients WHERE name_client LIKE 'STALE AFTER CHECK%'`,
    );
    assert.equal(stale.rowCount, 0);
    const holding = await pool.query<{ name_client: string }>(
      `SELECT name_client FROM onec_clients WHERE guid_client = $1::uuid`,
      [EXTENDED_FIXTURE_GUIDS.HOLDING_GUID],
    );
    assert.equal(holding.rows[0]?.name_client, "Holding Alpha");
  }

  it("dry-run reports migrations_not_ready when required purge table is absent", async () => {
    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    await pool.query(`DROP TABLE IF EXISTS outlet_distribution_marker_events CASCADE`);
    await pool.end();

    const dryRun = await runCleanReload({ mode: "dry_run", bundleDir, databaseUrl });
    assert.equal(dryRun.ok, false);
    if (!dryRun.ok) {
      assert.equal(dryRun.code, "MIGRATIONS_NOT_READY");
      assert.ok(
        dryRun.plan?.blockers.some((item) => item.includes("outlet_distribution_marker_events")),
      );
    }
  });

  it("dry-run reports migrations_not_ready when import metadata column is absent", async () => {
    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    await pool.query(`ALTER TABLE onec_client_import_runs DROP COLUMN IF EXISTS verification_fingerprint`);
    await pool.end();

    const dryRun = await runCleanReload({ mode: "dry_run", bundleDir, databaseUrl });
    assert.equal(dryRun.ok, false);
    if (!dryRun.ok) {
      assert.equal(dryRun.code, "MIGRATIONS_NOT_READY");
      assert.ok(dryRun.plan?.blockers.some((item) => item.includes("verification_fingerprint")));
    }
  });

  it("dry-run succeeds when optional review schema is absent", async () => {
    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    await pool.query(`DROP TABLE IF EXISTS client_review_records CASCADE`);
    await pool.end();

    const dryRun = await runCleanReload({ mode: "dry_run", bundleDir, databaseUrl });
    assert.equal(dryRun.ok, true);
    assert.equal(dryRun.plan.blockers.length, 0);
  });

  it("job created after clean reload concurrent check cannot republish stale client names", async () => {
    const dryRun = await runCleanReload({
      mode: "dry_run",
      bundleDir,
      databaseUrl,
      confirmExtendedContract: true,
      operatorReference: "after-check-race-dry-run",
    });
    assert.equal(dryRun.ok, true);

    const staleBytes = buildStaleAfterCheckClientsBytes();
    const staleFingerprint = buildImportVerificationFingerprint(
      JSON.parse(staleBytes.toString("utf8")) as Record<string, unknown>[],
    );

    let releaseFtp!: () => void;
    const ftpBlocked = new Promise<void>((resolve) => {
      releaseFtp = resolve;
    });
    const pausingReader: FtpReader = async () => {
      await ftpBlocked;
      return { ok: true, bytes: staleBytes, remotePath: "/LC/clients/all_clients.json" };
    };

    const jobPool = new Pool({ connectionString: databaseUrl, max: 2 });
    let workerPromise: Promise<"idle" | "success" | "failed"> | undefined;

    const apply = await runCleanReload({
      mode: "apply",
      bundleDir,
      databaseUrl,
      expectedBundleFingerprint: dryRun.plan.bundleFingerprint,
      confirmTargetDb: dryRun.plan.targetDbFingerprint,
      confirmExtendedContract: true,
      operatorReference: "after-check-race-apply",
      testHooks: {
        afterConcurrentCheck: async () => {
          await jobPool.query(
            `
              INSERT INTO onec_import_jobs (mode, expected_sha256, expires_at)
              VALUES ('apply', $1, NOW() + INTERVAL '1 hour')
            `,
            [staleFingerprint],
          );
          workerPromise = runOneImportJob(jobPool, { ...FTP_ENV, DATABASE_URL: databaseUrl }, pausingReader);
          for (let attempt = 0; attempt < 100; attempt += 1) {
            const status = await jobPool.query<{ status: string }>(
              `SELECT status FROM onec_import_jobs ORDER BY requested_at DESC LIMIT 1`,
            );
            if (status.rows[0]?.status === "running") {
              break;
            }
            await new Promise((resolve) => setTimeout(resolve, 20));
          }
        },
      },
    });
    assert.equal(apply.ok, true, JSON.stringify(apply));

    releaseFtp();
    if (workerPromise) {
      assert.equal(await workerPromise, "failed");
    }

    await assertNoStaleAfterCheckClients(jobPool);
    await jobPool.end();
  });

  it("operator worker re-checks job after import lock and rejects deleted job", async () => {
    const cleanApply = await applyCleanReload(databaseUrl, bundleDir);
    assert.equal(cleanApply.ok, true);

    const staleBytes = buildStaleAfterCheckClientsBytes();
    const staleFingerprint = buildImportVerificationFingerprint(
      JSON.parse(staleBytes.toString("utf8")) as Record<string, unknown>[],
    );

    const pool = new Pool({ connectionString: databaseUrl, max: 2 });
    const job = await pool.query<{ id: string }>(
      `
        INSERT INTO onec_import_jobs (mode, expected_sha256, status, expires_at)
        VALUES ('apply', $1, 'running', NOW() + INTERVAL '1 hour')
        RETURNING id::text
      `,
      [staleFingerprint],
    );

    const importResult = await runClientsImport({
      env: { ...FTP_ENV, DATABASE_URL: databaseUrl },
      argv: ["--apply", "--expected-sha256", staleFingerprint],
      fileBytes: staleBytes,
      triggerSource: "operator_job",
      operatorImportJobId: job.rows[0]!.id,
      applyTestHooks: {
        afterImportLock: async (client) => {
          await client.query(`DELETE FROM onec_import_jobs WHERE id = $1::uuid`, [job.rows[0]!.id]);
        },
      },
    });

    assert.equal(importResult.status, "IMPORT_JOB_SUPERSEDED");
    await assertNoStaleAfterCheckClients(pool);
    await pool.end();
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
