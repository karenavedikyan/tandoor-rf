import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import request from "supertest";
import { Pool } from "pg";
import { applyClientsImport } from "../../src/onec-clients/apply";
import { canReadClientGuid } from "../../src/clients/repository";
import { loadAccessContext } from "../../src/access/context";
import { validateClientsFileBytes } from "../../src/onec-clients/validate";
import { parseWholesaleEmployeeRosterBytes } from "../../src/onec-clients/employee-roster";
import { resetPoolForTests } from "../../src/db/pool";
import {
  buildExtendedClientsFileBytes,
  sampleExtendedChild,
  sampleExtendedHolding,
} from "../helpers/onec-clients-extended-fixtures";
import {
  buildEmployeeRosterBytes,
  buildEmployeeRosterEntry,
} from "../helpers/onec-clients-employee-roster-fixtures";
import {
  applyClientsImportVerified,
  buildImportVerificationFingerprint,
  expectedVerificationForPayload,
} from "../helpers/onec-clients-fixtures";
import {
  addRopTeamMember,
  grantClientAccess,
  linkUserToEmployee,
} from "../helpers/access-db-fixtures";
import { createTestUser, getIntegrationDatabaseUrl, prepareDatabase, setIntegrationEnv } from "../helpers/test-db";

const ORIGIN = "http://127.0.0.1:3000";
const TEST_PASSWORD = "StrongPass123!";
const databaseUrl = getIntegrationDatabaseUrl();
const holdingGuid = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const clientGuid = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const inRosterManagerGuid = "22222222-2222-4222-8222-222222222222";
const outsideManagerGuid = "99999999-9999-4999-8999-999999999999";
const ropEmployeeGuid = "33333333-3333-4333-8333-333333333333";
const regionalEmployeeGuid = "55555555-5555-4555-8555-555555555555";

function rosterIncludingInManager(): ReturnType<typeof parseWholesaleEmployeeRosterBytes> {
  return parseWholesaleEmployeeRosterBytes(
    buildEmployeeRosterBytes([
      buildEmployeeRosterEntry(inRosterManagerGuid, { name_manager: "In Roster Manager" }),
      buildEmployeeRosterEntry(ropEmployeeGuid, { name_manager: "ROP Employee" }),
    ]),
  );
}

function rosterExcludingOutsideManager(): ReturnType<typeof parseWholesaleEmployeeRosterBytes> {
  return parseWholesaleEmployeeRosterBytes(
    buildEmployeeRosterBytes([
      buildEmployeeRosterEntry(inRosterManagerGuid, { name_manager: "In Roster Manager" }),
    ]),
  );
}

function buildClientBytes(managerGuid: string, managerName: string): Buffer {
  return buildExtendedClientsFileBytes([
    sampleExtendedHolding({ guid_client: holdingGuid }),
    sampleExtendedChild({
      guid_client: clientGuid,
      guid_holding: holdingGuid,
      guid_manager: managerGuid,
      name_manager: managerName,
    }),
  ]);
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

async function readRosterState(): Promise<string> {
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  const row = await pool.query<{ manager_roster_state: string }>(
    "SELECT manager_roster_state FROM onec_clients WHERE guid_client = $1",
    [clientGuid],
  );
  await pool.end();
  return row.rows[0]?.manager_roster_state ?? "";
}

describe("onec roster state transitions integration", () => {
  before(async () => {
    setIntegrationEnv(databaseUrl, ORIGIN);
    await prepareDatabase(databaseUrl);
  });

  after(async () => {
    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    await pool.query("DELETE FROM onec_clients");
    await pool.end();
  });

  it("preserves outside restriction across roster-absent re-import and restores only after roster confirmation", async () => {
    const outsideUser = await createTestUser({
      databaseUrl,
      email: "outside-mgr@example.com",
      password: TEST_PASSWORD,
      fullName: "Outside Manager",
      role: "manager",
    });
    await linkUserToEmployee({
      databaseUrl,
      userId: outsideUser.id,
      employeeId: outsideManagerGuid,
      confirmedByUserId: outsideUser.id,
    });

    const inRosterUser = await createTestUser({
      databaseUrl,
      email: "in-roster-mgr@example.com",
      password: TEST_PASSWORD,
      fullName: "In Roster Manager",
      role: "manager",
    });
    await linkUserToEmployee({
      databaseUrl,
      userId: inRosterUser.id,
      employeeId: inRosterManagerGuid,
      confirmedByUserId: inRosterUser.id,
    });

    const ropUser = await createTestUser({
      databaseUrl,
      email: "rop-user@example.com",
      password: TEST_PASSWORD,
      fullName: "ROP User",
      role: "rop",
    });
    await linkUserToEmployee({
      databaseUrl,
      userId: ropUser.id,
      employeeId: ropEmployeeGuid,
      confirmedByUserId: ropUser.id,
    });
    await addRopTeamMember({
      databaseUrl,
      ropUserId: ropUser.id,
      memberUserId: outsideUser.id,
      createdByUserId: ropUser.id,
    });

    const grantedUser = await createTestUser({
      databaseUrl,
      email: "granted-regional@example.com",
      password: TEST_PASSWORD,
      fullName: "Granted Regional",
      role: "regional_manager",
    });
    await linkUserToEmployee({
      databaseUrl,
      userId: grantedUser.id,
      employeeId: regionalEmployeeGuid,
      confirmedByUserId: grantedUser.id,
    });
    await grantClientAccess({
      databaseUrl,
      userId: grantedUser.id,
      objectId: clientGuid,
      grantedByUserId: grantedUser.id,
    });

    const clientBytesOutside = buildClientBytes(outsideManagerGuid, "Outside Manager");
    const rosterExclude = rosterExcludingOutsideManager();
    assert.equal(rosterExclude.ok, true);
    if (!rosterExclude.ok) return;

    const validatedWithRoster = validateClientsFileBytes(clientBytesOutside, {
      employeeRoster: rosterExclude.roster,
    });
    assert.equal(validatedWithRoster.ok, true);
    if (!validatedWithRoster.ok) return;

    const firstApply = await applyClientsImportVerified({
      databaseUrl,
      payload: validatedWithRoster.payload,
    });
    assert.equal(firstApply.ok, true, firstApply.ok ? "" : JSON.stringify(firstApply));
    assert.equal(await readRosterState(), "outside_wholesale_roster");

    await resetPoolForTests();
    let outsideContext = await loadAccessContext(outsideUser.id, "manager");
    assert.equal(await canReadClientGuid(outsideContext, clientGuid), false);
    let ropContext = await loadAccessContext(ropUser.id, "rop");
    assert.equal(await canReadClientGuid(ropContext, clientGuid), false);
    let grantedContext = await loadAccessContext(grantedUser.id, "regional_manager");
    assert.equal(await canReadClientGuid(grantedContext, clientGuid), true);

    const validatedNoRoster = validateClientsFileBytes(clientBytesOutside);
    assert.equal(validatedNoRoster.ok, true);
    if (!validatedNoRoster.ok) return;

    const absentRosterApply = await applyClientsImport({
      databaseUrl,
      payload: validatedNoRoster.payload,
      expectedVerificationFingerprint: expectedVerificationForPayload(validatedNoRoster.payload),
    });
    assert.equal(absentRosterApply.ok, true);
    assert.equal(await readRosterState(), "outside_wholesale_roster");

    await resetPoolForTests();
    outsideContext = await loadAccessContext(outsideUser.id, "manager");
    assert.equal(await canReadClientGuid(outsideContext, clientGuid), false);

    const outsideCookie = await login("outside-mgr@example.com");
    const app = await loadApp();
    const deniedApi = await request(app)
      .get(`/api/clients/${clientGuid}`)
      .set({ Origin: ORIGIN, Cookie: outsideCookie });
    assert.equal(deniedApi.status, 404);

    const validatedExcludeAgain = validateClientsFileBytes(clientBytesOutside, {
      employeeRoster: rosterExclude.roster,
    });
    assert.equal(validatedExcludeAgain.ok, true);
    if (!validatedExcludeAgain.ok) return;
    assert.equal(
      (await applyClientsImportVerified({ databaseUrl, payload: validatedExcludeAgain.payload })).ok,
      true,
    );
    assert.equal(await readRosterState(), "outside_wholesale_roster");
    outsideContext = await loadAccessContext(outsideUser.id, "manager");
    assert.equal(await canReadClientGuid(outsideContext, clientGuid), false);

    const clientBytesInRoster = buildClientBytes(inRosterManagerGuid, "In Roster Manager");
    const rosterInclude = rosterIncludingInManager();
    assert.equal(rosterInclude.ok, true);
    if (!rosterInclude.ok) return;
    const validatedIncluded = validateClientsFileBytes(clientBytesInRoster, {
      employeeRoster: rosterInclude.roster,
    });
    assert.equal(validatedIncluded.ok, true);
    if (!validatedIncluded.ok) return;
    assert.equal(
      (await applyClientsImportVerified({ databaseUrl, payload: validatedIncluded.payload })).ok,
      true,
    );
    assert.equal(await readRosterState(), "in_wholesale_roster");

    await resetPoolForTests();
    const inRosterContext = await loadAccessContext(inRosterUser.id, "manager");
    assert.equal(await canReadClientGuid(inRosterContext, clientGuid), true);
    outsideContext = await loadAccessContext(outsideUser.id, "manager");
    assert.equal(await canReadClientGuid(outsideContext, clientGuid), false);

    const inRosterCookie = await login("in-roster-mgr@example.com");
    const allowedApi = await request(app)
      .get(`/api/clients/${clientGuid}`)
      .set({ Origin: ORIGIN, Cookie: inRosterCookie });
    assert.equal(allowedApi.status, 200);
    assert.equal(allowedApi.body.client.managerRosterState, "in_wholesale_roster");
  });

  it("blocks unconfirmed manager reassignment when roster is absent", async () => {
    const alternateInRosterGuid = "44444444-4444-4444-8444-444444444444";
    const inRosterUser = await createTestUser({
      databaseUrl,
      email: "new-mgr-unconfirmed@example.com",
      password: TEST_PASSWORD,
      fullName: "New Manager Unconfirmed",
      role: "manager",
    });
    await linkUserToEmployee({
      databaseUrl,
      userId: inRosterUser.id,
      employeeId: alternateInRosterGuid,
      confirmedByUserId: inRosterUser.id,
    });

    const rosterExclude = rosterExcludingOutsideManager();
    assert.equal(rosterExclude.ok, true);
    if (!rosterExclude.ok) return;

    const seedBytes = buildClientBytes(outsideManagerGuid, "Outside Manager");
    const seedValidated = validateClientsFileBytes(seedBytes, { employeeRoster: rosterExclude.roster });
    assert.equal(seedValidated.ok, true);
    if (!seedValidated.ok) return;
    assert.equal((await applyClientsImportVerified({ databaseUrl, payload: seedValidated.payload })).ok, true);
    assert.equal(await readRosterState(), "outside_wholesale_roster");

    const reassignedBytes = buildClientBytes(alternateInRosterGuid, "Alternate In Roster Manager");
    const reassignedValidated = validateClientsFileBytes(reassignedBytes);
    assert.equal(reassignedValidated.ok, true);
    if (!reassignedValidated.ok) return;

    const reassignedApply = await applyClientsImport({
      databaseUrl,
      payload: reassignedValidated.payload,
      expectedVerificationFingerprint: buildImportVerificationFingerprint(
        JSON.parse(reassignedBytes.toString("utf8")),
      ),
    });
    assert.equal(reassignedApply.ok, true);
    assert.equal(await readRosterState(), "outside_wholesale_roster");

    await resetPoolForTests();
    const context = await loadAccessContext(inRosterUser.id, "manager");
    assert.equal(await canReadClientGuid(context, clientGuid), false);
  });
});
