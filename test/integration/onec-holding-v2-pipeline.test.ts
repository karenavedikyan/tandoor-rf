import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { Pool } from "pg";
import { applyClientsImport } from "../../src/onec-clients/apply";
import { setHoldingV2PipelineEnabledForTests } from "../../src/onec-clients/holding-v2-pipeline-config";
import { verificationFingerprintFromPayload } from "../../src/onec-clients/import-verification-fingerprint";
import { validateHoldingV2ClientsFileBytes } from "../../src/onec-clients/validate";
import {
  buildHoldingV2FileBytes,
  headRow,
  minimalOutlet,
  typeCategory,
} from "../helpers/holding-v2-fixtures";
import {
  countHoldingV2ReconcileRuns,
  loadActiveLegalLinks,
  loadClientTypeCategoryGuid,
  loadHoldingV2ApplyState,
} from "../helpers/holding-v2-reconcile-db";
import {
  getIntegrationDatabaseUrl,
  prepareDatabase,
  setIntegrationEnv,
} from "../helpers/test-db";

const H1 = "a1000000-0000-4000-8000-000000000001";
const S1 = "b1000000-0000-4000-8000-000000000001";

describe("onec holding v2 full import pipeline", { concurrency: false }, () => {
  let databaseUrl = "";

  before(async () => {
    databaseUrl = getIntegrationDatabaseUrl();
    setIntegrationEnv(databaseUrl);
    await prepareDatabase(databaseUrl);
  });

  beforeEach(async () => {
    setIntegrationEnv(databaseUrl);
    await prepareDatabase(databaseUrl);
    setHoldingV2PipelineEnabledForTests(undefined);
  });

  after(() => {
    setHoldingV2PipelineEnabledForTests(undefined);
  });

  it("v2 payload stays APPLY_BLOCKED when pipeline flag is off", async () => {
    const bytes = buildHoldingV2FileBytes([
      headRow(H1, { retail_outlets: [minimalOutlet(S1)] }),
    ]);
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

  it("applyClientsImport atomically writes clients and v2 reconcile when flag on", async () => {
    setHoldingV2PipelineEnabledForTests(true);
    const bytes = buildHoldingV2FileBytes([
      headRow(H1, {
        type_category: typeCategory({ guid_type: "pipe-head", name_type: "Head Type" }),
        retail_outlets: [
          minimalOutlet(S1, {
            type_category: typeCategory({ guid_type: "pipe-out", name_type: "Outlet Type" }),
          }),
        ],
      }),
    ]);
    const validated = validateHoldingV2ClientsFileBytes(bytes);
    assert.equal(validated.ok, true);
    if (!validated.ok) return;
    const fp = verificationFingerprintFromPayload({ payload: validated.payload });

    const applied = await applyClientsImport({
      databaseUrl,
      payload: validated.payload,
      expectedVerificationFingerprint: fp,
    });
    assert.equal(applied.ok, true);
    if (!applied.ok) return;
    assert.equal(applied.holdingV2Reconcile?.code, "SUCCESS");

    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    const legal = await loadActiveLegalLinks(pool);
    assert.equal(legal.length, 1);
    assert.equal(await loadClientTypeCategoryGuid(pool, H1), "pipe-head");
    const applyState = await loadHoldingV2ApplyState(pool);
    assert.ok(applyState.last_normalized_state_sha256);
    assert.equal(await countHoldingV2ReconcileRuns(pool, "success"), 1);

    const repeat = await applyClientsImport({
      databaseUrl,
      payload: validated.payload,
      expectedVerificationFingerprint: fp,
    });
    assert.equal(repeat.ok, true);
    if (!repeat.ok) {
      await pool.end();
      return;
    }
    assert.equal(repeat.holdingV2Reconcile?.code, "NO_CHANGES");
    assert.equal(await countHoldingV2ReconcileRuns(pool, "success"), 1);
    await pool.end();
  });
});
