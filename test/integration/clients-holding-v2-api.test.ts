import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import request from "supertest";
import { applyClientsImport } from "../../src/onec-clients/apply";
import { setHoldingV2PipelineEnabledForTests } from "../../src/onec-clients/holding-v2-pipeline-config";
import { verificationFingerprintFromPayload } from "../../src/onec-clients/import-verification-fingerprint";
import { validateHoldingV2ClientsFileBytes } from "../../src/onec-clients/validate";
import { closePool, resetPoolForTests } from "../../src/db/pool";
import { insertSuccessfulImportRun } from "../helpers/clients-db-fixtures";
import {
  buildHoldingV2FileBytes,
  headRow,
  minimalOutlet,
  typeCategory,
} from "../helpers/holding-v2-fixtures";
import { loadHoldingV2ClientExchange } from "../../src/clients/holding-v2-exchange";
import { createTestUser, getIntegrationDatabaseUrl, prepareDatabase, setIntegrationEnv } from "../helpers/test-db";
import { Pool } from "pg";

const ORIGIN = "http://127.0.0.1:3000";
const TEST_PASSWORD = "StrongPass123!";
const H1 = "a1000000-0000-4000-8000-000000000001";
const S1 = "b1000000-0000-4000-8000-000000000001";
async function loadApp() {
  await resetPoolForTests();
  const { createApp } = await import("../../src/server");
  return createApp();
}

async function login(email: string): Promise<string> {
  const app = await loadApp();
  const res = await request(app)
    .post("/api/auth/login")
    .set({ Origin: ORIGIN, "Content-Type": "application/json" })
    .send({ email, password: TEST_PASSWORD });
  assert.equal(res.status, 200);
  return res.headers["set-cookie"]?.[0]?.split(";")[0] ?? "";
}

describe("clients API holding v2 exchange fields", { concurrency: false }, () => {
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

  after(async () => {
    setHoldingV2PipelineEnabledForTests(undefined);
    await closePool();
  });

  it("card and list expose v2 composition and type_category after pipeline apply", async () => {
    const bytes = buildHoldingV2FileBytes([
      headRow(H1, {
        name_client: "V2 API Client",
        type_category: typeCategory({ guid_type: "api-type", name_type: "API Type Name" }),
        retail_outlets: [
          minimalOutlet(S1, {
            type_category: typeCategory({ guid_type: "out-type", name_type: "Outlet Type Name" }),
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

    await insertSuccessfulImportRun(databaseUrl);
    const adminEmail = "admin-hv2@test.local";
    await createTestUser({
      databaseUrl,
      email: adminEmail,
      password: TEST_PASSWORD,
      fullName: "Admin HV2",
      role: "admin",
    });

    const verifyPool = new Pool({ connectionString: databaseUrl, max: 1 });
    const direct = await loadHoldingV2ClientExchange(verifyPool, H1, { visibility: "visible" });
    await verifyPool.end();
    assert.ok(direct?.hasStoredState, "expected v2 apply_state in DB before API read");

    const cookie = await login(adminEmail);
    const app = await loadApp();
    const card = await request(app)
      .get(`/api/clients/${H1}`)
      .set({ Origin: ORIGIN, Cookie: cookie });
    assert.equal(card.status, 200);
    assert.equal(card.body.client?.holdingV2?.compositionSiteType, "mono");
    assert.match(card.body.client?.holdingV2?.typeCategory?.nameType?.label ?? "", /API Type Name/);

    const list = await request(app)
      .get("/api/clients?page=1&pageSize=50")
      .set({ Origin: ORIGIN, Cookie: cookie });
    assert.equal(list.status, 200);
    const item = (list.body.items as Array<{ guid: string; holdingV2CompositionLabel?: string }>).find(
      (row) => row.guid.toLowerCase() === H1.toLowerCase(),
    );
    assert.ok(item?.holdingV2CompositionLabel);
  });
});
