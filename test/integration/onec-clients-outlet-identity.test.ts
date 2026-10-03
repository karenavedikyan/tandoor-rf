import assert from "node:assert/strict";
import { before, beforeEach, describe, it } from "node:test";
import { Pool } from "pg";
import { applyClientsImport } from "../../src/onec-clients/apply";
import {
  buildExtendedClientsFileBytes,
  EXTENDED_FIXTURE_GUIDS,
  sampleExtendedHolding,
  sampleIdentifiedOutlet,
  validateClientsForApplyTest,
} from "../helpers/onec-clients-extended-fixtures";
import {
  getIntegrationDatabaseUrl,
  prepareDatabase,
  setIntegrationEnv,
} from "../helpers/test-db";

describe("onec clients outlet identity integration", { concurrency: false }, () => {
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

  it("persists guid_store registry and preserves identity across address change", async () => {
    const firstBytes = buildExtendedClientsFileBytes([sampleExtendedHolding()]);
    const firstValidated = validateClientsForApplyTest(firstBytes);
    assert.equal(firstValidated.ok, true);
    if (!firstValidated.ok) return;
    await applyClientsImport({ databaseUrl, payload: firstValidated.payload });

    const secondBytes = buildExtendedClientsFileBytes([
      sampleExtendedHolding({
        retail_outlets: [
          sampleIdentifiedOutlet({
            address: {
              store_address: "Updated street",
              delivery_address: "Updated dock",
              direction_of_the_route: "East",
            },
          }),
        ],
      }),
    ]);
    const secondValidated = validateClientsForApplyTest(secondBytes);
    assert.equal(secondValidated.ok, true);
    if (!secondValidated.ok) return;
    await applyClientsImport({
      databaseUrl,
      payload: secondValidated.payload,
      expectedCommittedSha256: firstValidated.payload.sha256,
    });

    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    const registry = await pool.query<{ guid_store: string; is_closed: boolean | null }>(
      "SELECT guid_store::text, is_closed FROM onec_retail_outlets WHERE guid_store = $1::uuid",
      [EXTENDED_FIXTURE_GUIDS.STORE_ONE],
    );
    const snapshot = await pool.query<{
      extended_snapshot: {
        currentRetailOutlets: Array<{ guidStore: string; address: { storeAddress: string } }>;
      };
    }>(
      "SELECT extended_snapshot FROM onec_clients WHERE guid_client = $1::uuid",
      [EXTENDED_FIXTURE_GUIDS.HOLDING_GUID],
    );
    assert.equal(registry.rows[0]?.guid_store, EXTENDED_FIXTURE_GUIDS.STORE_ONE);
    assert.equal(
      snapshot.rows[0]?.extended_snapshot.currentRetailOutlets[0]?.address.storeAddress,
      "Updated street",
    );
    await pool.end();
  });

  it("blocks extended apply when guid_store parent card conflicts with registry", async () => {
    const firstBytes = buildExtendedClientsFileBytes([sampleExtendedHolding()]);
    const firstValidated = validateClientsForApplyTest(firstBytes);
    assert.equal(firstValidated.ok, true);
    if (!firstValidated.ok) return;
    await applyClientsImport({ databaseUrl, payload: firstValidated.payload });

    const conflictBytes = buildExtendedClientsFileBytes([
      sampleExtendedHolding({
        guid_client: EXTENDED_FIXTURE_GUIDS.CHILD_GUID,
        name_client: "Child Shop",
        guid_holding: EXTENDED_FIXTURE_GUIDS.HOLDING_GUID,
        retail_outlets: [sampleIdentifiedOutlet({ guid_store: EXTENDED_FIXTURE_GUIDS.STORE_ONE })],
      }),
    ]);
    const conflictValidated = validateClientsForApplyTest(conflictBytes);
    assert.equal(conflictValidated.ok, false);
  });

  it("is idempotent on repeated import with same outlet identity", async () => {
    const bytes = buildExtendedClientsFileBytes([sampleExtendedHolding()]);
    const validated = validateClientsForApplyTest(bytes);
    assert.equal(validated.ok, true);
    if (!validated.ok) return;
    const first = await applyClientsImport({ databaseUrl, payload: validated.payload });
    const second = await applyClientsImport({
      databaseUrl,
      payload: validated.payload,
      expectedCommittedSha256: validated.payload.sha256,
    });
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);

    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    const count = await pool.query<{ count: string }>("SELECT COUNT(*)::text AS count FROM onec_retail_outlets");
    assert.equal(count.rows[0]?.count, "1");
    await pool.end();
  });
});
