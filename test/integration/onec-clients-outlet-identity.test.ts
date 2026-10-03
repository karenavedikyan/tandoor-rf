import assert from "node:assert/strict";
import { before, beforeEach, describe, it } from "node:test";
import { Pool } from "pg";
import type { AccessContext } from "../../src/access/types";
import { toClientExtendedDto } from "../../src/clients/extended-dto";
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

  it("counts missing outlets when retail_outlets is an explicit empty array", async () => {
    const firstBytes = buildExtendedClientsFileBytes([
      sampleExtendedHolding({
        retail_outlets: [sampleIdentifiedOutlet({ guid_store: EXTENDED_FIXTURE_GUIDS.STORE_ONE })],
      }),
    ]);
    const firstValidated = validateClientsForApplyTest(firstBytes);
    assert.equal(firstValidated.ok, true);
    if (!firstValidated.ok) return;
    await applyClientsImport({ databaseUrl, payload: firstValidated.payload });

    const secondBytes = buildExtendedClientsFileBytes([
      sampleExtendedHolding({
        retail_outlets: [],
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

  it("preserves confirmed loading time across ambiguous export and surfaces it in DTO", async () => {
    const adminContext: AccessContext = {
      userId: "admin",
      role: "admin",
      status: "active",
      fullClientBase: true,
      employeeId: null,
      teamIds: [],
    };

    const firstBytes = buildExtendedClientsFileBytes([
      sampleExtendedHolding({
        retail_outlets: [
          sampleIdentifiedOutlet({
            information_loading: { loading_on_monday: true, loading_time: "09:00" },
            LPR_information: { date_of_birth: "1980-05-01", bonus: 10 },
          }),
        ],
      }),
    ]);
    const firstValidated = validateClientsForApplyTest(firstBytes);
    assert.equal(firstValidated.ok, true);
    if (!firstValidated.ok) return;
    await applyClientsImport({ databaseUrl, payload: firstValidated.payload });

    const secondBytes = buildExtendedClientsFileBytes([
      sampleExtendedHolding({
        retail_outlets: [
          sampleIdentifiedOutlet({
            information_loading: { loading_on_monday: true, loading_time: "0001-01-01T00:00:00" },
            LPR_information: { date_of_birth: "0001-01-01T00:00:00", bonus: 10 },
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
    const row = await pool.query<{
      is_holding: boolean;
      extended_format_version: string;
      extended_source_sha256: string;
      extended_imported_at: Date;
      extended_freshness_state: string;
      extended_snapshot: unknown;
    }>(
      `
        SELECT is_holding, extended_format_version, extended_source_sha256,
               extended_imported_at, extended_freshness_state, extended_snapshot
        FROM onec_clients
        WHERE guid_client = $1::uuid
      `,
      [EXTENDED_FIXTURE_GUIDS.HOLDING_GUID],
    );
    const outlet = (
      row.rows[0]?.extended_snapshot as {
        currentRetailOutlets: Array<{
          loading: { loadingTime: string | null; loadingTimeAmbiguousIncomingRaw?: string | null };
          lpr: { dateOfBirth: string | null; dateOfBirthAmbiguousIncomingRaw?: string | null };
        }>;
      }
    ).currentRetailOutlets[0];
    assert.equal(outlet?.loading.loadingTime, "09:00");
    assert.equal(outlet?.loading.loadingTimeAmbiguousIncomingRaw, "0001-01-01T00:00:00");
    assert.equal(outlet?.lpr.dateOfBirth, "1980-05-01");
    assert.equal(outlet?.lpr.dateOfBirthAmbiguousIncomingRaw, "0001-01-01T00:00:00");

    const dto = toClientExtendedDto(row.rows[0]!, adminContext);
    assert.equal(dto?.retailOutlets[0]?.loading.loadingTime, "09:00");
    assert.match(dto?.retailOutlets[0]?.loading.loadingTimeNote ?? "", /неоднозначное значение/);
    assert.match(dto?.retailOutlets[0]?.dataSourceLabel ?? "", /Частично подтверждено/);
    await pool.end();
  });

  it("preserves confirmed values through A→B→C ambiguous exports and updates on D", async () => {
    const adminContext: AccessContext = {
      userId: "admin",
      role: "admin",
      status: "active",
      fullClientBase: true,
      employeeId: null,
      teamIds: [],
    };

    const snapshotA = buildExtendedClientsFileBytes([
      sampleExtendedHolding({
        retail_outlets: [
          sampleIdentifiedOutlet({
            information_loading: { loading_on_monday: true, loading_time: "09:00" },
            LPR_information: { date_of_birth: "1980-05-01", bonus: 10 },
          }),
        ],
      }),
    ]);
    const validatedA = validateClientsForApplyTest(snapshotA);
    assert.equal(validatedA.ok, true);
    if (!validatedA.ok) return;
    await applyClientsImport({ databaseUrl, payload: validatedA.payload });

    const ambiguousOutlet = sampleIdentifiedOutlet({
      information_loading: { loading_on_monday: true, loading_time: "0001-01-01T00:00:00" },
      LPR_information: { date_of_birth: "0001-01-01T00:00:00", bonus: 10 },
    });
    let committedSha = validatedA.payload.sha256;
    for (let pass = 0; pass < 2; pass += 1) {
      const bytes = buildExtendedClientsFileBytes([sampleExtendedHolding({ retail_outlets: [ambiguousOutlet] })]);
      const validated = validateClientsForApplyTest(bytes);
      assert.equal(validated.ok, true);
      if (!validated.ok) return;
      const applied = await applyClientsImport({
        databaseUrl,
        payload: validated.payload,
        expectedCommittedSha256: committedSha,
      });
      assert.equal(applied.ok, true);
      committedSha = validated.payload.sha256;
    }

    const poolAfterC = new Pool({ connectionString: databaseUrl, max: 1 });
    const midRow = await poolAfterC.query<{
      extended_snapshot: {
        currentRetailOutlets: Array<{
          loading: { loadingTime: string | null; loadingTimeFieldProvenance?: { sourceSha256: string } };
          lpr: { dateOfBirth: string | null; dateOfBirthFieldProvenance?: { sourceSha256: string } };
        }>;
      };
    }>(
      "SELECT extended_snapshot FROM onec_clients WHERE guid_client = $1::uuid",
      [EXTENDED_FIXTURE_GUIDS.HOLDING_GUID],
    );
    const midOutlet = midRow.rows[0]?.extended_snapshot.currentRetailOutlets[0];
    assert.equal(midOutlet?.loading.loadingTime, "09:00");
    assert.equal(midOutlet?.lpr.dateOfBirth, "1980-05-01");
    assert.equal(midOutlet?.loading.loadingTimeFieldProvenance?.sourceSha256, validatedA.payload.sha256);
    await poolAfterC.end();

    const snapshotD = buildExtendedClientsFileBytes([
      sampleExtendedHolding({
        retail_outlets: [
          sampleIdentifiedOutlet({
            information_loading: { loading_on_monday: true, loading_time: "10:30" },
            LPR_information: { date_of_birth: "1985-06-20", bonus: 12 },
          }),
        ],
      }),
    ]);
    const validatedD = validateClientsForApplyTest(snapshotD);
    assert.equal(validatedD.ok, true);
    if (!validatedD.ok) return;
    await applyClientsImport({
      databaseUrl,
      payload: validatedD.payload,
      expectedCommittedSha256: committedSha,
    });

    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    const row = await pool.query<{
      extended_source_sha256: string;
      extended_snapshot: {
        currentRetailOutlets: Array<{
          loading: {
            loadingTime: string | null;
            loadingTimeFieldProvenance?: { sourceSha256: string; freshness: string };
          };
          lpr: {
            dateOfBirth: string | null;
            dateOfBirthFieldProvenance?: { sourceSha256: string; freshness: string };
          };
        }>;
        retailOutletHistory: unknown[];
      };
    }>(
      `
        SELECT extended_source_sha256, extended_snapshot
        FROM onec_clients
        WHERE guid_client = $1::uuid
      `,
      [EXTENDED_FIXTURE_GUIDS.HOLDING_GUID],
    );
    const outletRow = row.rows[0]?.extended_snapshot.currentRetailOutlets[0];
    assert.equal(outletRow?.loading.loadingTime, "10:30");
    assert.equal(outletRow?.lpr.dateOfBirth, "1985-06-20");
    assert.equal(outletRow?.loading.loadingTimeFieldProvenance?.sourceSha256, validatedD.payload.sha256);
    assert.equal(outletRow?.loading.loadingTimeFieldProvenance?.freshness, "current");

    const dto = toClientExtendedDto(
      {
        is_holding: true,
        extended_format_version: "extended_v1",
        extended_source_sha256: row.rows[0]!.extended_source_sha256,
        extended_imported_at: new Date("2026-01-04T10:00:00Z"),
        extended_freshness_state: "current",
        extended_snapshot: row.rows[0]!.extended_snapshot,
      },
      adminContext,
    );
    assert.equal(dto?.retailOutlets[0]?.loading.loadingTime, "10:30");
    assert.equal(dto?.retailOutlets[0]?.loading.loadingTimeNote, null);
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
