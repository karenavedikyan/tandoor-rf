import assert from "node:assert/strict";
import { before, beforeEach, describe, it } from "node:test";
import { Pool } from "pg";
import { applyClientsImport } from "../../src/onec-clients/apply";
import { validateClientsFileBytes } from "../../src/onec-clients/validate";
import {
  buildExtendedClientsFileBytes,
  EXTENDED_FIXTURE_GUIDS,
  sampleExtendedChild,
  sampleExtendedHolding,
} from "../helpers/onec-clients-extended-fixtures";
import { sampleClient } from "../helpers/onec-clients-fixtures";
import {
  getIntegrationDatabaseUrl,
  prepareDatabase,
  setIntegrationEnv,
} from "../helpers/test-db";

describe("onec clients extended import integration", { concurrency: false }, () => {
  let databaseUrl = "";

  before(async () => {
    databaseUrl = getIntegrationDatabaseUrl();
    setIntegrationEnv(databaseUrl);
    await prepareDatabase(databaseUrl);
  });

  beforeEach(async () => {
    setIntegrationEnv(databaseUrl);
    await prepareDatabase(databaseUrl);
  });

  it("applies extended snapshot with holding card and nested outlets", async () => {
    const bytes = buildExtendedClientsFileBytes([
      sampleExtendedHolding(),
      sampleExtendedChild(),
    ]);
    const validated = validateClientsFileBytes(bytes);
    assert.equal(validated.ok, true);
    if (!validated.ok) return;

    const applied = await applyClientsImport({ databaseUrl, payload: validated.payload });
    assert.equal(applied.ok, true);

    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    const holdingRow = await pool.query<{
      extended_format_version: string | null;
      is_holding: boolean | null;
      extended_snapshot: { retailOutlets?: Array<{ outletGuidStatus: string }> } | null;
    }>(
      `
        SELECT extended_format_version, is_holding, extended_snapshot
        FROM onec_clients WHERE guid_client = $1::uuid
      `,
      [EXTENDED_FIXTURE_GUIDS.HOLDING_GUID],
    );
    assert.equal(holdingRow.rows[0]?.extended_format_version, "extended_v1");
    assert.equal(holdingRow.rows[0]?.is_holding, true);
    assert.equal(holdingRow.rows[0]?.extended_snapshot?.retailOutlets?.[0]?.outletGuidStatus, "not_provided");

    const journal = await pool.query<{ source_format_version: string | null }>(
      "SELECT source_format_version FROM onec_client_import_runs WHERE status = 'success' ORDER BY finished_at DESC LIMIT 1",
    );
    assert.equal(journal.rows[0]?.source_format_version, "extended_v1");
    await pool.end();
  });

  it("re-applying the same extended snapshot is idempotent", async () => {
    const bytes = buildExtendedClientsFileBytes([sampleExtendedHolding(), sampleExtendedChild()]);
    const validated = validateClientsFileBytes(bytes);
    assert.equal(validated.ok, true);
    if (!validated.ok) return;

    const first = await applyClientsImport({ databaseUrl, payload: validated.payload });
    assert.equal(first.ok, true);
    const second = await applyClientsImport({
      databaseUrl,
      payload: validated.payload,
      expectedCommittedSha256: validated.payload.sha256,
    });
    assert.equal(second.ok, true);
    assert.equal(second.counts?.unchangedCount, 2);
  });

  it("stores unmatched manager state without creating employee links", async () => {
    const bytes = buildExtendedClientsFileBytes([sampleExtendedHolding()]);
    const validated = validateClientsFileBytes(bytes);
    assert.equal(validated.ok, true);
    if (!validated.ok) return;

    const applied = await applyClientsImport({ databaseUrl, payload: validated.payload });
    assert.equal(applied.ok, true);

    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    const links = await pool.query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM user_onec_employee_links WHERE employee_id = $1::uuid",
      [EXTENDED_FIXTURE_GUIDS.UNKNOWN],
    );
    assert.equal(Number(links.rows[0]?.count), 0);

    const snapshot = await pool.query<{
      extended_snapshot: { retailOutlets: Array<{ managers: { hardwareManager: { state: string } } }> };
    }>(
      "SELECT extended_snapshot FROM onec_clients WHERE guid_client = $1::uuid",
      [EXTENDED_FIXTURE_GUIDS.HOLDING_GUID],
    );
    assert.equal(
      snapshot.rows[0]?.extended_snapshot.retailOutlets[0]?.managers.hardwareManager.state,
      "unmatched",
    );
    await pool.end();
  });

  it("does not clear extended snapshot when legacy-shaped record is imported without extended markers", async () => {
    const extendedBytes = buildExtendedClientsFileBytes([sampleExtendedHolding(), sampleExtendedChild()]);
    const extendedValidated = validateClientsFileBytes(extendedBytes);
    assert.equal(extendedValidated.ok, true);
    if (!extendedValidated.ok) return;
    const first = await applyClientsImport({ databaseUrl, payload: extendedValidated.payload });
    assert.equal(first.ok, true);

    const legacyShapedBytes = buildExtendedClientsFileBytes([
      sampleClient({
        guid_client: EXTENDED_FIXTURE_GUIDS.HOLDING_GUID,
        name_client: "Holding Alpha Legacy Pass",
        guid_holding: "",
        name_holding: "",
        guid_manager: EXTENDED_FIXTURE_GUIDS.MANAGER_A,
        name_manager: "Manager One",
        address: "HQ Address",
        telephone: ["+79990001122"],
      }),
      sampleClient({
        guid_client: EXTENDED_FIXTURE_GUIDS.CHILD_GUID,
        name_client: "Child Shop Legacy Pass",
        guid_holding: EXTENDED_FIXTURE_GUIDS.HOLDING_GUID,
        name_holding: "Holding Alpha",
        guid_manager: EXTENDED_FIXTURE_GUIDS.MANAGER_B,
        name_manager: "Manager Two",
        address: "Child address",
        telephone: [],
      }),
    ]);
    const legacyValidated = validateClientsFileBytes(legacyShapedBytes);
    assert.equal(legacyValidated.ok, true);
    if (!legacyValidated.ok) return;

    const second = await applyClientsImport({
      databaseUrl,
      payload: legacyValidated.payload,
      expectedCommittedSha256: extendedValidated.payload.sha256,
    });
    assert.equal(second.ok, true);

    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    const row = await pool.query<{ name_client: string; extended_format_version: string | null }>(
      "SELECT name_client, extended_format_version FROM onec_clients WHERE guid_client = $1::uuid",
      [EXTENDED_FIXTURE_GUIDS.HOLDING_GUID],
    );
    assert.equal(row.rows[0]?.name_client, "Holding Alpha Legacy Pass");
    assert.equal(row.rows[0]?.extended_format_version, "extended_v1");
    await pool.end();
  });
});
