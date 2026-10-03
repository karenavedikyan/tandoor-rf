import assert from "node:assert/strict";
import { before, beforeEach, describe, it } from "node:test";
import { Pool } from "pg";
import { applyClientsImport } from "../../src/onec-clients/apply";
import {
  buildExtendedClientsFileBytes,
  EXTENDED_FIXTURE_GUIDS,
  sampleExtendedChild,
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
    const registry = await pool.query<{ guid_store: string; last_source_sha256: string }>(
      "SELECT guid_store::text, last_source_sha256 FROM onec_retail_outlets WHERE guid_store = $1::uuid",
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
    assert.equal(registry.rows[0]?.last_source_sha256, secondValidated.payload.sha256);
    assert.equal(
      snapshot.rows[0]?.extended_snapshot.currentRetailOutlets[0]?.address.storeAddress,
      "Updated street",
    );
    await pool.end();
  });

  it("does not refresh registry source for outlet absent from current export", async () => {
    const firstBytes = buildExtendedClientsFileBytes([
      sampleExtendedHolding({
        retail_outlets: [
          sampleIdentifiedOutlet({ guid_store: EXTENDED_FIXTURE_GUIDS.STORE_ONE }),
          sampleIdentifiedOutlet({ guid_store: EXTENDED_FIXTURE_GUIDS.STORE_TWO }),
        ],
      }),
    ]);
    const firstValidated = validateClientsForApplyTest(firstBytes);
    assert.equal(firstValidated.ok, true);
    if (!firstValidated.ok) return;
    await applyClientsImport({ databaseUrl, payload: firstValidated.payload });

    const secondBytes = buildExtendedClientsFileBytes([
      sampleExtendedHolding({
        retail_outlets: [sampleIdentifiedOutlet({ guid_store: EXTENDED_FIXTURE_GUIDS.STORE_TWO })],
      }),
    ]);
    const secondValidated = validateClientsForApplyTest(secondBytes);
    assert.equal(secondValidated.ok, true);
    if (!secondValidated.ok) return;
    const secondApply = await applyClientsImport({
      databaseUrl,
      payload: secondValidated.payload,
      expectedCommittedSha256: firstValidated.payload.sha256,
    });
    assert.equal(secondApply.ok, true);

    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    const rows = await pool.query<{ guid_store: string; last_source_sha256: string }>(
      "SELECT guid_store::text, last_source_sha256 FROM onec_retail_outlets ORDER BY guid_store::text",
    );
    const storeOne = rows.rows.find((row) => row.guid_store === EXTENDED_FIXTURE_GUIDS.STORE_ONE);
    const storeTwo = rows.rows.find((row) => row.guid_store === EXTENDED_FIXTURE_GUIDS.STORE_TWO);
    assert.equal(storeOne?.last_source_sha256, firstValidated.payload.sha256);
    assert.equal(storeTwo?.last_source_sha256, secondValidated.payload.sha256);

    const snapshot = await pool.query<{
      extended_snapshot: {
        blocks: { blockFreshness?: { retailOutlets: string } };
        currentRetailOutlets: Array<{ guidStore: string; provenance: { freshness: string } }>;
      };
    }>(
      "SELECT extended_snapshot FROM onec_clients WHERE guid_client = $1::uuid",
      [EXTENDED_FIXTURE_GUIDS.HOLDING_GUID],
    );
    assert.equal(snapshot.rows[0]?.extended_snapshot.blocks.blockFreshness?.retailOutlets, "preserved_from_previous");
    assert.equal(
      snapshot.rows[0]?.extended_snapshot.currentRetailOutlets.find(
        (outlet) => outlet.guidStore === EXTENDED_FIXTURE_GUIDS.STORE_ONE,
      )?.provenance.freshness,
      "absent_from_current_export",
    );

    const journal = await pool.query<{
      extended_diagnostics: { knownOutletsMissingFromSnapshot?: number | null } | null;
    }>(
      `
        SELECT extended_diagnostics
        FROM onec_client_import_runs
        WHERE status = 'success'
        ORDER BY finished_at DESC
        LIMIT 1
      `,
    );
    assert.equal(journal.rows[0]?.extended_diagnostics?.knownOutletsMissingFromSnapshot, 1);
    await pool.end();
  });

  it("reports registry parent conflict in apply result and journal without claiming full extended apply", async () => {
    const firstBytes = buildExtendedClientsFileBytes([
      sampleExtendedHolding({
        retail_outlets: [sampleIdentifiedOutlet({ guid_store: EXTENDED_FIXTURE_GUIDS.STORE_ONE })],
      }),
      sampleExtendedChild({
        retail_outlets: [sampleIdentifiedOutlet({ guid_store: EXTENDED_FIXTURE_GUIDS.STORE_TWO })],
      }),
    ]);
    const firstValidated = validateClientsForApplyTest(firstBytes);
    assert.equal(firstValidated.ok, true);
    if (!firstValidated.ok) return;
    await applyClientsImport({ databaseUrl, payload: firstValidated.payload });

    const conflictBytes = buildExtendedClientsFileBytes([
      sampleExtendedChild({
        retail_outlets: [sampleIdentifiedOutlet({ guid_store: EXTENDED_FIXTURE_GUIDS.STORE_ONE })],
      }),
      sampleExtendedHolding({
        retail_outlets: [],
      }),
    ]);
    const conflictValidated = validateClientsForApplyTest(conflictBytes);
    assert.equal(conflictValidated.ok, true);
    if (!conflictValidated.ok) return;

    const applied = await applyClientsImport({
      databaseUrl,
      payload: conflictValidated.payload,
      expectedCommittedSha256: firstValidated.payload.sha256,
    });
    assert.equal(applied.ok, true);
    assert.equal(applied.blockSummary?.extendedApplied, false);
    assert.equal(applied.blockSummary?.extendedBlockReason, "outlet_parent_link_conflict");
    assert.equal(applied.blockSummary?.outletParentLinkConflicts, 1);
    assert.equal(applied.counts?.extendedBlockedCount, 1);

    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    const child = await pool.query<{ extended_snapshot: unknown; extended_format_version: string | null }>(
      "SELECT extended_snapshot, extended_format_version FROM onec_clients WHERE guid_client = $1::uuid",
      [EXTENDED_FIXTURE_GUIDS.CHILD_GUID],
    );
    assert.equal(child.rows[0]?.extended_format_version, "extended_v1");
    assert.ok(child.rows[0]?.extended_snapshot);

    const registry = await pool.query<{ guid_store: string; guid_client: string }>(
      "SELECT guid_store::text, guid_client::text FROM onec_retail_outlets WHERE guid_store = $1::uuid",
      [EXTENDED_FIXTURE_GUIDS.STORE_ONE],
    );
    assert.equal(registry.rows[0]?.guid_client, EXTENDED_FIXTURE_GUIDS.HOLDING_GUID);

    const journal = await pool.query<{
      extended_diagnostics: {
        outletParentLinkConflicts?: number;
        applyBlocks?: { extendedBlockReason?: string | null; outletParentLinkConflicts?: number };
      } | null;
    }>(
      `
        SELECT extended_diagnostics
        FROM onec_client_import_runs
        WHERE status = 'success'
        ORDER BY finished_at DESC
        LIMIT 1
      `,
    );
    assert.equal(journal.rows[0]?.extended_diagnostics?.outletParentLinkConflicts, 1);
    assert.equal(
      journal.rows[0]?.extended_diagnostics?.applyBlocks?.extendedBlockReason,
      "outlet_parent_link_conflict",
    );
    await pool.end();
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
