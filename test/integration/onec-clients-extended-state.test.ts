import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { Pool } from "pg";
import { applyClientsImport } from "../../src/onec-clients/apply";
import { readExtendedSnapshot } from "../../src/onec-clients/extended-apply";
import { validateClientsFileBytes } from "../../src/onec-clients/validate";
import {
  buildExtendedClientsFileBytes,
  sampleExtendedChild,
  sampleExtendedHolding,
} from "../helpers/onec-clients-extended-fixtures";
import { parseWholesaleEmployeeRosterBytes } from "../../src/onec-clients/employee-roster";
import { wholesaleRosterWithoutUnknown } from "../helpers/onec-clients-employee-roster-fixtures";
import { buildImportVerificationFingerprint } from "../helpers/onec-clients-fixtures";
import { getIntegrationDatabaseUrl, prepareDatabase, setIntegrationEnv } from "../helpers/test-db";
import { createTestUser, linkUserToEmployee } from "../helpers/test-db";

const databaseUrl = getIntegrationDatabaseUrl();
const holdingGuid = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const childGuid = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const outsideManagerGuid = "99999999-9999-4999-8999-999999999999";

describe("onec extended state preservation integration", () => {
  before(async () => {
    setIntegrationEnv(databaseUrl);
    await prepareDatabase(databaseUrl);
  });

  after(async () => {
    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    await pool.query("DELETE FROM onec_clients");
    await pool.end();
  });

  it("preserves unresolved holding and outside roster states through apply and DTO read", async () => {
    const rosterParse = parseWholesaleEmployeeRosterBytes(wholesaleRosterWithoutUnknown());
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
      extendedContractVerification: "synthetic_confirmed",
    });
    assert.equal(seedValidated.ok, true);
    if (!seedValidated.ok) return;

    const seedApply = await applyClientsImport({
      databaseUrl,
      payload: seedValidated.payload,
      verificationFingerprint: buildImportVerificationFingerprint(
        JSON.parse(seedBytes.toString("utf8")),
        { employeeRosterBytes: wholesaleRosterWithoutUnknown() },
      ),
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
      extendedContractVerification: "synthetic_confirmed",
    });
    assert.equal(updateValidated.ok, true);
    if (!updateValidated.ok) return;
    const childRecord = updateValidated.payload.extendedRecords?.find((r) => r.guid_client === childGuid);
    assert.equal(childRecord?.holdingLinkState, "unresolved");
    assert.equal(childRecord?.managerRosterState, "outside_wholesale_roster");

    const updateApply = await applyClientsImport({
      databaseUrl,
      payload: updateValidated.payload,
      verificationFingerprint: buildImportVerificationFingerprint(
        JSON.parse(updateBytes.toString("utf8")),
        { employeeRosterBytes: wholesaleRosterWithoutUnknown() },
      ),
    });
    assert.equal(updateApply.ok, true);

    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    const user = await createTestUser({
      databaseUrl,
      email: "linked-outside@example.com",
      password: "TestPassword123!",
      fullName: "Linked Outside",
      role: "manager",
    });
    await linkUserToEmployee({
      databaseUrl,
      userId: user.id,
      employeeId: outsideManagerGuid,
      confirmedByUserId: user.id,
    });

    const row = await pool.query<{
      guid_holding: string | null;
      extended_snapshot: unknown;
    }>(
      `
        SELECT guid_holding::text, extended_snapshot
        FROM onec_clients
        WHERE guid_client = $1
      `,
      [childGuid],
    );
    await pool.end();

    assert.equal(row.rows[0]?.guid_holding, null);
    const snapshot = readExtendedSnapshot(row.rows[0]?.extended_snapshot);
    assert.equal(snapshot?.holdingLink.state, "unresolved");
    assert.equal(snapshot?.holdingLink.pendingGuid, unresolvedParentGuid);
    assert.equal(snapshot?.clientManagerRosterState, "outside_wholesale_roster");
  });
});
