import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import request from "supertest";
import { applyClientsImport } from "../../src/onec-clients/apply";
import { setHoldingV2PipelineEnabledForTests } from "../../src/onec-clients/holding-v2-pipeline-config";
import { verificationFingerprintFromPayload } from "../../src/onec-clients/import-verification-fingerprint";
import { validateHoldingV2ClientsFileBytes } from "../../src/onec-clients/validate";
import { closePool, resetPoolForTests } from "../../src/db/pool";
import { listClients } from "../../src/clients/repository";
import { parseClientsListQuery } from "../../src/clients/query";
import { insertSuccessfulImportRun } from "../helpers/clients-db-fixtures";
import {
  buildHoldingV2FileBytes,
  headRow,
  minimalOutlet,
  typeCategory,
} from "../helpers/holding-v2-fixtures";
import { linkUserToEmployee } from "../helpers/access-db-fixtures";
import { createTestUser, getIntegrationDatabaseUrl, prepareDatabase, setIntegrationEnv } from "../helpers/test-db";
import { Pool } from "pg";

const ORIGIN = "http://127.0.0.1:3000";
const TEST_PASSWORD = "StrongPass123!";
const H1 = "a1000000-0000-4000-8000-000000000001";
const H2 = "a1000000-0000-4000-8000-000000000002";
const S1 = "b1000000-0000-4000-8000-000000000001";
const S2 = "b1000000-0000-4000-8000-000000000002";
const M1 = "22222222-2222-4222-8222-222222222222";
const M2 = "55555555-5555-4555-8555-555555555555";

const MONO_TYPE = "Filter Mono Type Name";

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
  return res.headers["set-cookie"]?.[0]?.split(";")[0] ?? "";
}

async function seedWholesaleRoster(databaseUrl: string): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  try {
    await pool.query(
      `
        INSERT INTO onec_wholesale_roster_state (id, source_sha256, employee_count)
        VALUES (1, $1, 2)
        ON CONFLICT (id) DO UPDATE SET employee_count = 2
      `,
      ["d".repeat(64)],
    );
    for (const row of [
      [M1, "Manager One"],
      [M2, "Manager Two"],
    ] as const) {
      await pool.query(
        `
          INSERT INTO onec_wholesale_employee_roster (guid_manager, name_manager, post, raw_json)
          VALUES ($1::uuid, $2, 'Менеджер', '{}'::jsonb)
          ON CONFLICT (guid_manager) DO UPDATE SET name_manager = EXCLUDED.name_manager
        `,
        [row[0], row[1]],
      );
    }
  } finally {
    await pool.end();
  }
}

describe("clients list holding v2 scoped filters", { concurrency: false }, () => {
  let databaseUrl = "";

  before(async () => {
    databaseUrl = getIntegrationDatabaseUrl();
    setIntegrationEnv(databaseUrl);
    await prepareDatabase(databaseUrl);
  });

  beforeEach(async () => {
    setIntegrationEnv(databaseUrl);
    await prepareDatabase(databaseUrl);
    setHoldingV2PipelineEnabledForTests(true);

    const bytes = buildHoldingV2FileBytes([
      headRow(H1, {
        name_client: "Filter Mono Client",
        guid_manager: M1,
        type_category: typeCategory({ guid_type: "f-mono", name_type: MONO_TYPE }),
        retail_outlets: [
          minimalOutlet(S1, {
            address: { store_address: "Filter Store One" },
            managers: { guid_manager: M1, name_manager: "Manager One" },
          }),
          minimalOutlet(S2, {
            address: { store_address: "Filter Store Two" },
            managers: { guid_manager: M2, name_manager: "Manager Two" },
          }),
        ],
      }),
    ]);
    const validated = validateHoldingV2ClientsFileBytes(bytes);
    assert.equal(validated.ok, true);
    if (!validated.ok) return;
    const fp = verificationFingerprintFromPayload({ payload: validated.payload });
    const applied = await applyClientsImport({
      databaseUrl,
      payload: validated.payload,
      expectedVerificationFingerprint: fp,
    });
    assert.equal(applied.ok, true);

    await seedWholesaleRoster(databaseUrl);
    await insertSuccessfulImportRun(databaseUrl);
  });

  after(async () => {
    setHoldingV2PipelineEnabledForTests(undefined);
    await closePool();
  });

  it("admin: composition and type filters match SQL totals before pagination", async () => {
    const adminUser = await createTestUser({
      databaseUrl,
      email: "admin-hv2-filter@test.local",
      password: TEST_PASSWORD,
      fullName: "Admin HV2 Filter",
      role: "admin",
    });
    const cookie = await login("admin-hv2-filter@test.local");
    const app = await loadApp();

    const directParsed = parseClientsListQuery({
      view: "all",
      entity: "clients",
      page: "1",
      pageSize: "50",
      holdingV2Composition: "mono_network",
    });
    assert.equal(directParsed.ok, true);
    if (!directParsed.ok) return;
    const directList = await listClients(
      {
        userId: adminUser.id,
        role: "admin",
        fullClientBase: true,
        hasScopedClientAccess: true,
        hasEmployeeLink: false,
        employeeLinkConflict: false,
        explicitlyDeniedAll: false,
      },
      directParsed.query,
    );
    assert.equal(directList.total, 1);

    const baseline = await request(app)
      .get("/api/clients?view=all&entity=clients&page=1&pageSize=50")
      .set({ Origin: ORIGIN, Cookie: cookie });
    assert.equal(baseline.status, 200);
    assert.equal(baseline.body.total, 1);

    const monoList = await request(app)
      .get("/api/clients?view=all&entity=clients&page=1&pageSize=50&holdingV2Composition=mono_network")
      .set({ Origin: ORIGIN, Cookie: cookie });
    assert.equal(monoList.status, 200);
    assert.equal(monoList.body.total, 1);
    assert.equal(monoList.body.items[0]?.guid?.toLowerCase(), H1.toLowerCase());

    const typeList = await request(app)
      .get(
        `/api/clients?view=all&entity=clients&page=1&pageSize=50&holdingV2NameType=${encodeURIComponent(MONO_TYPE)}`,
      )
      .set({ Origin: ORIGIN, Cookie: cookie });
    assert.equal(typeList.status, 200);
    assert.equal(typeList.body.total, 1);
    assert.equal(typeList.body.items[0]?.guid?.toLowerCase(), H1.toLowerCase());

    const options = await request(app).get("/api/clients/options").set({ Origin: ORIGIN, Cookie: cookie });
    assert.equal(options.status, 200);
    const compIds = (options.body.holdingV2CompositionValues || []).map((row: { id: string }) => row.id);
    assert.ok(compIds.includes("mono_network"));
    assert.ok(!compIds.includes("withheld"));
    const typeValues = (options.body.holdingV2NameTypeValues || []).map((row: { id: string }) => row.id);
    assert.ok(typeValues.includes(MONO_TYPE));
  });

  it("manager with partial TT scope: mono filter excludes withheld holding; withheld filter includes it", async () => {
    const adminUser = await createTestUser({
      databaseUrl,
      email: "admin-hv2-filter-mgr@test.local",
      password: TEST_PASSWORD,
      fullName: "Admin HV2 Filter Mgr",
      role: "admin",
    });
    const managerUser = await createTestUser({
      databaseUrl,
      email: "manager-hv2-filter@test.local",
      password: TEST_PASSWORD,
      fullName: "Manager HV2 Filter",
      role: "manager",
    });
    await linkUserToEmployee({
      databaseUrl,
      userId: managerUser.id,
      employeeId: M1,
      confirmedByUserId: adminUser.id,
    });

    const cookie = await login("manager-hv2-filter@test.local");
    const app = await loadApp();

    const monoList = await request(app)
      .get("/api/clients?page=1&pageSize=50&holdingV2Composition=mono_network")
      .set({ Origin: ORIGIN, Cookie: cookie });
    assert.equal(monoList.status, 200);
    assert.equal(monoList.body.total, 0, "must not reveal mono composition through filter when scope is partial");

    const withheldList = await request(app)
      .get("/api/clients?view=all&entity=clients&page=1&pageSize=50&holdingV2Composition=withheld")
      .set({ Origin: ORIGIN, Cookie: cookie });
    assert.equal(withheldList.status, 200);
    assert.equal(withheldList.body.total, 1);
    assert.equal(withheldList.body.items[0]?.guid?.toLowerCase(), H1.toLowerCase());
    assert.match(withheldList.body.items[0]?.holdingV2CompositionLabel ?? "", /Скрыто по области доступа/);

    const mgrOptions = await request(app).get("/api/clients/options").set({ Origin: ORIGIN, Cookie: cookie });
    assert.equal(mgrOptions.status, 200);
    const compIds = (mgrOptions.body.holdingV2CompositionValues || []).map((row: { id: string }) => row.id);
    assert.ok(compIds.includes("withheld"));
    assert.ok(!compIds.includes("mono_network"));
  });
});
