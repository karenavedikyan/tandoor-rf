import assert from "node:assert/strict";
import { before, beforeEach, describe, it } from "node:test";
import { Pool, type PoolClient } from "pg";
import { HOLDING_V2_RECONCILE_ADVISORY_LOCK_KEY } from "../../src/onec-clients/constants";
import { applyClientsImport } from "../../src/onec-clients/apply";
import { setHoldingV2PipelineEnabledForTests } from "../../src/onec-clients/holding-v2-pipeline-config";
import { verificationFingerprintFromPayload } from "../../src/onec-clients/import-verification-fingerprint";
import { validateHoldingV2ClientsFileBytes } from "../../src/onec-clients/validate";
import {
  buildHoldingV2FileBytes,
  headRow,
  minimalOutlet,
} from "../helpers/holding-v2-fixtures";
import { loadActiveLegalLinks } from "../helpers/holding-v2-reconcile-db";
import { getIntegrationDatabaseUrl, prepareDatabase, setIntegrationEnv } from "../helpers/test-db";

const H1 = "a1000000-0000-4000-8000-000000000001";
const S1 = "b1000000-0000-4000-8000-000000000001";

describe("holding v2 pipeline lock + rollback", { concurrency: false }, () => {
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

  it("second connection cannot reconcile while first holds v2 lock mid-transaction", async () => {
    const bytes = buildHoldingV2FileBytes([headRow(H1, { retail_outlets: [minimalOutlet(S1)] })]);
    const validated = validateHoldingV2ClientsFileBytes(bytes);
    assert.equal(validated.ok, true);
    if (!validated.ok) return;
    const fp = verificationFingerprintFromPayload({ payload: validated.payload });

    const holder = new Pool({ connectionString: databaseUrl, max: 1 });
    const holderClient = await holder.connect();
    await holderClient.query("BEGIN");
    const acquired = await holderClient.query<{ acquired: boolean }>(
      `SELECT pg_try_advisory_lock($1) AS acquired`,
      [HOLDING_V2_RECONCILE_ADVISORY_LOCK_KEY],
    );
    assert.equal(acquired.rows[0]?.acquired, true);

    const blocked = await applyClientsImport({
      databaseUrl,
      payload: validated.payload,
      expectedVerificationFingerprint: fp,
    });
    assert.equal(blocked.ok, false);
    if (blocked.ok) return;
    assert.equal(blocked.code, "HOLDING_V2_RECONCILE_LOCKED");

    await holderClient.query(`SELECT pg_advisory_unlock($1)`, [HOLDING_V2_RECONCILE_ADVISORY_LOCK_KEY]);
    await holderClient.query("ROLLBACK");
    holderClient.release();
    await holder.end();

    const recovered = await applyClientsImport({
      databaseUrl,
      payload: validated.payload,
      expectedVerificationFingerprint: fp,
    });
    assert.equal(recovered.ok, true);
    if (!recovered.ok) return;

    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    assert.equal((await loadActiveLegalLinks(pool)).length, 1);
    await pool.end();
  });

  it("holds v2 lock through reconcile until COMMIT (second apply blocked mid-transaction)", async () => {
    const bytes = buildHoldingV2FileBytes([headRow(H1, { retail_outlets: [minimalOutlet(S1)] })]);
    const validated = validateHoldingV2ClientsFileBytes(bytes);
    assert.equal(validated.ok, true);
    if (!validated.ok) return;
    const fp = verificationFingerprintFromPayload({ payload: validated.payload });

    let releasePause!: () => void;
    const pauseGate = new Promise<void>((resolve) => {
      releasePause = resolve;
    });

    const firstApply = applyClientsImport({
      databaseUrl,
      payload: validated.payload,
      expectedVerificationFingerprint: fp,
      testHooks: {
        afterHoldingV2ReconcileBeforeCommit: async () => {
          const probePool = new Pool({ connectionString: databaseUrl, max: 1 });
          const probeClient = await probePool.connect();
          const stillHeld = await probeClient.query<{ acquired: boolean }>(
            `SELECT pg_try_advisory_lock($1) AS acquired`,
            [HOLDING_V2_RECONCILE_ADVISORY_LOCK_KEY],
          );
          assert.equal(stillHeld.rows[0]?.acquired, false, "v2 reconcile lock must stay held until COMMIT");
          probeClient.release();
          await probePool.end();
          await pauseGate;
        },
      },
    });

    await new Promise((r) => setTimeout(r, 50));
    const blocked = await applyClientsImport({
      databaseUrl,
      payload: validated.payload,
      expectedVerificationFingerprint: fp,
    });
    assert.equal(blocked.ok, false);
    if (blocked.ok) {
      releasePause();
      await firstApply;
      return;
    }
    assert.equal(blocked.code, "IMPORT_LOCKED");

    releasePause();
    const first = await firstApply;
    assert.equal(first.ok, true);
  });

  it("rolls back clients and v2 links when apply fails after reconcile lock", async () => {
    const bytes = buildHoldingV2FileBytes([headRow(H1, { retail_outlets: [minimalOutlet(S1)] })]);
    const validated = validateHoldingV2ClientsFileBytes(bytes);
    assert.equal(validated.ok, true);
    if (!validated.ok) return;
    const fp = verificationFingerprintFromPayload({ payload: validated.payload });

    const failed = await applyClientsImport({
      databaseUrl,
      payload: validated.payload,
      expectedVerificationFingerprint: fp,
      testHooks: {
        failExchangeStateUpdate: true,
      },
    });
    assert.equal(failed.ok, false);

    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    const legal = await loadActiveLegalLinks(pool);
    assert.equal(legal.length, 0);
    const clients = await pool.query(`SELECT COUNT(*)::int AS c FROM onec_clients`);
    assert.equal(clients.rows[0]?.c, 0);
    await pool.end();
  });
});
