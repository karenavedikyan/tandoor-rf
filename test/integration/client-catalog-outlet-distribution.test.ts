import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { Pool } from "pg";
import request from "supertest";
import { applyCatalogImport } from "../../src/onec-catalog/apply";
import { parseCatalogSet } from "../../src/onec-catalog/parse-catalog-set";
import { validateCatalogSet } from "../../src/onec-catalog/validate-catalog-set";
import { closePool, resetPoolForTests } from "../../src/db/pool";
import {
  buildMinimalDistributionXmlSet,
  catalogDistributionEntriesFromXmlSet,
} from "../helpers/onec-catalog-fixtures";
import { applyClientsImportVerified } from "../helpers/onec-clients-fixtures";
import { validateClientsFileBytes } from "../../src/onec-clients/validate";
import {
  buildClientsFileBytes,
  sampleClient,
} from "../helpers/onec-clients-fixtures";
import {
  buildExtendedClientsFileBytes,
  EXTENDED_FIXTURE_GUIDS,
  sampleExtendedHolding,
  sampleIdentifiedOutlet,
  validateClientsForApplyTest,
} from "../helpers/onec-clients-extended-fixtures";
import { grantClientAccess, linkUserToEmployee } from "../helpers/access-db-fixtures";
import { insertSyntheticClients } from "../helpers/clients-db-fixtures";
import {
  createTestUser,
  getIntegrationDatabaseUrl,
  prepareDatabase,
  setIntegrationEnv,
} from "../helpers/test-db";

const ORIGIN = "http://127.0.0.1:3000";
const TEST_PASSWORD = "StrongPass123!";
const CLIENT_ONE = "11111111-1111-4111-8111-111111111111";
const STORE_ONE = EXTENDED_FIXTURE_GUIDS.STORE_ONE;
const STORE_TWO = EXTENDED_FIXTURE_GUIDS.STORE_TWO;
const MANAGER_A = EXTENDED_FIXTURE_GUIDS.MANAGER_A;
const FOREIGN_CLIENT = "44444444-4444-4444-8444-444444444444";
const IMPORT_PAUSE_ADVISORY_KEY = 987654321;

async function installImportPauseTrigger(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE OR REPLACE FUNCTION test_pause_client_import() RETURNS trigger AS $$
    BEGIN
      PERFORM pg_advisory_lock(${IMPORT_PAUSE_ADVISORY_KEY});
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);
  await pool.query(`
    DROP TRIGGER IF EXISTS test_pause_client_import_trg ON onec_clients;
    CREATE TRIGGER test_pause_client_import_trg
    AFTER UPDATE ON onec_clients
    FOR EACH ROW
    EXECUTE FUNCTION test_pause_client_import();
  `);
}

async function dropImportPauseTrigger(pool: Pool): Promise<void> {
  await pool.query(`DROP TRIGGER IF EXISTS test_pause_client_import_trg ON onec_clients`);
  await pool.query(`DROP FUNCTION IF EXISTS test_pause_client_import()`);
}

async function waitForImportPausedOnClient(pool: Pool, timeoutMs = 20000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await pool.query<{ count: string }>(
      `
        SELECT COUNT(*)::text AS count
        FROM pg_locks
        WHERE locktype = 'advisory'
          AND objid = $1::bigint
          AND NOT granted
      `,
      [IMPORT_PAUSE_ADVISORY_KEY],
    );
    if (Number(result.rows[0]?.count ?? "0") >= 1) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Timed out waiting for import to pause on client update");
}

async function isImportWaitingOnPause(pool: Pool): Promise<boolean> {
  const result = await pool.query<{ count: string }>(
    `
      SELECT COUNT(*)::text AS count
      FROM pg_locks
      WHERE locktype = 'advisory'
        AND objid = $1::bigint
        AND NOT granted
    `,
    [IMPORT_PAUSE_ADVISORY_KEY],
  );
  return Number(result.rows[0]?.count ?? "0") >= 1;
}

async function waitForSaveBlockedWhileImportPaused(
  pool: Pool,
  isPostSettled: () => boolean,
  timeoutMs = 5000,
): Promise<void> {
  let confirmed = 0;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (isPostSettled()) {
      throw new Error("marker save completed before import pause was released");
    }
    if (await isImportWaitingOnPause(pool)) {
      confirmed += 1;
      if (confirmed >= 3) {
        return;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Timed out waiting for marker save to block on import-held client lock");
}

function buildCloseOutletImportBytes(closedStoreGuid: string, nameSuffix: string): Buffer {
  return buildExtendedClientsFileBytes([
    sampleExtendedHolding({
      guid_client: CLIENT_ONE,
      name_client: `Client Alpha Close Outlet Import ${nameSuffix}`,
      retail_outlets: [
        sampleIdentifiedOutlet({
          guid_store: STORE_ONE,
          closed: closedStoreGuid === STORE_ONE,
        }),
        sampleIdentifiedOutlet({
          guid_store: STORE_TWO,
          closed: closedStoreGuid === STORE_TWO,
          address: { store_address: "Second store", delivery_address: "", direction_of_the_route: "" },
        }),
      ],
    }),
    sampleClient({
      guid_client: FOREIGN_CLIENT,
      name_client: "Foreign",
      guid_manager: MANAGER_A,
      name_manager: "Manager",
    }),
  ]);
}

function buildCloseStoreOneImportBytes(): Buffer {
  return buildCloseOutletImportBytes(STORE_ONE, "one");
}

async function applyCloseOutletImport(
  databaseUrl: string,
  closedStoreGuid: string,
  nameSuffix: string,
): Promise<{ ok: boolean; code?: string; message?: string }> {
  const bytes = buildCloseOutletImportBytes(closedStoreGuid, nameSuffix);
  const validated = validateClientsForApplyTest(bytes);
  if (!validated.ok) {
    return { ok: false, code: "VALIDATION", message: "validation failed" };
  }
  const applied = await applyClientsImportVerified({ databaseUrl, payload: validated.payload });
  return applied.ok
    ? { ok: true }
    : { ok: false, code: applied.code, message: applied.message };
}

async function applyCloseStoreOneImport(
  databaseUrl: string,
): Promise<{ ok: boolean; code?: string; message?: string }> {
  return applyCloseOutletImport(databaseUrl, STORE_ONE, "one");
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

async function seedDistributionCatalog(databaseUrl: string): Promise<{ versionId: string }> {
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
  return { versionId: applied.versionId };
}

async function seedClientWithOutlets(databaseUrl: string): Promise<void> {
  const bytes = buildExtendedClientsFileBytes([
    sampleExtendedHolding({
      guid_client: CLIENT_ONE,
      retail_outlets: [
        sampleIdentifiedOutlet({ guid_store: STORE_ONE, closed: false }),
        sampleIdentifiedOutlet({
          guid_store: STORE_TWO,
          closed: false,
          address: { store_address: "Second store", delivery_address: "", direction_of_the_route: "" },
        }),
      ],
    }),
  ]);
  const validated = validateClientsForApplyTest(bytes);
  assert.equal(validated.ok, true);
  if (!validated.ok) return;
  const applied = await applyClientsImportVerified({ databaseUrl, payload: validated.payload });
  assert.equal(applied.ok, true, applied.ok ? "" : `${applied.code}: ${applied.message}`);
}

describe("client catalog outlet distribution integration", { concurrency: false }, () => {
  let databaseUrl = "";
  let catalogVersionId = "";

  before(async () => {
    databaseUrl = getIntegrationDatabaseUrl();
    setIntegrationEnv(databaseUrl, ORIGIN);
    await prepareDatabase(databaseUrl);
  });

  beforeEach(async () => {
    setIntegrationEnv(databaseUrl, ORIGIN);
    await resetPoolForTests();
    await prepareDatabase(databaseUrl);
    await createTestUser({
      databaseUrl,
      email: "admin@example.com",
      password: TEST_PASSWORD,
      fullName: "Admin",
      role: "admin",
    });
    const manager = await createTestUser({
      databaseUrl,
      email: "manager@example.com",
      password: TEST_PASSWORD,
      fullName: "Manager",
      role: "manager",
    });
    await linkUserToEmployee({
      databaseUrl,
      userId: manager.id,
      employeeId: MANAGER_A,
      confirmedByUserId: manager.id,
    });
    await seedClientWithOutlets(databaseUrl);
    await insertSyntheticClients(databaseUrl, [
      {
        guid_client: FOREIGN_CLIENT,
        name_client: "Foreign",
        guid_manager: MANAGER_A,
        name_manager: "Manager",
      },
    ]);
    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    const seeded = await pool.query<{ clients: string; outlets: string }>(
      `
        SELECT
          (SELECT COUNT(*)::text FROM onec_clients WHERE guid_client = $1::uuid) AS clients,
          (SELECT COUNT(*)::text FROM onec_retail_outlets WHERE guid_client = $1::uuid) AS outlets
      `,
      [CLIENT_ONE],
    );
    await pool.end();
    assert.equal(seeded.rows[0]?.clients, "1");
    assert.equal(seeded.rows[0]?.outlets, "2");
    const catalog = await seedDistributionCatalog(databaseUrl);
    catalogVersionId = catalog.versionId;
    await grantClientAccess({
      databaseUrl,
      userId: manager.id,
      objectId: CLIENT_ONE,
      grantedByUserId: manager.id,
    });
  });

  after(async () => {
    await closePool();
  });

  it("lists writable outlets without auto-selection", async () => {
    const cookie = await login("admin@example.com");
    const app = await loadApp();
    const res = await request(app)
      .get(`/api/clients/${CLIENT_ONE}/catalog/outlets`)
      .set({ Origin: ORIGIN, Cookie: cookie });
    assert.equal(res.status, 200);
    assert.equal(res.body.outlets.length, 2);
    assert.equal(res.body.outlets[0].distributionWritable, true);
    assert.equal(res.headers["cache-control"], "no-store");
  });

  it("blocks marker write until outlet is selected and writable", async () => {
    const cookie = await login("admin@example.com");
    const app = await loadApp();
    const blocked = await request(app)
      .post(`/api/clients/${CLIENT_ONE}/catalog/outlets/${STORE_ONE}/distribution/markers`)
      .set({ Origin: ORIGIN, Cookie: cookie, "Content-Type": "application/json" })
      .send({
        action: "set",
        markerKind: "installed",
        productCode: "p1",
        versionId: catalogVersionId,
      });
    assert.equal(blocked.status, 200);

    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    const closed = await pool.query(
      `UPDATE onec_retail_outlets SET is_closed = TRUE WHERE guid_store = $1::uuid`,
      [STORE_TWO],
    );
    assert.equal(closed.rowCount, 1);
    await pool.end();

    const closedWrite = await request(app)
      .post(`/api/clients/${CLIENT_ONE}/catalog/outlets/${STORE_TWO}/distribution/markers`)
      .set({ Origin: ORIGIN, Cookie: cookie, "Content-Type": "application/json" })
      .send({
        action: "set",
        markerKind: "planned",
        productCode: "p1",
        versionId: catalogVersionId,
      });
    assert.equal(closedWrite.status, 422);
    assert.equal(closedWrite.body.code, "OUTLET_NOT_WRITABLE");
  });

  it("persists installed/planned markers without duplicates and survives reload", async () => {
    const cookie = await login("manager@example.com");
    const app = await loadApp();
    const url = `/api/clients/${CLIENT_ONE}/catalog/outlets/${STORE_ONE}/distribution/markers`;
    const body = {
      action: "set",
      markerKind: "installed",
      productCode: "p1",
      versionId: catalogVersionId,
    };
    const first = await request(app)
      .post(url)
      .set({ Origin: ORIGIN, Cookie: cookie, "Content-Type": "application/json" })
      .send(body);
    assert.equal(first.status, 200);
    assert.equal(first.body.changed, true);

    const second = await request(app)
      .post(url)
      .set({ Origin: ORIGIN, Cookie: cookie, "Content-Type": "application/json" })
      .send(body);
    assert.equal(second.status, 200);
    assert.equal(second.body.changed, false);

    await request(app)
      .post(url)
      .set({ Origin: ORIGIN, Cookie: cookie, "Content-Type": "application/json" })
      .send({ action: "set", markerKind: "planned", productCode: "p1", versionId: catalogVersionId });

    const list = await request(app)
      .get(`/api/clients/${CLIENT_ONE}/catalog/products?storeGuid=${STORE_ONE}&versionId=${catalogVersionId}`)
      .set({ Origin: ORIGIN, Cookie: cookie });
    assert.equal(list.status, 200);
    const item = list.body.items.find((row: { code: string }) => row.code === "p1");
    assert.equal(item.distribution.installed, true);
    assert.equal(item.distribution.planned, true);

    const summary = await request(app)
      .get(`/api/clients/${CLIENT_ONE}/catalog/outlets/${STORE_ONE}/distribution`)
      .set({ Origin: ORIGIN, Cookie: cookie });
    assert.equal(summary.body.installed.length, 1);
    assert.equal(summary.body.planned.length, 1);
  });

  it("rejects foreign client outlet and revoked access", async () => {
    const cookie = await login("manager@example.com");
    const app = await loadApp();
    const foreign = await request(app)
      .get(`/api/clients/${FOREIGN_CLIENT}/catalog/outlets/${STORE_ONE}/distribution`)
      .set({ Origin: ORIGIN, Cookie: cookie });
    assert.equal(foreign.status, 404);

    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    await pool.query(`DELETE FROM access_grants WHERE object_id = $1::uuid`, [CLIENT_ONE]);
    await pool.query(`UPDATE onec_clients SET guid_manager = $2::uuid WHERE guid_client = $1::uuid`, [
      CLIENT_ONE,
      "55555555-5555-4555-8555-555555555555",
    ]);
    await pool.end();

    const denied = await request(app)
      .get(`/api/clients/${CLIENT_ONE}/catalog/outlets/${STORE_ONE}/distribution`)
      .set({ Origin: ORIGIN, Cookie: cookie });
    assert.equal(denied.status, 404);
  });

  it("returns CATALOG_VERSION_CHANGED on stale versionId", async () => {
    const cookie = await login("admin@example.com");
    const app = await loadApp();
    const res = await request(app)
      .post(`/api/clients/${CLIENT_ONE}/catalog/outlets/${STORE_ONE}/distribution/markers`)
      .set({ Origin: ORIGIN, Cookie: cookie, "Content-Type": "application/json" })
      .send({
        action: "set",
        markerKind: "installed",
        productCode: "p1",
        versionId: "00000000-0000-4000-8000-000000000099",
      });
    assert.equal(res.status, 409);
    assert.equal(res.body.code, "CATALOG_VERSION_CHANGED");
  });

  it("keeps historical installed marker when product disappears from new catalog", async () => {
    const cookie = await login("admin@example.com");
    const app = await loadApp();
    await request(app)
      .post(`/api/clients/${CLIENT_ONE}/catalog/outlets/${STORE_ONE}/distribution/markers`)
      .set({ Origin: ORIGIN, Cookie: cookie, "Content-Type": "application/json" })
      .send({
        action: "set",
        markerKind: "installed",
        productCode: "p1",
        versionId: catalogVersionId,
      });

    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    await pool.query(`DELETE FROM onec_catalog_products WHERE code = 'p1' AND version_id = $1::uuid`, [
      catalogVersionId,
    ]);
    await pool.end();

    const summary = await request(app)
      .get(`/api/clients/${CLIENT_ONE}/catalog/outlets/${STORE_ONE}/distribution`)
      .set({ Origin: ORIGIN, Cookie: cookie });
    assert.equal(summary.body.installed.length, 1);
    assert.equal(summary.body.installed[0].productCode, "p1");
    assert.equal(summary.body.installed[0].inCurrentCatalog, false);
  });

  it("revalidates saved outlet selection via meta storeGuid", async () => {
    const cookie = await login("manager@example.com");
    const app = await loadApp();
    const meta = await request(app)
      .get(`/api/clients/${CLIENT_ONE}/catalog/meta?storeGuid=${STORE_ONE}`)
      .set({ Origin: ORIGIN, Cookie: cookie });
    assert.equal(meta.status, 200);
    assert.equal(meta.body.selectedStoreGuid, STORE_ONE);
    assert.equal(meta.body.outletConfirmed, true);
    assert.equal(meta.body.distributionEnabled, true);
  });

  it("blocks marker write when extended snapshot is stale after baseline-only reimport", async () => {
    const baselineBytes = buildClientsFileBytes([
      sampleClient({
        guid_client: CLIENT_ONE,
        name_client: "Client Alpha Baseline Refresh",
      }),
      sampleClient({
        guid_client: FOREIGN_CLIENT,
        name_client: "Foreign",
        guid_manager: MANAGER_A,
        name_manager: "Manager",
      }),
    ]);
    const validated = validateClientsFileBytes(baselineBytes);
    assert.equal(validated.ok, true);
    if (!validated.ok) return;
    const applied = await applyClientsImportVerified({ databaseUrl, payload: validated.payload });
    assert.equal(applied.ok, true, applied.ok ? "" : `${applied.code}: ${applied.message}`);

    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    const row = await pool.query<{
      source_sha256: string;
      extended_source_sha256: string | null;
      extended_freshness_state: string | null;
    }>(
      `
        SELECT source_sha256, extended_source_sha256, extended_freshness_state
        FROM onec_clients
        WHERE guid_client = $1::uuid
      `,
      [CLIENT_ONE],
    );
    await pool.end();
    assert.notEqual(row.rows[0]?.source_sha256, row.rows[0]?.extended_source_sha256);
    assert.equal(row.rows[0]?.extended_freshness_state, "preserved_from_previous");

    const cookie = await login("admin@example.com");
    const app = await loadApp();
    const res = await request(app)
      .post(`/api/clients/${CLIENT_ONE}/catalog/outlets/${STORE_ONE}/distribution/markers`)
      .set({ Origin: ORIGIN, Cookie: cookie, "Content-Type": "application/json" })
      .send({
        action: "set",
        markerKind: "installed",
        productCode: "p1",
        versionId: catalogVersionId,
      });
    assert.equal(res.status, 422);
    assert.equal(res.body.code, "OUTLET_NOT_WRITABLE");
  });

  it("serializes concurrent identical marker sets without duplicate events", async () => {
    const cookie = await login("admin@example.com");
    const app = await loadApp();
    const url = `/api/clients/${CLIENT_ONE}/catalog/outlets/${STORE_ONE}/distribution/markers`;
    const body = {
      action: "set",
      markerKind: "installed",
      productCode: "p1",
      versionId: catalogVersionId,
    };
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        request(app)
          .post(url)
          .set({ Origin: ORIGIN, Cookie: cookie, "Content-Type": "application/json" })
          .send(body),
      ),
    );
    assert.ok(
      results.every((row) => row.status === 200),
      results.map((row) => `${row.status}:${row.body?.code ?? ""}`).join(", "),
    );
    assert.equal(results.filter((row) => row.body.changed).length, 1);

    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    const events = await pool.query<{ n: number }>(
      `
        SELECT COUNT(*)::int AS n
        FROM outlet_distribution_marker_events
        WHERE product_code = 'p1' AND event_kind = 'set'
      `,
    );
    await pool.end();
    assert.equal(events.rows[0]?.n, 1);
  });

  it("serializes concurrent clears and set/clear races", async () => {
    const cookie = await login("admin@example.com");
    const app = await loadApp();
    const url = `/api/clients/${CLIENT_ONE}/catalog/outlets/${STORE_ONE}/distribution/markers`;
    await request(app)
      .post(url)
      .set({ Origin: ORIGIN, Cookie: cookie, "Content-Type": "application/json" })
      .send({
        action: "set",
        markerKind: "planned",
        productCode: "p2",
        versionId: catalogVersionId,
      });

    const clears = await Promise.all(
      Array.from({ length: 6 }, () =>
        request(app)
          .post(url)
          .set({ Origin: ORIGIN, Cookie: cookie, "Content-Type": "application/json" })
          .send({
            action: "clear",
            markerKind: "planned",
            productCode: "p2",
            versionId: catalogVersionId,
          }),
      ),
    );
    assert.equal(clears.filter((row) => row.status === 200 && row.body.changed).length, 1);

    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    const afterClears = await pool.query<{ is_active: boolean }>(
      `SELECT is_active FROM outlet_distribution_markers WHERE product_code = 'p2' AND marker_kind = 'planned'`,
    );
    assert.equal(afterClears.rows[0]?.is_active, false);

    const race = await Promise.all([
      request(app)
        .post(url)
        .set({ Origin: ORIGIN, Cookie: cookie, "Content-Type": "application/json" })
        .send({
          action: "set",
          markerKind: "planned",
          productCode: "p2",
          versionId: catalogVersionId,
        }),
      request(app)
        .post(url)
        .set({ Origin: ORIGIN, Cookie: cookie, "Content-Type": "application/json" })
        .send({
          action: "clear",
          markerKind: "planned",
          productCode: "p2",
          versionId: catalogVersionId,
        }),
    ]);
    assert.ok(race.every((row) => row.status === 200));
    const changedCount = race.filter((row) => row.body.changed).length;
    assert.ok(changedCount >= 1 && changedCount <= 2);

    const events = await pool.query<{ event_kind: string }>(
      `
        SELECT event_kind
        FROM outlet_distribution_marker_events
        WHERE product_code = 'p2'
        ORDER BY occurred_at
      `,
    );
    const active = await pool.query<{ is_active: boolean }>(
      `SELECT is_active FROM outlet_distribution_markers WHERE product_code = 'p2' AND marker_kind = 'planned'`,
    );
    await pool.end();
    assert.ok(events.rows.length >= 2);
    if (active.rows[0]?.is_active) {
      assert.equal(events.rows.at(-1)?.event_kind, "set");
    } else {
      assert.equal(events.rows.at(-1)?.event_kind, "clear");
    }
  });

  it("rejects marker save when import closes outlet while save waits on client lock", async () => {
    const cookie = await login("admin@example.com");
    const app = await loadApp();
    const url = `/api/clients/${CLIENT_ONE}/catalog/outlets/${STORE_ONE}/distribution/markers`;
    const body = {
      action: "set",
      markerKind: "installed",
      productCode: "p1",
      versionId: catalogVersionId,
    };

    const pool = new Pool({ connectionString: databaseUrl, max: 3 });
    await installImportPauseTrigger(pool);
    const gate = await pool.connect();
    const observer = await pool.connect();
    try {
      await gate.query(`SELECT pg_advisory_lock($1)`, [IMPORT_PAUSE_ADVISORY_KEY]);

      const importPromise = applyCloseStoreOneImport(databaseUrl);
      await waitForImportPausedOnClient(observer);

      let postSettled = false;
      let postResult: Awaited<ReturnType<typeof request>> | null = null;
      void request(app)
        .post(url)
        .set({ Origin: ORIGIN, Cookie: cookie, "Content-Type": "application/json" })
        .send(body)
        .then((res) => {
          postResult = res;
          postSettled = true;
        });

      await waitForSaveBlockedWhileImportPaused(observer, () => postSettled);

      await gate.query(`SELECT pg_advisory_unlock($1)`, [IMPORT_PAUSE_ADVISORY_KEY]);

      const importResult = await importPromise;
      assert.equal(importResult.ok, true, importResult.message ?? importResult.code ?? "import failed");

      const deadline = Date.now() + 15000;
      while (!postSettled && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      assert.ok(postResult, "marker save did not settle");
      assert.equal(postResult!.status, 422, JSON.stringify(postResult!.body));
      assert.equal(postResult!.body.code, "OUTLET_NOT_WRITABLE");

      const events = await pool.query<{ n: number }>(
        `
          SELECT COUNT(*)::int AS n
          FROM outlet_distribution_marker_events
          WHERE product_code = 'p1' AND event_kind = 'set'
        `,
      );
      assert.equal(events.rows[0]?.n, 0);
    } finally {
      await gate.query(`SELECT pg_advisory_unlock($1)`, [IMPORT_PAUSE_ADVISORY_KEY]).catch(() => undefined);
      gate.release();
      observer.release();
      await dropImportPauseTrigger(pool);
      await pool.end();
    }
  });

  it("completes marker save before import closes outlet and blocks subsequent writes", async () => {
    const cookie = await login("admin@example.com");
    const app = await loadApp();
    const url = `/api/clients/${CLIENT_ONE}/catalog/outlets/${STORE_ONE}/distribution/markers`;
    const body = {
      action: "set",
      markerKind: "installed",
      productCode: "p1",
      versionId: catalogVersionId,
    };

    const saved = await request(app)
      .post(url)
      .set({ Origin: ORIGIN, Cookie: cookie, "Content-Type": "application/json" })
      .send(body);
    assert.equal(saved.status, 200);
    assert.equal(saved.body.changed, true);

    const importResult = await applyCloseStoreOneImport(databaseUrl);
    assert.equal(importResult.ok, true, importResult.message ?? importResult.code ?? "import failed");

    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    const closed = await pool.query<{ is_closed: boolean }>(
      `SELECT is_closed FROM onec_retail_outlets WHERE guid_store = $1::uuid`,
      [STORE_ONE],
    );
    await pool.end();
    assert.equal(closed.rows[0]?.is_closed, true);

    const blocked = await request(app)
      .post(url)
      .set({ Origin: ORIGIN, Cookie: cookie, "Content-Type": "application/json" })
      .send(body);
    assert.equal(blocked.status, 422);
    assert.equal(blocked.body.code, "OUTLET_NOT_WRITABLE");

    const verifyPool = new Pool({ connectionString: databaseUrl, max: 1 });
    const events = await verifyPool.query<{ event_kind: string }>(
      `SELECT event_kind FROM outlet_distribution_marker_events WHERE product_code = 'p1' ORDER BY occurred_at`,
    );
    await verifyPool.end();
    assert.deepEqual(events.rows.map((row) => row.event_kind), ["set"]);
  });

  it("avoids deadlock when import and marker save overlap in either order", async () => {
    const cookie = await login("admin@example.com");
    const app = await loadApp();
    const url = `/api/clients/${CLIENT_ONE}/catalog/outlets/${STORE_ONE}/distribution/markers`;
    const body = {
      action: "set",
      markerKind: "planned",
      productCode: "p2",
      versionId: catalogVersionId,
    };

    const pool = new Pool({ connectionString: databaseUrl, max: 3 });
    await installImportPauseTrigger(pool);
    const gate = await pool.connect();
    const observer = await pool.connect();
    try {
      await gate.query(`SELECT pg_advisory_lock($1)`, [IMPORT_PAUSE_ADVISORY_KEY]);

      const importFirst = applyCloseStoreOneImport(databaseUrl);
      await waitForImportPausedOnClient(observer);

      let saveFirstSettled = false;
      let saveFirstResult: Awaited<ReturnType<typeof request>> | null = null;
      void request(app)
        .post(url)
        .set({ Origin: ORIGIN, Cookie: cookie, "Content-Type": "application/json" })
        .send(body)
        .then((res) => {
          saveFirstResult = res;
          saveFirstSettled = true;
        });

      await waitForSaveBlockedWhileImportPaused(observer, () => saveFirstSettled);
      await gate.query(`SELECT pg_advisory_unlock($1)`, [IMPORT_PAUSE_ADVISORY_KEY]);

      const importFirstResult = await importFirst;
      assert.equal(importFirstResult.ok, true);

      const deadline = Date.now() + 15000;
      while (!saveFirstSettled && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      assert.ok(saveFirstResult);
      assert.notEqual(saveFirstResult!.status, 500, JSON.stringify(saveFirstResult!.body));
      assert.equal(saveFirstResult!.status, 422);
    } finally {
      await gate.query(`SELECT pg_advisory_unlock($1)`, [IMPORT_PAUSE_ADVISORY_KEY]).catch(() => undefined);
      gate.release();
      observer.release();
      await dropImportPauseTrigger(pool);
      await pool.end();
    }

    const urlStoreTwo = `/api/clients/${CLIENT_ONE}/catalog/outlets/${STORE_TWO}/distribution/markers`;
    const saveSecond = await request(app)
      .post(urlStoreTwo)
      .set({ Origin: ORIGIN, Cookie: cookie, "Content-Type": "application/json" })
      .send({
        action: "set",
        markerKind: "planned",
        productCode: "p2",
        versionId: catalogVersionId,
      });
    assert.equal(saveSecond.status, 200);

    const importSecond = await applyCloseOutletImport(databaseUrl, STORE_TWO, "two");
    assert.equal(importSecond.ok, true);

    const blocked = await request(app)
      .post(urlStoreTwo)
      .set({ Origin: ORIGIN, Cookie: cookie, "Content-Type": "application/json" })
      .send({
        action: "set",
        markerKind: "planned",
        productCode: "p2",
        versionId: catalogVersionId,
      });
    assert.equal(blocked.status, 422);
    assert.notEqual(blocked.status, 500);
  });

  it("records history on clear without deleting prior fact row", async () => {
    const cookie = await login("admin@example.com");
    const app = await loadApp();
    const url = `/api/clients/${CLIENT_ONE}/catalog/outlets/${STORE_ONE}/distribution/markers`;
    await request(app)
      .post(url)
      .set({ Origin: ORIGIN, Cookie: cookie, "Content-Type": "application/json" })
      .send({ action: "set", markerKind: "installed", productCode: "p1", versionId: catalogVersionId });
    await request(app)
      .post(url)
      .set({ Origin: ORIGIN, Cookie: cookie, "Content-Type": "application/json" })
      .send({ action: "clear", markerKind: "installed", productCode: "p1", versionId: catalogVersionId });

    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    const events = await pool.query<{ event_kind: string }>(
      `SELECT event_kind FROM outlet_distribution_marker_events WHERE product_code = 'p1' ORDER BY occurred_at`,
    );
    const active = await pool.query<{ is_active: boolean }>(
      `SELECT is_active FROM outlet_distribution_markers WHERE product_code = 'p1'`,
    );
    await pool.end();
    assert.deepEqual(
      events.rows.map((row) => row.event_kind),
      ["set", "clear"],
    );
    assert.equal(active.rows[0]?.is_active, false);
  });
});
