import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { Pool } from "pg";
import request from "supertest";
import { applyCatalogImport } from "../../src/onec-catalog/apply";
import { parseCatalogSet } from "../../src/onec-catalog/parse-catalog-set";
import { validateCatalogSet } from "../../src/onec-catalog/validate-catalog-set";
import { readExtendedSnapshot } from "../../src/onec-clients/extended-apply";
import { closePool, resetPoolForTests } from "../../src/db/pool";
import { grantClientAccess, linkUserToEmployee } from "../helpers/access-db-fixtures";
import {
  buildMinimalDistributionXmlSet,
  catalogDistributionEntriesFromXmlSet,
} from "../helpers/onec-catalog-fixtures";
import { applyClientsImportVerified } from "../helpers/onec-clients-fixtures";
import {
  buildExtendedClientsFileBytes,
  EXTENDED_FIXTURE_GUIDS,
  sampleExtendedHolding,
  sampleIdentifiedOutlet,
  validateClientsForApplyTest,
} from "../helpers/onec-clients-extended-fixtures";
import {
  createTestUser,
  getIntegrationDatabaseUrl,
  prepareDatabase,
  setIntegrationEnv,
} from "../helpers/test-db";

const ORIGIN = "http://127.0.0.1:3000";
const TEST_PASSWORD = "StrongPass123!";
const CLIENT_GUID = EXTENDED_FIXTURE_GUIDS.HOLDING_GUID;
const STORE_ONE = EXTENDED_FIXTURE_GUIDS.STORE_ONE;
const REGIONAL = EXTENDED_FIXTURE_GUIDS.REGIONAL;
const OTHER_REGIONAL = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

function authHeaders(cookie: string): Record<string, string> {
  return { Origin: ORIGIN, Cookie: cookie };
}

async function loadApp() {
  await resetPoolForTests();
  const { createApp } = await import("../../src/server");
  return createApp();
}

async function login(email: string): Promise<string> {
  const app = await loadApp();
  const res = await request(app)
    .post("/api/auth/login")
    .set({ Origin: ORIGIN, "Content-Type": "application/json" })
    .send({ email, password: TEST_PASSWORD });
  assert.equal(res.status, 200);
  return (res.headers["set-cookie"]?.[0] ?? "").split(";")[0] ?? "";
}

async function seedCatalog(databaseUrl: string): Promise<string> {
  const xmlSet = buildMinimalDistributionXmlSet();
  const entries = catalogDistributionEntriesFromXmlSet(xmlSet);
  const parsed = await parseCatalogSet(
    entries.map((file) => ({ relativePath: file.relativePath, bytes: file.bytes })),
    "distribution",
  );
  assert.equal(parsed.ok, true);
  const validated = validateCatalogSet(parsed.data!, { profile: "distribution" });
  assert.equal(validated.ok, true);
  const applied = await applyCatalogImport(databaseUrl, validated.data!);
  assert.equal(applied.ok, true);
  return applied.versionId;
}

function snapshotWithoutRegionalAccess(snapshot: unknown): unknown {
  const parsed = readExtendedSnapshot(snapshot);
  assert.ok(parsed);
  const copy = JSON.parse(JSON.stringify(parsed)) as typeof parsed;
  const outlet = copy.currentRetailOutlets[0];
  assert.ok(outlet);
  outlet.managers.regionalManager = { guid: OTHER_REGIONAL, name: "Other Regional", state: "directory_unverified" };
  return copy;
}

describe("PR41 R3 distribution write access revalidation", { concurrency: false }, () => {
  let databaseUrl = "";
  let catalogVersionId = "";
  let regionalCookie = "";

  before(async () => {
    databaseUrl = getIntegrationDatabaseUrl();
    setIntegrationEnv(databaseUrl, ORIGIN);
    await prepareDatabase(databaseUrl);
  });

  beforeEach(async () => {
    setIntegrationEnv(databaseUrl, ORIGIN);
    await prepareDatabase(databaseUrl);
    const admin = await createTestUser({
      databaseUrl,
      email: "admin@example.com",
      password: TEST_PASSWORD,
      fullName: "Admin",
      role: "admin",
    });
    const regional = await createTestUser({
      databaseUrl,
      email: "regional@example.com",
      password: TEST_PASSWORD,
      fullName: "Regional",
      role: "regional_manager",
    });
    await linkUserToEmployee({
      databaseUrl,
      userId: regional.id,
      employeeId: REGIONAL,
      confirmedByUserId: admin.id,
    });
    await grantClientAccess({
      databaseUrl,
      userId: regional.id,
      objectId: CLIENT_GUID,
      grantedByUserId: admin.id,
    });

    const bytes = buildExtendedClientsFileBytes([
      sampleExtendedHolding({
        retail_outlets: [
          sampleIdentifiedOutlet({
            guid_store: STORE_ONE,
            closed: false,
            managers: {
              guid_manager: "",
              name_manager: "",
              guid_regional_manager: REGIONAL,
              name_regional_manager: "Regional Lead",
              guid_hardware_manager: "",
              name_hardware_manager: "",
              guid_head_of_the_sales_department: "",
              name_head_of_the_sales_department: "",
            },
          }),
        ],
      }),
    ]);
    const validated = validateClientsForApplyTest(bytes);
    assert.equal(validated.ok, true);
    if (!validated.ok) return;
    const applied = await applyClientsImportVerified({ databaseUrl, payload: validated.payload });
    assert.equal(applied.ok, true, applied.ok ? "" : `${applied.code}: ${applied.message}`);

    catalogVersionId = await seedCatalog(databaseUrl);
    regionalCookie = await login("regional@example.com");
  });

  after(async () => {
    await closePool();
  });

  it("rejects marker write when regional assignment changes while waiting on client lock", async () => {
    const app = await loadApp();
    const url = `/api/clients/${CLIENT_GUID}/catalog/outlets/${STORE_ONE}/distribution/markers`;
    const body = {
      action: "set",
      markerKind: "installed",
      productCode: "p1",
      versionId: catalogVersionId,
    };

    const pool = new Pool({ connectionString: databaseUrl, max: 2 });
    const holder = await pool.connect();
    try {
      await holder.query("BEGIN");
      const locked = await holder.query<{ extended_snapshot: unknown }>(
        `SELECT extended_snapshot FROM onec_clients WHERE guid_client = $1::uuid FOR UPDATE`,
        [CLIENT_GUID],
      );
      assert.equal(locked.rowCount, 1);

      let postSettled = false;
      let postResult: Awaited<ReturnType<typeof request>> | null = null;
      void request(app)
        .post(url)
        .set({ Origin: ORIGIN, Cookie: regionalCookie, "Content-Type": "application/json" })
        .send(body)
        .then((res) => {
          postResult = res;
          postSettled = true;
        });

      const deadline = Date.now() + 5000;
      while (!postSettled && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      assert.equal(postSettled, false, "POST should wait on client row lock");

      const updatedSnapshot = snapshotWithoutRegionalAccess(locked.rows[0]!.extended_snapshot);
      await holder.query(
        `UPDATE onec_clients SET extended_snapshot = $2::jsonb WHERE guid_client = $1::uuid`,
        [CLIENT_GUID, JSON.stringify(updatedSnapshot)],
      );
      await holder.query("COMMIT");

      const waitDeadline = Date.now() + 15000;
      while (!postSettled && Date.now() < waitDeadline) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      assert.ok(postResult, "POST did not settle");
      assert.equal(postResult!.status, 404, JSON.stringify(postResult!.body));

      const events = await pool.query<{ n: number }>(
        `SELECT COUNT(*)::int AS n FROM outlet_distribution_marker_events WHERE product_code = 'p1'`,
      );
      assert.equal(events.rows[0]?.n, 0);
    } finally {
      await holder.query("ROLLBACK").catch(() => undefined);
      holder.release();
      await pool.end();
    }
  });

  it("allows write before assignment change and blocks subsequent reads", async () => {
    const app = await loadApp();
    const url = `/api/clients/${CLIENT_GUID}/catalog/outlets/${STORE_ONE}/distribution/markers`;
    const body = {
      action: "set",
      markerKind: "installed",
      productCode: "p1",
      versionId: catalogVersionId,
    };

    const saved = await request(app)
      .post(url)
      .set({ Origin: ORIGIN, Cookie: regionalCookie, "Content-Type": "application/json" })
      .send(body);
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    assert.equal(saved.body.changed, true);

    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    const row = await pool.query<{ extended_snapshot: unknown }>(
      `SELECT extended_snapshot FROM onec_clients WHERE guid_client = $1::uuid`,
      [CLIENT_GUID],
    );
    const updatedSnapshot = snapshotWithoutRegionalAccess(row.rows[0]!.extended_snapshot);
    await pool.query(`UPDATE onec_clients SET extended_snapshot = $2::jsonb WHERE guid_client = $1::uuid`, [
      CLIENT_GUID,
      JSON.stringify(updatedSnapshot),
    ]);
    await pool.end();

    const denied = await request(app)
      .get(`/api/clients/${CLIENT_GUID}/catalog/outlets/${STORE_ONE}/distribution`)
      .set(authHeaders(regionalCookie));
    assert.equal(denied.status, 404);
  });
});
