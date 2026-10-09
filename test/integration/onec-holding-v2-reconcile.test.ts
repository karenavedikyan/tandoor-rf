import assert from "node:assert/strict";
import { before, beforeEach, describe, it } from "node:test";
import { Pool } from "pg";
import { HOLDING_V2_RECONCILE_ADVISORY_LOCK_KEY } from "../../src/onec-clients/constants";
import { applyClientsImport } from "../../src/onec-clients/apply";
import {
  analyzeOutletsForHoldingComposition,
  classifyHoldingCompositionSiteType,
} from "../../src/onec-clients/holding-v2-composition";
import { applyHoldingV2Reconciliation } from "../../src/onec-clients/holding-v2-reconcile";
import { verificationFingerprintFromPayload } from "../../src/onec-clients/import-verification-fingerprint";
import { validateHoldingV2ClientsFileBytes } from "../../src/onec-clients/validate";
import {
  buildCompositionPatternBundle,
  buildHoldingV2FileBytes,
  headRow,
  memberRow,
  minimalOutlet,
  typeCategory,
} from "../helpers/holding-v2-fixtures";
import {
  loadActiveLegalLinks,
  loadActiveOutletLinks,
  seedOnecClientsForReconcile,
} from "../helpers/holding-v2-reconcile-db";
import {
  getIntegrationDatabaseUrl,
  prepareDatabase,
  setIntegrationEnv,
} from "../helpers/test-db";

const H1 = "a1000000-0000-4000-8000-000000000001";
const H2 = "a2000000-0000-4000-8000-000000000002";
const M2 = "a1000000-0000-4000-8000-000000000011";
const S1 = "b1000000-0000-4000-8000-000000000001";
const S2 = "b1000000-0000-4000-8000-000000000002";

async function validateAndSeed(databaseUrl: string, bytes: Buffer) {
  const validated = validateHoldingV2ClientsFileBytes(bytes);
  assert.equal(validated.ok, true);
  if (!validated.ok) {
    throw new Error("validation failed");
  }
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  const client = await pool.connect();
  try {
    await seedOnecClientsForReconcile(client, validated.payload.records, validated.payload.sha256);
  } finally {
    client.release();
    await pool.end();
  }
  return validated;
}

describe("onec holding v2 reconciliation integration", { concurrency: false }, () => {
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

  it("public apply remains APPLY_BLOCKED for v2 payload", async () => {
    const bytes = buildHoldingV2FileBytes([headRow(H1, { retail_outlets: [minimalOutlet(S1)] })]);
    const validated = validateHoldingV2ClientsFileBytes(bytes);
    assert.equal(validated.ok, true);
    if (!validated.ok) return;
    const fp = verificationFingerprintFromPayload({ payload: validated.payload });
    const blocked = await applyClientsImport({
      databaseUrl,
      payload: validated.payload,
      expectedVerificationFingerprint: fp,
    });
    assert.equal(blocked.ok, false);
    if (blocked.ok) return;
    assert.equal(blocked.code, "APPLY_BLOCKED");
  });

  it("applies mono holding and returns NO_CHANGES on identical re-apply", async () => {
    const bytes = buildHoldingV2FileBytes([
      headRow(H1, {
        type_category: typeCategory({ guid_type: "t-head" }),
        retail_outlets: [minimalOutlet(S1, { type_category: typeCategory({ guid_type: "t-out" }) })],
      }),
    ]);
    const validated = await validateAndSeed(databaseUrl, bytes);
    const first = await applyHoldingV2Reconciliation({
      databaseUrl,
      payload: validated.payload,
    });
    assert.equal(first.ok, true);
    if (!first.ok) return;
    assert.equal(first.code, "SUCCESS");

    const second = await applyHoldingV2Reconciliation({
      databaseUrl,
      payload: validated.payload,
    });
    assert.equal(second.ok, true);
    if (!second.ok) return;
    assert.equal(second.code, "NO_CHANGES");

    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    const legal = await loadActiveLegalLinks(pool);
    assert.equal(legal.length, 1);
    assert.equal(legal[0]!.is_holding_head, true);
    const outlets = await loadActiveOutletLinks(pool);
    assert.equal(outlets.length, 1);
    await pool.end();
  });

  it("same source SHA after empty DB still applies (not NO_CHANGES on first run)", async () => {
    const bytes = buildHoldingV2FileBytes([headRow(H1, { retail_outlets: [minimalOutlet(S1)] })]);
    const validated = await validateAndSeed(databaseUrl, bytes);
    const first = await applyHoldingV2Reconciliation({ databaseUrl, payload: validated.payload });
    assert.equal(first.ok, true);
    if (!first.ok) return;
    assert.equal(first.code, "SUCCESS");
  });

  it("moves member legal entity and outlet between holdings", async () => {
    const snapA = buildHoldingV2FileBytes([
      headRow(H1, { retail_outlets: [minimalOutlet(S1)] }),
      memberRow(M2, H1),
    ]);
    const validatedA = await validateAndSeed(databaseUrl, snapA);
    assert.equal((await applyHoldingV2Reconciliation({ databaseUrl, payload: validatedA.payload })).ok, true);

    const snapB = buildHoldingV2FileBytes([
      headRow(H1, { retail_outlets: [] }),
      headRow(H2, { retail_outlets: [minimalOutlet(S1)] }),
      memberRow(M2, H2),
    ]);
    const validatedB = validateHoldingV2ClientsFileBytes(snapB);
    assert.equal(validatedB.ok, true);
    if (!validatedB.ok) return;
    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    const client = await pool.connect();
    await seedOnecClientsForReconcile(client, validatedB.payload.records, validatedB.payload.sha256);
    client.release();

    const moved = await applyHoldingV2Reconciliation({ databaseUrl, payload: validatedB.payload });
    assert.equal(moved.ok, true);
    if (!moved.ok) return;

    const legal = await loadActiveLegalLinks(pool);
    assert.equal(
      legal.find((r) => r.guid_client === M2.toLowerCase())?.guid_holding_root,
      H2.toLowerCase(),
    );
    const outlets = await loadActiveOutletLinks(pool);
    assert.equal(outlets[0]!.guid_holding_root, H2.toLowerCase());
    await pool.end();
  });

  it("empty retail_outlets on head clears outlet links for complete holding", async () => {
    const withOutlet = buildHoldingV2FileBytes([
      headRow(H1, { retail_outlets: [minimalOutlet(S1)] }),
    ]);
    const v1 = await validateAndSeed(databaseUrl, withOutlet);
    await applyHoldingV2Reconciliation({ databaseUrl, payload: v1.payload });

    const cleared = buildHoldingV2FileBytes([headRow(H1, { retail_outlets: [] })]);
    const v2 = validateHoldingV2ClientsFileBytes(cleared);
    assert.equal(v2.ok, true);
    if (!v2.ok) return;
    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    const client = await pool.connect();
    await seedOnecClientsForReconcile(client, v2.payload.records, v2.payload.sha256);
    client.release();
    await applyHoldingV2Reconciliation({ databaseUrl, payload: v2.payload });

    const outlets = await loadActiveOutletLinks(pool);
    assert.equal(outlets.length, 0);
    await pool.end();
  });

  it("partial snapshot with unchanged H1 yields NO_CHANGES (H2 preserved off-file)", async () => {
    const both = buildHoldingV2FileBytes([
      headRow(H1, { retail_outlets: [minimalOutlet(S1)] }),
      headRow(H2, { retail_outlets: [minimalOutlet(S2)] }),
    ]);
    const vBoth = await validateAndSeed(databaseUrl, both);
    const first = await applyHoldingV2Reconciliation({ databaseUrl, payload: vBoth.payload });
    assert.equal(first.code, "SUCCESS");

    const onlyH1 = buildHoldingV2FileBytes([headRow(H1, { retail_outlets: [minimalOutlet(S1)] })]);
    const v1 = validateHoldingV2ClientsFileBytes(onlyH1);
    assert.equal(v1.ok, true);
    if (!v1.ok) return;
    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    const client = await pool.connect();
    await seedOnecClientsForReconcile(client, v1.payload.records, v1.payload.sha256);
    client.release();
    const second = await applyHoldingV2Reconciliation({ databaseUrl, payload: v1.payload });
    assert.equal(second.ok, true);
    if (!second.ok) return;
    assert.equal(second.code, "NO_CHANGES");
    const legal = await loadActiveLegalLinks(pool);
    assert.ok(legal.some((r) => r.guid_holding_root === H2.toLowerCase()));
    await pool.end();
  });

  it("holding absent from file does not deactivate stored links", async () => {
    const both = buildHoldingV2FileBytes([
      headRow(H1, { retail_outlets: [minimalOutlet(S1)] }),
      headRow(H2, { retail_outlets: [minimalOutlet(S2)] }),
    ]);
    const vBoth = await validateAndSeed(databaseUrl, both);
    await applyHoldingV2Reconciliation({ databaseUrl, payload: vBoth.payload });

    const onlyH1 = buildHoldingV2FileBytes([headRow(H1, { retail_outlets: [minimalOutlet(S1)] })]);
    const v1 = validateHoldingV2ClientsFileBytes(onlyH1);
    assert.equal(v1.ok, true);
    if (!v1.ok) return;
    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    const client = await pool.connect();
    await seedOnecClientsForReconcile(client, v1.payload.records, v1.payload.sha256);
    client.release();
    await applyHoldingV2Reconciliation({ databaseUrl, payload: v1.payload });

    const legal = await loadActiveLegalLinks(pool);
    assert.ok(legal.some((r) => r.guid_holding_root === H2.toLowerCase()));
    await pool.end();
  });

  it("synthetic bundle invariants: 5062 legal rows, 2742 heads, composition tallies", async () => {
    const bytes = buildCompositionPatternBundle({ monoCount: 422, groupNetworkCount: 2320 });
    const validated = validateHoldingV2ClientsFileBytes(bytes);
    assert.equal(validated.ok, true);
    if (!validated.ok) return;
    assert.equal(validated.payload.recordCount, 5062);
    const dist = validated.payload.holdingV2Diagnostics!.compositionTypeDistribution;
    const headCount = validated.payload.holdingV2Diagnostics!.holdingRootCount;
    assert.equal(dist.mono + dist.mono_network + dist.group + dist.group_network + dist.no_active_outlets + dist.unknown, headCount);

    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    const client = await pool.connect();
    await seedOnecClientsForReconcile(client, validated.payload.records, validated.payload.sha256);
    client.release();

    const applied = await applyHoldingV2Reconciliation({ databaseUrl, payload: validated.payload });
    assert.equal(applied.ok, true);
    if (!applied.ok) return;

    const legal = await loadActiveLegalLinks(pool);
    assert.equal(legal.length, 5062);
    assert.equal(
      legal.filter((r) => r.is_holding_head).length,
      2742,
    );
    await pool.end();
  });

  it("closed outlet remains stored with closure flag", async () => {
    const bytes = buildHoldingV2FileBytes([
      headRow(H1, { retail_outlets: [minimalOutlet(S1, { closed: true })] }),
    ]);
    const validated = await validateAndSeed(databaseUrl, bytes);
    await applyHoldingV2Reconciliation({ databaseUrl, payload: validated.payload });
    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    let outlets = await loadActiveOutletLinks(pool);
    assert.equal(outlets[0]!.is_closed, true);

    const reopened = buildHoldingV2FileBytes([
      headRow(H1, { retail_outlets: [minimalOutlet(S1, { closed: false })] }),
    ]);
    const v2 = validateHoldingV2ClientsFileBytes(reopened);
    assert.equal(v2.ok, true);
    if (!v2.ok) return;
    const client = await pool.connect();
    await seedOnecClientsForReconcile(client, v2.payload.records, v2.payload.sha256);
    client.release();
    await applyHoldingV2Reconciliation({ databaseUrl, payload: v2.payload });
    outlets = await loadActiveOutletLinks(pool);
    assert.equal(outlets[0]!.is_closed, false);
    assert.equal(outlets[0]!.guid_store, S1.toLowerCase());
    await pool.end();
  });

  it("type_category {} does not wipe previously stored field keys", async () => {
    const withType = buildHoldingV2FileBytes([
      headRow(H1, {
        type_category: typeCategory({ guid_type: "keep-me" }),
        retail_outlets: [minimalOutlet(S1)],
      }),
    ]);
    const v1 = await validateAndSeed(databaseUrl, withType);
    await applyHoldingV2Reconciliation({ databaseUrl, payload: v1.payload });

    const emptyObject = buildHoldingV2FileBytes([
      headRow(H1, { type_category: {}, retail_outlets: [minimalOutlet(S1)] }),
    ]);
    const v2 = validateHoldingV2ClientsFileBytes(emptyObject);
    assert.equal(v2.ok, true);
    if (!v2.ok) return;
    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    const client = await pool.connect();
    await seedOnecClientsForReconcile(client, v2.payload.records, v2.payload.sha256);
    client.release();
    const second = await applyHoldingV2Reconciliation({ databaseUrl, payload: v2.payload });
    assert.equal(second.ok, true);
    if (!second.ok) return;
    assert.equal(second.code, "NO_CHANGES");

    const row = await pool.query<{ guid_type: string | null }>(
      `SELECT guid_type FROM onec_holding_v2_client_type_category WHERE guid_client = $1::uuid`,
      [H1],
    );
    assert.equal(row.rows[0]?.guid_type, "keep-me");
    await pool.end();
  });

  it("rolls back entire reconcile on missing onec_clients stub", async () => {
    const bytes = buildHoldingV2FileBytes([headRow(H1, { retail_outlets: [minimalOutlet(S1)] })]);
    const validated = validateHoldingV2ClientsFileBytes(bytes);
    assert.equal(validated.ok, true);
    if (!validated.ok) return;
    const failed = await applyHoldingV2Reconciliation({ databaseUrl, payload: validated.payload });
    assert.equal(failed.ok, false);
    if (failed.ok) return;
    assert.equal(failed.code, "CLIENT_STUB_MISSING");

    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    const legal = await loadActiveLegalLinks(pool);
    assert.equal(legal.length, 0);
    await pool.end();
  });

  it("rejects explicit null type_category patch", async () => {
    const bytes = buildHoldingV2FileBytes([
      headRow(H1, {
        type_category: typeCategory({ guid_type: "KEEP" }),
        retail_outlets: [minimalOutlet(S1)],
      }),
    ]);
    const v1 = await validateAndSeed(databaseUrl, bytes);
    await applyHoldingV2Reconciliation({ databaseUrl, payload: v1.payload });

    const nullType = buildHoldingV2FileBytes([
      headRow(H1, {
        type_category: { guid_type: null, name_type: "", guid_category: "", name_category: "" },
        retail_outlets: [minimalOutlet(S1)],
      }),
    ]);
    const v2 = validateHoldingV2ClientsFileBytes(nullType);
    assert.equal(v2.ok, true);
    if (!v2.ok) return;
    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    const client = await pool.connect();
    await seedOnecClientsForReconcile(client, v2.payload.records, v2.payload.sha256);
    client.release();
    const rejected = await applyHoldingV2Reconciliation({ databaseUrl, payload: v2.payload });
    assert.equal(rejected.ok, false);
    if (rejected.ok) return;
    assert.equal(rejected.code, "TYPE_CATEGORY_EXPLICIT_NULL");
    const row = await pool.query<{ guid_type: string | null }>(
      `SELECT guid_type FROM onec_holding_v2_client_type_category WHERE guid_client = $1::uuid`,
      [H1],
    );
    assert.equal(row.rows[0]?.guid_type, "KEEP");
    await pool.end();
  });

  it("rejects head demotion leaving orphan links on former root", async () => {
    const snapA = buildHoldingV2FileBytes([
      headRow(H1, { retail_outlets: [minimalOutlet(S1)] }),
      memberRow(M2, H1),
    ]);
    const vA = await validateAndSeed(databaseUrl, snapA);
    await applyHoldingV2Reconciliation({ databaseUrl, payload: vA.payload });

    const snapB = buildHoldingV2FileBytes([
      headRow(H2, { retail_outlets: [] }),
      memberRow(H1, H2),
    ]);
    const vB = validateHoldingV2ClientsFileBytes(snapB);
    assert.equal(vB.ok, true);
    if (!vB.ok) return;
    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    const client = await pool.connect();
    await seedOnecClientsForReconcile(client, vB.payload.records, vB.payload.sha256);
    client.release();
    const rejected = await applyHoldingV2Reconciliation({ databaseUrl, payload: vB.payload });
    assert.equal(rejected.ok, false);
    if (rejected.ok) return;
    assert.equal(rejected.code, "ORPHAN_HOLDING_LINKS");
    await pool.end();
  });

  it("allows coherent full transfer of member and outlet to new head", async () => {
    const snapA = buildHoldingV2FileBytes([
      headRow(H1, { retail_outlets: [minimalOutlet(S1)] }),
      memberRow(M2, H1),
    ]);
    const vA = await validateAndSeed(databaseUrl, snapA);
    await applyHoldingV2Reconciliation({ databaseUrl, payload: vA.payload });

    const snapB = buildHoldingV2FileBytes([
      headRow(H2, { retail_outlets: [minimalOutlet(S1)] }),
      memberRow(M2, H2),
      memberRow(H1, H2),
    ]);
    const vB = validateHoldingV2ClientsFileBytes(snapB);
    assert.equal(vB.ok, true);
    if (!vB.ok) return;
    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    const client = await pool.connect();
    await seedOnecClientsForReconcile(client, vB.payload.records, vB.payload.sha256);
    client.release();
    const moved = await applyHoldingV2Reconciliation({ databaseUrl, payload: vB.payload });
    assert.equal(moved.ok, true);
    if (!moved.ok) return;
    const legal = await loadActiveLegalLinks(pool);
    assert.equal(legal.find((r) => r.guid_client === M2.toLowerCase())?.guid_holding_root, H2.toLowerCase());
    const outlets = await loadActiveOutletLinks(pool);
    assert.equal(outlets[0]!.guid_holding_root, H2.toLowerCase());
    await pool.end();
  });

  it("rejects reconcile when outlet row lacks guid_store but list is present", async () => {
    const withOutlet = buildHoldingV2FileBytes([
      headRow(H1, { retail_outlets: [minimalOutlet(S1)] }),
    ]);
    const v1 = await validateAndSeed(databaseUrl, withOutlet);
    await applyHoldingV2Reconciliation({ databaseUrl, payload: v1.payload });

    const unknown = buildHoldingV2FileBytes([headRow(H1, { retail_outlets: [{ closed: false }] })]);
    const v2 = validateHoldingV2ClientsFileBytes(unknown);
    assert.equal(v2.ok, true);
    if (!v2.ok) return;
    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    const client = await pool.connect();
    await seedOnecClientsForReconcile(client, v2.payload.records, v2.payload.sha256);
    client.release();
    const rejected = await applyHoldingV2Reconciliation({ databaseUrl, payload: v2.payload });
    assert.equal(rejected.ok, false);
    if (rejected.ok) return;
    assert.equal(rejected.code, "OUTLET_COMPOSITION_INCOMPLETE");
    const outlets = await loadActiveOutletLinks(pool);
    assert.equal(outlets.length, 1);
    assert.equal(outlets[0]!.guid_store, S1.toLowerCase());
    await pool.end();
  });

  it("rolls back partial writes on injected failure then recovers", async () => {
    const bytes = buildHoldingV2FileBytes([
      headRow(H1, { retail_outlets: [minimalOutlet(S1)] }),
      memberRow(M2, H1),
    ]);
    const validated = await validateAndSeed(databaseUrl, bytes);
    const failed = await applyHoldingV2Reconciliation({
      databaseUrl,
      payload: validated.payload,
      injectFailureForTests: "after_legal_links",
    });
    assert.equal(failed.ok, false);
    if (failed.ok) return;

    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    let legal = await loadActiveLegalLinks(pool);
    assert.equal(legal.length, 0);

    const recovered = await applyHoldingV2Reconciliation({ databaseUrl, payload: validated.payload });
    assert.equal(recovered.ok, true);
    if (!recovered.ok) return;
    assert.equal(recovered.code, "SUCCESS");

    legal = await loadActiveLegalLinks(pool);
    assert.equal(legal.length, 2);
    const repeat = await applyHoldingV2Reconciliation({ databaseUrl, payload: validated.payload });
    assert.equal(repeat.code, "NO_CHANGES");
    await pool.end();
  });

  it("second connection gets RECONCILE_LOCKED while lock held", async () => {
    const bytes = buildHoldingV2FileBytes([headRow(H1, { retail_outlets: [minimalOutlet(S1)] })]);
    const validated = await validateAndSeed(databaseUrl, bytes);

    const holder = new Pool({ connectionString: databaseUrl, max: 1 });
    const waiter = new Pool({ connectionString: databaseUrl, max: 1 });
    const holderClient = await holder.connect();
    await holderClient.query("BEGIN");
    const acquired = await holderClient.query<{ acquired: boolean }>(
      `SELECT pg_try_advisory_lock($1) AS acquired`,
      [HOLDING_V2_RECONCILE_ADVISORY_LOCK_KEY],
    );
    assert.equal(acquired.rows[0]?.acquired, true);

    const blocked = await applyHoldingV2Reconciliation({ databaseUrl, payload: validated.payload });
    assert.equal(blocked.ok, false);
    if (blocked.ok) return;
    assert.equal(blocked.code, "RECONCILE_LOCKED");

    await holderClient.query(`SELECT pg_advisory_unlock($1)`, [HOLDING_V2_RECONCILE_ADVISORY_LOCK_KEY]);
    await holderClient.query("ROLLBACK");
    holderClient.release();
    await holder.end();
    await waiter.end();
  });

  it("classifies composition from persisted outlet closure (unknown vs no_active)", async () => {
    const unknownClosure = buildHoldingV2FileBytes([headRow(H1, { retail_outlets: [{ guid_store: S1 }] })]);
    const v = validateHoldingV2ClientsFileBytes(unknownClosure);
    assert.equal(v.ok, true);
    if (!v.ok) return;
    assert.equal(v.payload.holdingV2Diagnostics?.compositionTypeDistribution.unknown, 1);

    const closedOnly = buildHoldingV2FileBytes([
      headRow(H1, { retail_outlets: [minimalOutlet(S1, { closed: true })] }),
    ]);
    const v2 = validateHoldingV2ClientsFileBytes(closedOnly);
    assert.equal(v2.ok, true);
    if (!v2.ok) return;
    assert.equal(v2.payload.holdingV2Diagnostics?.compositionTypeDistribution.no_active_outlets, 1);

    const head = v2.payload.extendedRecords!.find((r) => r.guid_client === H1)!;
    const analysis = analyzeOutletsForHoldingComposition(head.retailOutlets);
    assert.equal(
      classifyHoldingCompositionSiteType({
        legalEntityCount: 1,
        activeOutletCount: analysis.activeUniqueGuidCount,
        membershipComplete: true,
        compositionDataComplete: analysis.compositionDataComplete,
      }),
      "no_active_outlets",
    );
  });
});
