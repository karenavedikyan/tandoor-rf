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
  sampleIdentifiedOutlet,
  validateClientsForApplyTest,
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
    const validated = validateClientsForApplyTest(bytes);
    assert.equal(validated.ok, true);
    if (!validated.ok) return;

    const applied = await applyClientsImport({ databaseUrl, payload: validated.payload });
    assert.equal(applied.ok, true);
    assert.equal(applied.blockSummary?.extendedApplied, true);

    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    const holdingRow = await pool.query<{
      extended_format_version: string | null;
      is_holding: boolean | null;
      extended_snapshot: { currentRetailOutlets?: Array<{ outletGuidStatus: string }> } | null;
    }>(
      `
        SELECT extended_format_version, is_holding, extended_snapshot
        FROM onec_clients WHERE guid_client = $1::uuid
      `,
      [EXTENDED_FIXTURE_GUIDS.HOLDING_GUID],
    );
    assert.equal(holdingRow.rows[0]?.extended_format_version, "extended_v1");
    assert.equal(holdingRow.rows[0]?.is_holding, true);
    assert.equal(
      holdingRow.rows[0]?.extended_snapshot?.currentRetailOutlets?.[0]?.outletGuidStatus,
      "confirmed",
    );

    const journal = await pool.query<{ source_format_version: string | null }>(
      "SELECT source_format_version FROM onec_client_import_runs WHERE status = 'success' ORDER BY finished_at DESC LIMIT 1",
    );
    assert.equal(journal.rows[0]?.source_format_version, "extended_v1");
    await pool.end();
  });

  it("re-applying the same extended snapshot is idempotent", async () => {
    const bytes = buildExtendedClientsFileBytes([sampleExtendedHolding(), sampleExtendedChild()]);
    const validated = validateClientsForApplyTest(bytes);
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

  it("stores directory-unverified manager state without creating employee links", async () => {
    const bytes = buildExtendedClientsFileBytes([sampleExtendedHolding()]);
    const validated = validateClientsForApplyTest(bytes);
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
      extended_snapshot: {
        currentRetailOutlets: Array<{ managers: { hardwareManager: { state: string } } }>;
      };
    }>(
      "SELECT extended_snapshot FROM onec_clients WHERE guid_client = $1::uuid",
      [EXTENDED_FIXTURE_GUIDS.HOLDING_GUID],
    );
    assert.equal(
      snapshot.rows[0]?.extended_snapshot.currentRetailOutlets[0]?.managers.hardwareManager.state,
      "directory_unverified",
    );
    await pool.end();
  });

  it("does not clear extended snapshot when legacy-shaped record is imported without extended markers", async () => {
    const extendedBytes = buildExtendedClientsFileBytes([sampleExtendedHolding(), sampleExtendedChild()]);
    const extendedValidated = validateClientsForApplyTest(extendedBytes);
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

  it("blocks extended apply when contract is unverified and preserves working snapshot", async () => {
    const bytes = buildExtendedClientsFileBytes([sampleExtendedHolding()]);
    const seeded = validateClientsForApplyTest(bytes);
    assert.equal(seeded.ok, true);
    if (!seeded.ok) return;

    const seedApply = await applyClientsImport({ databaseUrl, payload: seeded.payload });
    assert.equal(seedApply.ok, true);

    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    const before = await pool.query<{ extended_snapshot: { regionalManager: { guid: string | null } } }>(
      "SELECT extended_snapshot FROM onec_clients WHERE guid_client = $1::uuid",
      [EXTENDED_FIXTURE_GUIDS.HOLDING_GUID],
    );
    const beforeGuid = before.rows[0]?.extended_snapshot.regionalManager.guid;
    assert.ok(beforeGuid);

    const unverified = validateClientsFileBytes(
      buildExtendedClientsFileBytes([
        sampleExtendedHolding({
          name_client: "Holding Alpha Updated Name Only",
          guid_regional_manager: "",
          name_regional_manager: "",
          retail_outlets: [],
        }),
      ]),
    );
    assert.equal(unverified.ok, true);
    if (!unverified.ok) return;

    const blockedApply = await applyClientsImport({
      databaseUrl,
      payload: unverified.payload,
      expectedCommittedSha256: seeded.payload.sha256,
    });
    assert.equal(blockedApply.ok, true);
    assert.equal(blockedApply.blockSummary?.extendedApplied, false);
    assert.equal(blockedApply.blockSummary?.extendedBlockReason, "awaiting_live_json_verification");
    assert.equal(blockedApply.counts?.extendedBlockedCount, 1);

    const after = await pool.query<{
      name_client: string;
      source_sha256: string;
      extended_source_sha256: string | null;
      extended_freshness_state: string | null;
      extended_snapshot: { regionalManager: { guid: string | null }; currentRetailOutlets: unknown[] };
    }>(
      `
        SELECT name_client, source_sha256, extended_source_sha256, extended_freshness_state, extended_snapshot
        FROM onec_clients WHERE guid_client = $1::uuid
      `,
      [EXTENDED_FIXTURE_GUIDS.HOLDING_GUID],
    );
    assert.equal(after.rows[0]?.name_client, "Holding Alpha Updated Name Only");
    assert.equal(after.rows[0]?.extended_snapshot.regionalManager.guid, beforeGuid);
    assert.ok((after.rows[0]?.extended_snapshot.currentRetailOutlets.length ?? 0) > 0);
    assert.equal(after.rows[0]?.source_sha256, unverified.payload.sha256);
    assert.equal(after.rows[0]?.extended_source_sha256, seeded.payload.sha256);
    assert.equal(after.rows[0]?.extended_freshness_state, "preserved_from_previous");
    await pool.end();
  });

  it("attributes updated outlet address to current import while preserving regional provenance", async () => {
    const firstBytes = buildExtendedClientsFileBytes([sampleExtendedHolding()]);
    const firstValidated = validateClientsForApplyTest(firstBytes);
    assert.equal(firstValidated.ok, true);
    if (!firstValidated.ok) return;
    await applyClientsImport({ databaseUrl, payload: firstValidated.payload });

    const secondBytes = buildExtendedClientsFileBytes([
      sampleExtendedHolding({
        guid_regional_manager: undefined,
        name_regional_manager: undefined,
        retail_outlets: [
          sampleIdentifiedOutlet({
            address: {
              store_address: "Updated store street",
              delivery_address: "Updated delivery dock",
              direction_of_the_route: "South",
            },
            information_loading: { loading_on_monday: true, loading_time: "11:00" },
          }),
        ],
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
    const row = await pool.query<{
      guid_regional_manager: string | null;
      extended_snapshot: {
        sourceSha256: string;
        currentRetailOutlets: Array<{ address: { storeAddress: string } }>;
        blocks: {
          blockProvenance?: {
            retailOutlets: { sourceSha256: string };
            regionalManager: { sourceSha256: string };
          };
        };
        retailOutletHistory: Array<{ sourceSha256: string }>;
      };
    }>(
      `
        SELECT guid_regional_manager::text, extended_snapshot
        FROM onec_clients WHERE guid_client = $1::uuid
      `,
      [EXTENDED_FIXTURE_GUIDS.HOLDING_GUID],
    );
    assert.equal(row.rows[0]?.guid_regional_manager, EXTENDED_FIXTURE_GUIDS.REGIONAL);
    assert.equal(
      row.rows[0]?.extended_snapshot.currentRetailOutlets[0]?.address.storeAddress,
      "Updated store street",
    );
    assert.equal(row.rows[0]?.extended_snapshot.sourceSha256, secondValidated.payload.sha256);
    assert.equal(
      row.rows[0]?.extended_snapshot.blocks.blockProvenance?.retailOutlets.sourceSha256,
      secondValidated.payload.sha256,
    );
    assert.equal(
      row.rows[0]?.extended_snapshot.blocks.blockProvenance?.regionalManager.sourceSha256,
      firstValidated.payload.sha256,
    );
    assert.equal(row.rows[0]?.extended_snapshot.retailOutletHistory[0]?.sourceSha256, firstValidated.payload.sha256);
    await pool.end();
  });

  it("preserves outlets and regional manager when second snapshot omits extended blocks", async () => {
    const firstBytes = buildExtendedClientsFileBytes([sampleExtendedHolding()]);
    const firstValidated = validateClientsForApplyTest(firstBytes);
    assert.equal(firstValidated.ok, true);
    if (!firstValidated.ok) return;
    const firstApply = await applyClientsImport({ databaseUrl, payload: firstValidated.payload });
    assert.equal(firstApply.ok, true);

    const secondBytes = buildExtendedClientsFileBytes([
      sampleExtendedHolding({
        guid_regional_manager: undefined,
        name_regional_manager: undefined,
        retail_outlets: undefined,
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
    const row = await pool.query<{
      guid_regional_manager: string | null;
      extended_source_sha256: string | null;
      extended_freshness_state: string | null;
      extended_snapshot: {
        sourceSha256: string;
        regionalManager: { guid: string | null };
        currentRetailOutlets: unknown[];
        blocks: { blockFreshness?: { retailOutlets: string; holding: string } };
      };
    }>(
      `
        SELECT guid_regional_manager::text, extended_source_sha256, extended_freshness_state, extended_snapshot
        FROM onec_clients WHERE guid_client = $1::uuid
      `,
      [EXTENDED_FIXTURE_GUIDS.HOLDING_GUID],
    );
    assert.equal(row.rows[0]?.guid_regional_manager, EXTENDED_FIXTURE_GUIDS.REGIONAL);
    assert.ok((row.rows[0]?.extended_snapshot.currentRetailOutlets.length ?? 0) > 0);
    assert.equal(row.rows[0]?.extended_snapshot.blocks.blockFreshness?.retailOutlets, "preserved_from_previous");
    assert.equal(row.rows[0]?.extended_freshness_state, "preserved_from_previous");
    assert.equal(row.rows[0]?.extended_source_sha256, secondValidated.payload.sha256);
    assert.equal(row.rows[0]?.extended_snapshot.sourceSha256, secondValidated.payload.sha256);
    assert.equal(row.rows[0]?.extended_snapshot.blocks.blockFreshness?.holding, "current");
    assert.equal(
      row.rows[0]?.extended_snapshot.blocks.blockProvenance?.regionalManager.sourceSha256,
      firstValidated.payload.sha256,
    );
    assert.equal(
      row.rows[0]?.extended_snapshot.blocks.blockProvenance?.holding.sourceSha256,
      secondValidated.payload.sha256,
    );
    await pool.end();
  });

  it("recovers blockSummary after successful commit with lost connection response", async () => {
    const bytes = buildExtendedClientsFileBytes([sampleExtendedHolding()]);
    const seeded = validateClientsForApplyTest(bytes);
    assert.equal(seeded.ok, true);
    if (!seeded.ok) return;
    await applyClientsImport({ databaseUrl, payload: seeded.payload });

    const unverified = validateClientsFileBytes(
      buildExtendedClientsFileBytes([
        sampleExtendedHolding({ name_client: "Holding Alpha Post-Commit Loss" }),
      ]),
    );
    assert.equal(unverified.ok, true);
    if (!unverified.ok) return;

    const applied = await applyClientsImport({
      databaseUrl,
      payload: unverified.payload,
      expectedCommittedSha256: seeded.payload.sha256,
      testHooks: { failAfterCommitConfirm: true },
    });
    assert.equal(applied.ok, true);
    assert.equal(applied.blockSummary?.extendedApplied, false);
    assert.equal(applied.blockSummary?.extendedBlockReason, "awaiting_live_json_verification");
    assert.equal(applied.counts?.extendedBlockedCount, 1);

    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    const journal = await pool.query<{
      extended_diagnostics: {
        applyBlocks?: { extendedApplied?: boolean; extendedBlockReason?: string | null };
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
    assert.equal(journal.rows[0]?.extended_diagnostics?.applyBlocks?.extendedApplied, false);
    assert.equal(
      journal.rows[0]?.extended_diagnostics?.applyBlocks?.extendedBlockReason,
      "awaiting_live_json_verification",
    );
    await pool.end();
  });

});
