import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { Pool } from "pg";
import { applyClientsImport } from "../../src/onec-clients/apply";
import { parseWholesaleEmployeeRosterBytes } from "../../src/onec-clients/employee-roster";
import { validateClientsFileBytes } from "../../src/onec-clients/validate";
import { verificationFingerprintFromPayload } from "../../src/onec-clients/import-verification-fingerprint";
import { closePool } from "../../src/db/pool";
import {
  buildClientsFileBytes,
  expectedVerificationForPayload,
  sampleClient,
} from "../helpers/onec-clients-fixtures";
import {
  buildEmployeeRosterBytes,
  buildEmployeeRosterEntry,
} from "../helpers/onec-clients-employee-roster-fixtures";
import { getIntegrationDatabaseUrl, prepareDatabase, setIntegrationEnv } from "../helpers/test-db";

const MANAGER_A = "22222222-2222-4222-8222-222222222222";
const MANAGER_B = "55555555-5555-4555-8555-555555555555";
const CLIENT_ONE = "11111111-1111-4111-8111-111111111111";

describe("PR41 R4 roster substitution after validation", { concurrency: false }, () => {
  let databaseUrl = "";

  before(async () => {
    databaseUrl = getIntegrationDatabaseUrl();
    setIntegrationEnv(databaseUrl, "http://127.0.0.1:3000");
    await prepareDatabase(databaseUrl);
  });

  beforeEach(async () => {
    setIntegrationEnv(databaseUrl, "http://127.0.0.1:3000");
    await prepareDatabase(databaseUrl);
  });

  after(async () => {
    await closePool();
  });

  it("uses validation-time roster state for legacy records and cannot promote via alternate roster object", async () => {
    const rosterABytes = buildEmployeeRosterBytes([
      buildEmployeeRosterEntry(MANAGER_A, { name_manager: "Manager A" }),
    ]);
    const rosterBBytes = buildEmployeeRosterBytes([
      buildEmployeeRosterEntry(MANAGER_B, { name_manager: "Manager B" }),
    ]);
    const rosterAParsed = parseWholesaleEmployeeRosterBytes(rosterABytes);
    const rosterBParsed = parseWholesaleEmployeeRosterBytes(rosterBBytes);
    assert.equal(rosterAParsed.ok, true);
    assert.equal(rosterBParsed.ok, true);
    if (!rosterAParsed.ok || !rosterBParsed.ok) return;

    const bytes = buildClientsFileBytes([
      sampleClient({ guid_manager: MANAGER_B, name_manager: "Manager B" }),
    ]);
    const validated = validateClientsFileBytes(bytes, { employeeRoster: rosterAParsed.roster });
    assert.equal(validated.ok, true);
    if (!validated.ok) return;

    const legacyRecord = validated.payload.records[0]!;
    assert.equal(legacyRecord.managerRosterState, "outside_wholesale_roster");
    assert.equal(validated.payload.employeeRosterSourceSha256, rosterAParsed.roster.sourceSha256);

    const applied = await applyClientsImport({
      databaseUrl,
      payload: validated.payload,
      expectedVerificationFingerprint: expectedVerificationForPayload(validated.payload),
      employeeRosterSourceSha256: validated.payload.employeeRosterSourceSha256 ?? null,
    });
    assert.equal(applied.ok, true, applied.ok ? "" : `${applied.code}: ${applied.message}`);

    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    const row = await pool.query<{ manager_roster_state: string }>(
      `SELECT manager_roster_state FROM onec_clients WHERE guid_client = $1::uuid`,
      [CLIENT_ONE],
    );
    await pool.end();
    assert.equal(row.rows[0]?.manager_roster_state, "outside_wholesale_roster");

    assert.equal(
      rosterBParsed.roster.wholesaleGuids.has(MANAGER_B.toLowerCase()),
      true,
      "roster B would have promoted manager B if apply recomputed roster state from a separate object",
    );
  });

  it("accepts apply when payload roster state matches validated roster", async () => {
    const rosterBytes = buildEmployeeRosterBytes([
      buildEmployeeRosterEntry(MANAGER_B, { name_manager: "Manager B" }),
    ]);
    const rosterParsed = parseWholesaleEmployeeRosterBytes(rosterBytes);
    assert.equal(rosterParsed.ok, true);
    if (!rosterParsed.ok) return;

    const bytes = buildClientsFileBytes([
      sampleClient({ guid_manager: MANAGER_B, name_manager: "Manager B" }),
    ]);
    const validated = validateClientsFileBytes(bytes, { employeeRoster: rosterParsed.roster });
    assert.equal(validated.ok, true);
    if (!validated.ok) return;
    assert.equal(validated.payload.records[0]?.managerRosterState, "in_wholesale_roster");

    const applied = await applyClientsImport({
      databaseUrl,
      payload: validated.payload,
      expectedVerificationFingerprint: verificationFingerprintFromPayload({ payload: validated.payload }),
    });
    assert.equal(applied.ok, true);

    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    const row = await pool.query<{ manager_roster_state: string }>(
      `SELECT manager_roster_state FROM onec_clients WHERE guid_client = $1::uuid`,
      [CLIENT_ONE],
    );
    await pool.end();
    assert.equal(row.rows[0]?.manager_roster_state, "in_wholesale_roster");
  });

  it("blocks apply when validated roster states were stripped from payload", async () => {
    const rosterBytes = buildEmployeeRosterBytes([
      buildEmployeeRosterEntry(MANAGER_A, { name_manager: "Manager A" }),
    ]);
    const rosterParsed = parseWholesaleEmployeeRosterBytes(rosterBytes);
    assert.equal(rosterParsed.ok, true);
    if (!rosterParsed.ok) return;

    const bytes = buildClientsFileBytes([sampleClient()]);
    const validated = validateClientsFileBytes(bytes, { employeeRoster: rosterParsed.roster });
    assert.equal(validated.ok, true);
    if (!validated.ok) return;

    const tampered = {
      ...validated.payload,
      records: validated.payload.records.map((record) => {
        const { managerRosterState: _removed, ...rest } = record;
        return rest;
      }),
    };

    const blocked = await applyClientsImport({
      databaseUrl,
      payload: tampered,
      expectedVerificationFingerprint: expectedVerificationForPayload(validated.payload),
    });
    assert.equal(blocked.ok, false);
    if (!blocked.ok) {
      assert.equal(blocked.code, "APPLY_BLOCKED");
    }

    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    const count = await pool.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM onec_clients`);
    await pool.end();
    assert.equal(count.rows[0]?.n, 0);
  });
});
