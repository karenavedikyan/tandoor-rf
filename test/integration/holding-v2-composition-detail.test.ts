import assert from "node:assert/strict";
import { before, beforeEach, describe, it } from "node:test";
import { Pool } from "pg";
import type { AccessContext } from "../../src/access/types";
import { loadHoldingV2CompositionDetail } from "../../src/clients/holding-v2-composition-detail";
import { applyClientsImport } from "../../src/onec-clients/apply";
import { setHoldingV2PipelineEnabledForTests } from "../../src/onec-clients/holding-v2-pipeline-config";
import { verificationFingerprintFromPayload } from "../../src/onec-clients/import-verification-fingerprint";
import { validateHoldingV2ClientsFileBytes } from "../../src/onec-clients/validate";
import { buildHoldingV2FileBytes, headRow, minimalOutlet } from "../helpers/holding-v2-fixtures";
import { getIntegrationDatabaseUrl, prepareDatabase, setIntegrationEnv } from "../helpers/test-db";

const H1 = "a1000000-0000-4000-8000-000000000001";
const S1 = "b1000000-0000-4000-8000-000000000001";

const adminContext: AccessContext = {
  userId: "00000000-0000-4000-8000-000000000099",
  role: "admin",
  fullClientBase: true,
  hasScopedClientAccess: true,
  hasEmployeeLink: false,
  employeeLinkConflict: false,
  explicitlyDeniedAll: false,
};

describe("holding v2 composition detail loader", { concurrency: false }, () => {
  let databaseUrl = "";

  before(async () => {
    databaseUrl = getIntegrationDatabaseUrl();
    setIntegrationEnv(databaseUrl);
    await prepareDatabase(databaseUrl);
  });

  beforeEach(async () => {
    setIntegrationEnv(databaseUrl);
    await prepareDatabase(databaseUrl);
    setHoldingV2PipelineEnabledForTests(true);
  });

  it("loads scoped legal entities and outlets for mono holding", async () => {
    const bytes = buildHoldingV2FileBytes([
      headRow(H1, { retail_outlets: [minimalOutlet(S1)] }),
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

    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    const client = await pool.connect();
    try {
      const detail = await loadHoldingV2CompositionDetail(adminContext, client, H1);
      assert.ok(detail);
      assert.equal(detail!.legalEntities.length, 1);
      assert.equal(detail!.legalEntities[0]?.isHoldingHead, true);
      assert.equal(detail!.outlets.length, 1);
      assert.equal(detail!.outlets[0]?.guidStore.toLowerCase(), S1.toLowerCase());
    } finally {
      client.release();
      await pool.end();
    }
  });
});
