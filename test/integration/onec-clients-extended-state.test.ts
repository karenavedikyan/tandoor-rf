import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import request from "supertest";
import { Pool } from "pg";
import { canReadClientGuid } from "../../src/clients/repository";
import { readExtendedSnapshot } from "../../src/onec-clients/extended-apply";
import { validateClientsFileBytes } from "../../src/onec-clients/validate";
import { parseWholesaleEmployeeRosterBytes } from "../../src/onec-clients/employee-roster";
import { resetPoolForTests } from "../../src/db/pool";
import {
  buildExtendedClientsFileBytes,
  sampleExtendedChild,
  sampleExtendedHolding,
} from "../helpers/onec-clients-extended-fixtures";
import { wholesaleRosterWithoutUnknown } from "../helpers/onec-clients-employee-roster-fixtures";
import { applyClientsImportVerified } from "../helpers/onec-clients-fixtures";
import { loadAccessContext } from "../../src/access/context";
import { linkUserToEmployee } from "../helpers/access-db-fixtures";
import { getIntegrationDatabaseUrl, prepareDatabase, setIntegrationEnv, createTestUser } from "../helpers/test-db";

const ORIGIN = "http://127.0.0.1:3000";
const TEST_PASSWORD = "StrongPass123!";
const databaseUrl = getIntegrationDatabaseUrl();
const holdingGuid = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const childGuid = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const outsideManagerGuid = "99999999-9999-4999-8999-999999999999";

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

describe("onec extended state preservation integration", () => {
  before(async () => {
    setIntegrationEnv(databaseUrl, ORIGIN);
    await prepareDatabase(databaseUrl);
  });

  after(async () => {
    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    await pool.query("DELETE FROM onec_clients");
    await pool.end();
  });

  it("preserves unresolved holding and outside roster through unverified apply, row storage, DTO and access", async () => {
    const rosterBytes = wholesaleRosterWithoutUnknown();
    const rosterParse = parseWholesaleEmployeeRosterBytes(rosterBytes);
    assert.equal(rosterParse.ok, true);
    if (!rosterParse.ok) return;

    const seedBytes = buildExtendedClientsFileBytes([
      sampleExtendedHolding({ guid_client: holdingGuid }),
      sampleExtendedChild({
        guid_client: childGuid,
        guid_holding: holdingGuid,
        guid_manager: outsideManagerGuid,
        name_manager: "Outside Roster Manager",
      }),
    ]);
    const seedValidated = validateClientsFileBytes(seedBytes, {
      employeeRoster: rosterParse.roster,
    });
    assert.equal(seedValidated.ok, true);
    if (!seedValidated.ok) return;

    const seedApply = await applyClientsImportVerified({
      databaseUrl,
      payload: seedValidated.payload,
    });
    assert.equal(seedApply.ok, true);

    const unresolvedParentGuid = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";
    const updateBytes = buildExtendedClientsFileBytes([
      sampleExtendedHolding({ guid_client: holdingGuid }),
      sampleExtendedChild({
        guid_client: childGuid,
        guid_holding: unresolvedParentGuid,
        name_holding: "Missing Holding",
        guid_manager: outsideManagerGuid,
        name_manager: "Outside Roster Manager",
      }),
    ]);
    const updateValidated = validateClientsFileBytes(updateBytes, {
      employeeRoster: rosterParse.roster,
    });
    assert.equal(updateValidated.ok, true);
    if (!updateValidated.ok) return;
    const childRecord = updateValidated.payload.extendedRecords?.find((r) => r.guid_client === childGuid);
    assert.equal(childRecord?.holdingLinkState, "unresolved");
    assert.equal(childRecord?.managerRosterState, "outside_wholesale_roster");

    const updateApply = await applyClientsImportVerified({
      databaseUrl,
      payload: updateValidated.payload,
    });
    assert.equal(updateApply.ok, true);

    const user = await createTestUser({
      databaseUrl,
      email: "linked-outside@example.com",
      password: TEST_PASSWORD,
      fullName: "Linked Outside",
      role: "manager",
    });
    await linkUserToEmployee({
      databaseUrl,
      userId: user.id,
      employeeId: outsideManagerGuid,
      confirmedByUserId: user.id,
    });

    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    const row = await pool.query<{
      guid_holding: string | null;
      guid_holding_pending: string | null;
      holding_link_state: string;
      manager_roster_state: string;
      extended_snapshot: unknown;
    }>(
      `
        SELECT
          guid_holding::text,
          guid_holding_pending::text,
          holding_link_state,
          manager_roster_state,
          extended_snapshot
        FROM onec_clients
        WHERE guid_client = $1
      `,
      [childGuid],
    );
    await pool.end();

    assert.equal(row.rows[0]?.guid_holding, null);
    assert.equal(row.rows[0]?.guid_holding_pending, unresolvedParentGuid);
    assert.equal(row.rows[0]?.holding_link_state, "unresolved");
    assert.equal(row.rows[0]?.manager_roster_state, "outside_wholesale_roster");
    assert.equal(row.rows[0]?.extended_snapshot, null);

    await resetPoolForTests();
    const accessContext = await loadAccessContext(user.id, "manager");
    const canRead = await canReadClientGuid(accessContext, childGuid);
    assert.equal(canRead, false);

    const cookie = await login("linked-outside@example.com");
    const app = await loadApp();
    const apiRes = await request(app)
      .get(`/api/clients/${childGuid}`)
      .set({ Origin: ORIGIN, Cookie: cookie });
    assert.equal(apiRes.status, 404);

    const admin = await createTestUser({
      databaseUrl,
      email: "admin-extended-state@example.com",
      password: TEST_PASSWORD,
      fullName: "Admin Extended",
      role: "admin",
    });
    const adminCookie = await login("admin-extended-state@example.com");
    const adminRes = await request(app)
      .get(`/api/clients/${childGuid}`)
      .set({ Origin: ORIGIN, Cookie: adminCookie });
    assert.equal(adminRes.status, 200);
    assert.equal(adminRes.body.client.holding?.linkState, "unresolved");
    assert.equal(adminRes.body.client.holding?.pendingId, unresolvedParentGuid);
    assert.equal(adminRes.body.client.managerRosterState, "outside_wholesale_roster");
    assert.equal(adminRes.body.client.extended?.holdingLink?.state, "unresolved");
    assert.equal(adminRes.body.client.extended?.holdingLink?.pendingGuid, unresolvedParentGuid);
    assert.equal(adminRes.body.client.extended?.clientManagerRosterState, "outside_wholesale_roster");
    assert.equal(adminRes.body.client.extended?.clientExtendedReady, false);

    const snapshot = readExtendedSnapshot(row.rows[0]?.extended_snapshot);
    assert.equal(snapshot, null);
    void admin;
  });
});
