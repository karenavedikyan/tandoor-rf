import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import request from "supertest";
import { closePool, resetPoolForTests } from "../../src/db/pool";
import {
  insertSuccessfulImportRun,
  insertSyntheticClients,
  insertSyntheticRetailOutlets,
  updateClientExtendedSnapshot,
} from "../helpers/clients-db-fixtures";
import { linkUserToEmployee } from "../helpers/access-db-fixtures";
import {
  createTestUser,
  getIntegrationDatabaseUrl,
  prepareDatabase,
  setIntegrationEnv,
} from "../helpers/test-db";

const ORIGIN = "http://127.0.0.1:3000";
const TEST_PASSWORD = "StrongPass123!";
let databaseUrl = "";

const M1 = "22222222-2222-4222-8222-222222222222";
const M2 = "55555555-5555-4555-8555-555555555555";
const C1 = "11111111-1111-4111-8111-111111111111";
const T1 = "44444444-4444-4444-8444-444444444444";
const T2 = "55555555-5555-5555-8555-555555555555";

function buildLpr(overrides: Record<string, unknown> = {}) {
  return {
    name: "LPR Alpha",
    post: "Director",
    dateOfBirth: "1985-03-15",
    phone: "+79001112233",
    email: "alpha@example.test",
    bonus: "0",
    conditionsBonus: "Cond A",
    dateOfBirthConfirmedInCurrentExport: true,
    fieldPresence: {
      name: true,
      post: true,
      phone: true,
      email: true,
      bonus: true,
      conditionsBonus: true,
      dateOfBirth: true,
    },
    ...overrides,
  };
}

function buildOutlet(input: {
  ordinal: number;
  guidStore: string;
  storeAddress: string;
  managerGuid: string;
  lpr?: ReturnType<typeof buildLpr>;
}) {
  return {
    ordinal: input.ordinal,
    guidStore: input.guidStore,
    holdingName: "Holding",
    warehouse: null,
    outletGuidStatus: "confirmed",
    closed: false,
    closureStatus: "open",
    closureConfirmedInCurrentExport: true,
    closureHistory: [],
    address: {
      storeAddress: input.storeAddress,
      deliveryAddress: "",
      routeDirection: "",
    },
    loading: {
      loadingOnMonday: null,
      loadingOnTuesday: null,
      loadingOnWednesday: null,
      loadingOnThursday: null,
      loadingOnFriday: null,
      loadingOnSaturday: null,
      loadingOnSunday: null,
      loadingTime: null,
    },
    managers: {
      manager: { guid: input.managerGuid, name: "Manager", state: "directory_unverified" },
      regionalManager: { guid: null, name: "", state: "not_provided" },
      hardwareManager: { guid: null, name: "", state: "not_provided" },
      headOfSales: { guid: null, name: "", state: "not_provided" },
    },
    contacts: { storePhone: "", accountantPhone: "", accountantEmail: "" },
    lpr: input.lpr ?? buildLpr(),
    additional: { statusTandoorClub: "", bonusTandoorClub: "" },
    provenance: {
      freshness: "current",
      sourceSha256: "a".repeat(64),
      importedAt: "2026-01-01T10:00:00.000Z",
    },
    distributionAllowed: false,
  };
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
  return res.headers["set-cookie"]?.[0]?.split(";")[0] ?? "";
}

describe("F1 LPR fields integration", { concurrency: false }, () => {
  before(async () => {
    databaseUrl = getIntegrationDatabaseUrl();
    setIntegrationEnv(databaseUrl, ORIGIN);
    await prepareDatabase(databaseUrl);
  });

  beforeEach(async () => {
    setIntegrationEnv(databaseUrl, ORIGIN);
    await resetPoolForTests();
    await prepareDatabase(databaseUrl);

    const admin = await createTestUser({
      databaseUrl,
      email: "admin-f1@example.com",
      password: TEST_PASSWORD,
      fullName: "Admin",
      role: "admin",
    });
    const m1UserId = (
      await createTestUser({
        databaseUrl,
        email: "m1-f1@example.com",
        password: TEST_PASSWORD,
        fullName: "M1",
        role: "manager",
      })
    ).id;

    await insertSyntheticClients(databaseUrl, [
      {
        guid_client: C1,
        name_client: "Client C1",
        guid_manager: M1,
        name_manager: "M1",
        address: "Addr",
        telephone: [],
      },
    ]);
    await insertSyntheticRetailOutlets(databaseUrl, [
      { guid_store: T1, guid_client: C1, is_closed: false },
      { guid_store: T2, guid_client: C1, is_closed: false },
    ]);

    const emptyRef = { guid: null, name: "", state: "not_provided" as const };
    await updateClientExtendedSnapshot(databaseUrl, C1, {
      regionalManager: emptyRef,
      hardwareManager: emptyRef,
      headOfSales: emptyRef,
      currentRetailOutlets: [
        buildOutlet({
          ordinal: 1,
          guidStore: T1,
          storeAddress: "TT1",
          managerGuid: M1,
          lpr: buildLpr(),
        }),
        buildOutlet({
          ordinal: 2,
          guidStore: T2,
          storeAddress: "TT2",
          managerGuid: M2,
          lpr: buildLpr({
            name: "LPR Beta",
            post: "Buyer",
            bonus: "5",
            conditionsBonus: "Cond B",
          }),
        }),
      ],
    });
    await insertSuccessfulImportRun(databaseUrl, { recordCount: 1 });
    await linkUserToEmployee({
      databaseUrl,
      userId: m1UserId,
      employeeId: M1,
      confirmedByUserId: admin.id,
    });
  });

  after(async () => {
    await closePool();
  });

  it("manager sees seven LPR fields on accessible TT1 only", async () => {
    const app = await loadApp();
    const cookie = await login("m1-f1@example.com");

    const card = await request(app).get(`/api/clients/${C1}`).set({ Origin: ORIGIN, Cookie: cookie });
    assert.equal(card.status, 200);
    assert.equal(card.body.client.extended.sensitiveFieldsWithheld, false);
    assert.equal(card.body.client.extended.retailOutlets.length, 1);
    const outlet = card.body.client.extended.retailOutlets[0];
    assert.equal(outlet.guidStore, T1);
    assert.equal(outlet.lpr.name.value, "LPR Alpha");
    assert.equal(outlet.lpr.bonus.value, "0");
    assert.equal(outlet.lpr.dateOfBirth.isoDate, "1985-03-15");

    const outlets = await request(app)
      .get("/api/clients?entity=outlets")
      .set({ Origin: ORIGIN, Cookie: cookie });
    assert.equal(outlets.status, 200);
    assert.equal(outlets.body.total, 1);
    assert.equal(outlets.body.items[0].lpr.name.value, "LPR Alpha");
  });

  it("filters require same accessible outlet (no cross-TT false positive)", async () => {
    const app = await loadApp();
    const cookie = await login("m1-f1@example.com");

    const match = await request(app)
      .get("/api/clients?entity=clients&lprNameContains=Alpha&lprBonusContains=0")
      .set({ Origin: ORIGIN, Cookie: cookie });
    assert.equal(match.status, 200);
    assert.equal(match.body.total, 1);

    const cross = await request(app)
      .get("/api/clients?entity=clients&lprNameContains=Alpha&lprBonusContains=5")
      .set({ Origin: ORIGIN, Cookie: cookie });
    assert.equal(cross.status, 200);
    assert.equal(cross.body.total, 0);

    const hidden = await request(app)
      .get("/api/clients?entity=clients&lprNameContains=Beta")
      .set({ Origin: ORIGIN, Cookie: cookie });
    assert.equal(hidden.status, 200);
    assert.equal(hidden.body.total, 0);
  });

  it("supports view=all with outlet LPR text filter (browser URL shape)", async () => {
    const app = await loadApp();
    const cookie = await login("m1-f1@example.com");

    const res = await request(app)
      .get("/api/clients?view=all&entity=outlets&lprNameContains=Alpha")
      .set({ Origin: ORIGIN, Cookie: cookie });
    assert.equal(res.status, 200);
    assert.equal(res.body.total, 1);
  });

  it("supports date of birth exact and filled bonus zero", async () => {
    const app = await loadApp();
    const cookie = await login("m1-f1@example.com");

    const byDob = await request(app)
      .get("/api/clients?entity=outlets&lprDateOfBirth=1985-03-15")
      .set({ Origin: ORIGIN, Cookie: cookie });
    assert.equal(byDob.status, 200);
    assert.equal(byDob.body.total, 1);

    const filledBonus = await request(app)
      .get("/api/clients?entity=outlets&filled=lprBonus")
      .set({ Origin: ORIGIN, Cookie: cookie });
    assert.equal(filledBonus.status, 200);
    assert.equal(filledBonus.body.total, 1);
  });
});
