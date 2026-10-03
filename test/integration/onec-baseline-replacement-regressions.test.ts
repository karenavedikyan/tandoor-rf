import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import pg from "pg";
import { Pool } from "pg";
import { getClientByGuid } from "../../src/clients/repository";
import type { AccessContext } from "../../src/access/types";
import { runBaselineReplacement } from "../../src/onec-clients/baseline-replacement";
import { applyClientsImportVerified } from "../helpers/onec-clients-fixtures";
import {
  buildExtendedClientsFileBytes,
  EXTENDED_FIXTURE_GUIDS,
  sampleExtendedChild,
  sampleExtendedHolding,
  validateClientsForApplyTest,
} from "../helpers/onec-clients-extended-fixtures";
import { buildClientsFileBytes, sampleClient, sampleClientTwo } from "../helpers/onec-clients-fixtures";
import { sha256Hex } from "../../src/onec-clients/sha256";
import { grantClientAccess, linkUserToEmployee } from "../helpers/access-db-fixtures";
import {
  createTestUser,
  getIntegrationDatabaseUrl,
  prepareDatabase,
  setIntegrationEnv,
} from "../helpers/test-db";
import { wholesaleRosterWithManagers } from "../helpers/onec-clients-employee-roster-fixtures";

function adminContext(userId: string): AccessContext {
  return {
    userId,
    role: "admin",
    employeeId: null,
    employeeLinkConflict: false,
    hasEmployeeLink: true,
    hasScopedClientAccess: true,
    fullClientBase: true,
    status: "active",
    explicitlyDeniedAll: false,
  };
}

function managerContext(userId: string, employeeId: string): AccessContext {
  return {
    userId,
    role: "manager",
    employeeId,
    employeeLinkConflict: false,
    hasEmployeeLink: true,
    hasScopedClientAccess: true,
    fullClientBase: false,
    status: "active",
    explicitlyDeniedAll: false,
  };
}

describe("onec baseline replacement regressions", { concurrency: false }, () => {
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

  after(async () => {
    // no shared pool
  });

  function buildQuarantineScenario() {
    const holdingGuid = EXTENDED_FIXTURE_GUIDS.HOLDING_GUID;
    const childGuid = EXTENDED_FIXTURE_GUIDS.CHILD_GUID;
    const clientsBytes = buildExtendedClientsFileBytes([
      sampleExtendedHolding({ guid_client: holdingGuid, holding: false }),
      sampleExtendedChild({ guid_client: childGuid, guid_holding: holdingGuid }),
    ]);
    const sourceSha256 = sha256Hex(clientsBytes);
    const manifestBytes = Buffer.from(
      JSON.stringify({
        v: 1,
        sourceSha256,
        entries: [
          {
            guidClient: childGuid,
            reason: "HOLDING_TARGET_NOT_HOLDING_CARD",
            relatedGuid: holdingGuid,
          },
        ],
      }),
      "utf8",
    );
    return {
      holdingGuid,
      childGuid,
      orphanGuid: sampleClientTwo().guid_client as string,
      clientsBytes,
      manifestBytes,
    };
  }

  async function countActiveClients(): Promise<number> {
    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    const result = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM onec_clients WHERE COALESCE(baseline_status, 'active') = 'active'`,
    );
    await pool.end();
    return Number(result.rows[0]?.count ?? "0");
  }

  async function installQuarantineInsertTrigger(): Promise<void> {
    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    await pool.query(`
      CREATE OR REPLACE FUNCTION fail_quarantine_insert() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'simulated quarantine insert failure';
      END;
      $$ LANGUAGE plpgsql;
    `);
    await pool.query(`
      DROP TRIGGER IF EXISTS trg_fail_quarantine_insert ON onec_client_quarantine_records;
      CREATE TRIGGER trg_fail_quarantine_insert
      BEFORE INSERT ON onec_client_quarantine_records
      FOR EACH ROW EXECUTE FUNCTION fail_quarantine_insert();
    `);
    await pool.end();
  }

  it("rolls back entire apply when quarantine insert fails (atomicity)", async () => {
    const scenario = buildQuarantineScenario();
    await installQuarantineInsertTrigger();

    const dryRun = await runBaselineReplacement({
      databaseUrl,
      mode: "dry_run",
      clientsBytes: scenario.clientsBytes,
      quarantineManifestBytes: scenario.manifestBytes,
      holdingLinkValidationPolicy: "tolerant",
    });
    assert.equal(dryRun.ok, true);
    if (!dryRun.ok || !dryRun.plan) return;

    const apply = await runBaselineReplacement({
      databaseUrl,
      mode: "apply",
      clientsBytes: scenario.clientsBytes,
      quarantineManifestBytes: scenario.manifestBytes,
      holdingLinkValidationPolicy: "tolerant",
      expectedFingerprint: dryRun.plan.fingerprint,
    });
    assert.equal(apply.ok, false);
    if (apply.ok) return;
    assert.equal(apply.code, "DATABASE_ERROR");
    assert.equal(await countActiveClients(), 0);

    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    const total = await pool.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM onec_clients`);
    const quarantine = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM onec_client_quarantine_records`,
    );
    await pool.end();
    assert.equal(Number(total.rows[0]?.count ?? "0"), 0);
    assert.equal(Number(quarantine.rows[0]?.count ?? "0"), 0);
  });

  it("rollback on empty DB deactivates newly applied clients", async () => {
    const scenario = buildQuarantineScenario();

    const dryRun = await runBaselineReplacement({
      databaseUrl,
      mode: "dry_run",
      clientsBytes: scenario.clientsBytes,
      quarantineManifestBytes: scenario.manifestBytes,
      holdingLinkValidationPolicy: "tolerant",
    });
    assert.equal(dryRun.ok, true);
    if (!dryRun.ok || !dryRun.plan) return;

    const apply = await runBaselineReplacement({
      databaseUrl,
      mode: "apply",
      clientsBytes: scenario.clientsBytes,
      quarantineManifestBytes: scenario.manifestBytes,
      holdingLinkValidationPolicy: "tolerant",
      expectedFingerprint: dryRun.plan.fingerprint,
    });
    assert.equal(apply.ok, true);
    assert.equal(await countActiveClients(), 1);

    const rollback = await runBaselineReplacement({
      databaseUrl,
      mode: "rollback",
      clientsBytes: Buffer.alloc(0),
      quarantineManifestBytes: Buffer.alloc(0),
    });
    assert.equal(rollback.ok, true);
    assert.equal(await countActiveClients(), 0);
  });

  async function seedLegacyClients(): Promise<void> {
    const legacyBytes = buildClientsFileBytes([sampleClient(), sampleClientTwo()]);
    const legacyValidated = validateClientsForApplyTest(legacyBytes);
    assert.equal(legacyValidated.ok, true);
    if (!legacyValidated.ok) return;
    await applyClientsImportVerified({ databaseUrl, payload: legacyValidated.payload });
  }

  it("detects stale plan when active client data changes after dry-run", async () => {
    await seedLegacyClients();
    const scenario = buildQuarantineScenario();
    const dryRun = await runBaselineReplacement({
      databaseUrl,
      mode: "dry_run",
      clientsBytes: scenario.clientsBytes,
      quarantineManifestBytes: scenario.manifestBytes,
      holdingLinkValidationPolicy: "tolerant",
    });
    assert.equal(dryRun.ok, true);
    if (!dryRun.ok || !dryRun.plan) return;
    const firstFingerprint = dryRun.plan.fingerprint;

    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    await pool.query(
      `UPDATE onec_clients SET name_client = name_client || '-new', source_sha256 = repeat('f', 64) WHERE guid_client = $1::uuid`,
      [sampleClient().guid_client],
    );
    await pool.end();

    const dryRun2 = await runBaselineReplacement({
      databaseUrl,
      mode: "dry_run",
      clientsBytes: scenario.clientsBytes,
      quarantineManifestBytes: scenario.manifestBytes,
      holdingLinkValidationPolicy: "tolerant",
    });
    assert.equal(dryRun2.ok, true);
    if (!dryRun2.ok || !dryRun2.plan) return;
    assert.notEqual(dryRun2.plan.fingerprint, firstFingerprint);

    const apply = await runBaselineReplacement({
      databaseUrl,
      mode: "apply",
      clientsBytes: scenario.clientsBytes,
      quarantineManifestBytes: scenario.manifestBytes,
      holdingLinkValidationPolicy: "tolerant",
      expectedFingerprint: firstFingerprint,
    });
    assert.equal(apply.ok, false);
    if (apply.ok) return;
    assert.equal(apply.code, "STALE_PLAN");
  });

  it("returns structured migrations_not_ready when confirmation table is missing", async () => {
    const scenario = buildQuarantineScenario();
    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    await pool.query(`DROP TABLE IF EXISTS onec_extended_contract_confirmations CASCADE`);
    await pool.end();

    const dryRun = await runBaselineReplacement({
      databaseUrl,
      mode: "dry_run",
      clientsBytes: scenario.clientsBytes,
      quarantineManifestBytes: scenario.manifestBytes,
      holdingLinkValidationPolicy: "tolerant",
    });
    assert.equal(dryRun.ok, true);
    if (!dryRun.ok || !dryRun.plan) return;
    assert.equal(dryRun.plan.migrationReadiness.ready, false);
    assert.equal(dryRun.plan.applyAllowed, false);
    assert.ok(dryRun.plan.blockers.includes("migrations_not_ready"));
  });

  it("second apply with same fingerprint is idempotent without duplicating quarantine rows", async () => {
    const scenario = buildQuarantineScenario();
    const dryRun = await runBaselineReplacement({
      databaseUrl,
      mode: "dry_run",
      clientsBytes: scenario.clientsBytes,
      quarantineManifestBytes: scenario.manifestBytes,
      holdingLinkValidationPolicy: "tolerant",
    });
    assert.equal(dryRun.ok, true);
    if (!dryRun.ok || !dryRun.plan) return;

    const apply1 = await runBaselineReplacement({
      databaseUrl,
      mode: "apply",
      clientsBytes: scenario.clientsBytes,
      quarantineManifestBytes: scenario.manifestBytes,
      holdingLinkValidationPolicy: "tolerant",
      expectedFingerprint: dryRun.plan.fingerprint,
    });
    assert.equal(apply1.ok, true);

    const apply2 = await runBaselineReplacement({
      databaseUrl,
      mode: "apply",
      clientsBytes: scenario.clientsBytes,
      quarantineManifestBytes: scenario.manifestBytes,
      holdingLinkValidationPolicy: "tolerant",
      expectedFingerprint: dryRun.plan.fingerprint,
    });
    assert.equal(apply2.ok, true);

    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    const quarantine = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM onec_client_quarantine_records WHERE superseded_at IS NULL`,
    );
    const runs = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM onec_baseline_replacement_runs WHERE mode = 'apply' AND status = 'success'`,
    );
    await pool.end();
    assert.equal(Number(quarantine.rows[0]?.count ?? "0"), 1);
    assert.equal(Number(runs.rows[0]?.count ?? "0"), 1);
  });

  it("standard import after baseline replacement allows corrected quarantine client", async () => {
    const scenario = buildQuarantineScenario();
    const dryRun = await runBaselineReplacement({
      databaseUrl,
      mode: "dry_run",
      clientsBytes: scenario.clientsBytes,
      quarantineManifestBytes: scenario.manifestBytes,
      holdingLinkValidationPolicy: "tolerant",
    });
    assert.equal(dryRun.ok, true);
    if (!dryRun.ok || !dryRun.plan) return;

    const apply = await runBaselineReplacement({
      databaseUrl,
      mode: "apply",
      clientsBytes: scenario.clientsBytes,
      quarantineManifestBytes: scenario.manifestBytes,
      holdingLinkValidationPolicy: "tolerant",
      expectedFingerprint: dryRun.plan.fingerprint,
    });
    assert.equal(apply.ok, true);

    const correctedBytes = buildExtendedClientsFileBytes([
      sampleExtendedHolding({ guid_client: scenario.holdingGuid, holding: true }),
      sampleExtendedChild({ guid_client: scenario.childGuid, guid_holding: scenario.holdingGuid }),
    ]);
    const correctedValidated = validateClientsForApplyTest(correctedBytes);
    assert.equal(correctedValidated.ok, true);
    if (!correctedValidated.ok) return;

    const reimport = await applyClientsImportVerified({ databaseUrl, payload: correctedValidated.payload });
    assert.equal(reimport.ok, true, reimport.ok ? "" : `${reimport.code}: ${reimport.message}`);

    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    const child = await pool.query<{ baseline_status: string }>(
      `SELECT COALESCE(baseline_status, 'active') AS baseline_status FROM onec_clients WHERE guid_client = $1::uuid`,
      [scenario.childGuid],
    );
    await pool.end();
    assert.equal(child.rows[0]?.baseline_status, "active");
  });

  it("manager with grant cannot access archived baseline client", async () => {
    const admin = await createTestUser({
      databaseUrl,
      email: "admin-scope@example.com",
      password: "StrongPass123!",
      fullName: "Admin Scope",
      role: "admin",
    });
    const manager = await createTestUser({
      databaseUrl,
      email: "manager-scope@example.com",
      password: "StrongPass123!",
      fullName: "Manager Scope",
      role: "manager",
    });
    await linkUserToEmployee({
      databaseUrl,
      userId: manager.id,
      employeeId: EXTENDED_FIXTURE_GUIDS.MANAGER_A,
      confirmedByUserId: admin.id,
    });

    const legacyBytes = buildClientsFileBytes([sampleClient(), sampleClientTwo()]);
    const legacyValidated = validateClientsForApplyTest(legacyBytes);
    assert.equal(legacyValidated.ok, true);
    if (!legacyValidated.ok) return;
    await applyClientsImportVerified({ databaseUrl, payload: legacyValidated.payload });

    const orphanGuid = sampleClientTwo().guid_client as string;
    await grantClientAccess({
      databaseUrl,
      userId: manager.id,
      objectId: orphanGuid,
      grantedByUserId: admin.id,
    });

    const scenario = buildQuarantineScenario();
    const dryRun = await runBaselineReplacement({
      databaseUrl,
      mode: "dry_run",
      clientsBytes: scenario.clientsBytes,
      quarantineManifestBytes: scenario.manifestBytes,
      holdingLinkValidationPolicy: "tolerant",
    });
    assert.equal(dryRun.ok, true);
    if (!dryRun.ok || !dryRun.plan) return;

    const apply = await runBaselineReplacement({
      databaseUrl,
      mode: "apply",
      clientsBytes: scenario.clientsBytes,
      quarantineManifestBytes: scenario.manifestBytes,
      holdingLinkValidationPolicy: "tolerant",
      expectedFingerprint: dryRun.plan.fingerprint,
    });
    assert.equal(apply.ok, true);

    const mgrCtx = managerContext(manager.id, EXTENDED_FIXTURE_GUIDS.MANAGER_A);
    assert.equal(await getClientByGuid(mgrCtx, orphanGuid), null);
    assert.ok(await getClientByGuid(adminContext(admin.id), scenario.holdingGuid));
  });

  it("fingerprint changes when client address changes after dry-run", async () => {
    const scenario = buildQuarantineScenario();
    const seedValidated = validateClientsForApplyTest(
      buildExtendedClientsFileBytes([
        sampleExtendedHolding({ guid_client: scenario.holdingGuid, holding: false }),
      ]),
    );
    assert.equal(seedValidated.ok, true);
    if (!seedValidated.ok) return;
    await applyClientsImportVerified({ databaseUrl, payload: seedValidated.payload });

    const dryRun1 = await runBaselineReplacement({
      databaseUrl,
      mode: "dry_run",
      clientsBytes: scenario.clientsBytes,
      quarantineManifestBytes: scenario.manifestBytes,
      holdingLinkValidationPolicy: "tolerant",
    });
    assert.equal(dryRun1.ok, true);
    if (!dryRun1.ok || !dryRun1.plan) return;

    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    await pool.query(`UPDATE onec_clients SET address = address || '-changed' WHERE guid_client = $1::uuid`, [
      scenario.holdingGuid,
    ]);
    await pool.end();

    const dryRun2 = await runBaselineReplacement({
      databaseUrl,
      mode: "dry_run",
      clientsBytes: scenario.clientsBytes,
      quarantineManifestBytes: scenario.manifestBytes,
      holdingLinkValidationPolicy: "tolerant",
    });
    assert.equal(dryRun2.ok, true);
    if (!dryRun2.ok || !dryRun2.plan) return;
    assert.notEqual(dryRun2.plan.fingerprint, dryRun1.plan.fingerprint);
  });

  it("rejects idempotent retry when post-apply client data changed", async () => {
    const scenario = buildQuarantineScenario();
    const dryRun = await runBaselineReplacement({
      databaseUrl,
      mode: "dry_run",
      clientsBytes: scenario.clientsBytes,
      quarantineManifestBytes: scenario.manifestBytes,
      holdingLinkValidationPolicy: "tolerant",
    });
    assert.equal(dryRun.ok, true);
    if (!dryRun.ok || !dryRun.plan) return;

    const apply1 = await runBaselineReplacement({
      databaseUrl,
      mode: "apply",
      clientsBytes: scenario.clientsBytes,
      quarantineManifestBytes: scenario.manifestBytes,
      holdingLinkValidationPolicy: "tolerant",
      expectedFingerprint: dryRun.plan.fingerprint,
    });
    assert.equal(apply1.ok, true);

    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    await pool.query(`UPDATE onec_clients SET name_client = 'changed after apply' WHERE guid_client = $1::uuid`, [
      scenario.holdingGuid,
    ]);
    await pool.end();

    const apply2 = await runBaselineReplacement({
      databaseUrl,
      mode: "apply",
      clientsBytes: scenario.clientsBytes,
      quarantineManifestBytes: scenario.manifestBytes,
      holdingLinkValidationPolicy: "tolerant",
      expectedFingerprint: dryRun.plan.fingerprint,
    });
    assert.equal(apply2.ok, false);
    if (apply2.ok) return;
    assert.equal(apply2.code, "STALE_PLAN");
  });

  it("recovers committed baseline apply after COMMIT response loss", async () => {
    const scenario = buildQuarantineScenario();
    const dryRun = await runBaselineReplacement({
      databaseUrl,
      mode: "dry_run",
      clientsBytes: scenario.clientsBytes,
      quarantineManifestBytes: scenario.manifestBytes,
      holdingLinkValidationPolicy: "tolerant",
    });
    assert.equal(dryRun.ok, true);
    if (!dryRun.ok || !dryRun.plan) return;

    const originalQuery = pg.Client.prototype.query;
    let armed = false;
    let injected = false;
    pg.Client.prototype.query = function patchedQuery(
      this: pg.Client,
      ...args: Parameters<pg.Client["query"]>
    ) {
      const sql = typeof args[0] === "string" ? args[0] : "";
      const values = args[1] as unknown as unknown[] | undefined;
      if (/UPDATE\s+onec_baseline_replacement_runs/i.test(sql) && values?.[1] === "success") {
        armed = true;
      }
      if (armed && !injected && /^\s*COMMIT/i.test(sql)) {
        return originalQuery.apply(this, args).then((result) => {
          armed = false;
          injected = true;
          const err = new Error("connection lost after COMMIT") as Error & { code: string };
          err.code = "08006";
          throw err;
        });
      }
      return originalQuery.apply(this, args);
    };

    try {
      const apply = await runBaselineReplacement({
        databaseUrl,
        mode: "apply",
        clientsBytes: scenario.clientsBytes,
        quarantineManifestBytes: scenario.manifestBytes,
        holdingLinkValidationPolicy: "tolerant",
        expectedFingerprint: dryRun.plan.fingerprint,
      });
      assert.equal(apply.ok, true, apply.ok ? "" : `${apply.code}: ${apply.message}`);
      assert.equal(injected, true, "test must actually lose the COMMIT response");

      const pool = new Pool({ connectionString: databaseUrl, max: 1 });
      const activeCount = await pool.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM onec_clients WHERE COALESCE(baseline_status, 'active') = 'active'`,
      );
      const runStatus = await pool.query<{ status: string }>(
        `SELECT status FROM onec_baseline_replacement_runs WHERE mode = 'apply' ORDER BY finished_at DESC NULLS LAST LIMIT 1`,
      );
      await pool.end();
      assert.equal(Number(activeCount.rows[0]?.count ?? "0"), 1);
      assert.equal(runStatus.rows[0]?.status, "success");
    } finally {
      pg.Client.prototype.query = originalQuery;
    }
  });

  it("apply with extended contract confirmation stores snapshot and supports idempotent retry", async () => {
    const scenario = buildQuarantineScenario();
    const clientsBytes = scenario.clientsBytes;
    const manifestBytes = scenario.manifestBytes;
    const holdingGuid = scenario.holdingGuid;

    const dryRun = await runBaselineReplacement({
      databaseUrl,
      mode: "dry_run",
      clientsBytes,
      employeeRosterBytes: wholesaleRosterWithManagers(),
      quarantineManifestBytes: manifestBytes,
      holdingLinkValidationPolicy: "tolerant",
      confirmExtendedContract: true,
      operatorReference: "audit-live-contract-42",
    });
    assert.equal(dryRun.ok, true);
    if (!dryRun.ok || !dryRun.plan) return;
    assert.equal(dryRun.plan.extendedContract.status, "operator_confirmed");

    const apply1 = await runBaselineReplacement({
      databaseUrl,
      mode: "apply",
      clientsBytes,
      employeeRosterBytes: wholesaleRosterWithManagers(),
      quarantineManifestBytes: manifestBytes,
      holdingLinkValidationPolicy: "tolerant",
      confirmExtendedContract: true,
      operatorReference: "audit-live-contract-42",
      expectedFingerprint: dryRun.plan.fingerprint,
    });
    assert.equal(apply1.ok, true);

    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    const holding = await pool.query<{ extended_snapshot: unknown }>(
      `SELECT extended_snapshot FROM onec_clients WHERE guid_client = $1::uuid`,
      [holdingGuid],
    );
    const outlets = await pool.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM onec_retail_outlets`);
    await pool.end();
    assert.ok(holding.rows[0]?.extended_snapshot);

    const apply2 = await runBaselineReplacement({
      databaseUrl,
      mode: "apply",
      clientsBytes,
      employeeRosterBytes: wholesaleRosterWithManagers(),
      quarantineManifestBytes: manifestBytes,
      holdingLinkValidationPolicy: "tolerant",
      confirmExtendedContract: true,
      operatorReference: "audit-live-contract-42",
      expectedFingerprint: dryRun.plan.fingerprint,
    });
    assert.equal(apply2.ok, true);
    assert.equal(Number(outlets.rows[0]?.count ?? "0"), 1);
  });

  it("rejects changed policy or roster on retry after a successful apply", async () => {
    const scenario = buildQuarantineScenario();
    const options = {
      databaseUrl,
      clientsBytes: scenario.clientsBytes,
      quarantineManifestBytes: scenario.manifestBytes,
      holdingLinkValidationPolicy: "tolerant" as const,
      employeeRosterBytes: wholesaleRosterWithManagers(),
    };
    const dry = await runBaselineReplacement({ ...options, mode: "dry_run" });
    assert.ok(dry.ok && dry.plan);
    const expectedFingerprint = dry.plan.fingerprint;
    const first = await runBaselineReplacement({ ...options, mode: "apply", expectedFingerprint });
    assert.equal(first.ok, true);
    for (const override of [
      { holdingLinkValidationPolicy: "strict" as const },
      { employeeRosterBytes: Buffer.from("[]") },
    ]) {
      const retry = await runBaselineReplacement({
        ...options, ...override, mode: "apply", expectedFingerprint,
      });
      assert.equal(retry.ok, false, "old success must not authorize changed inputs");
      if (!retry.ok) assert.ok(["FINGERPRINT_MISMATCH", "STALE_PLAN"].includes(retry.code));
    }
  });

  it("rejects apply when roster bytes change but fingerprint stays old", async () => {
    const scenario = buildQuarantineScenario();
    const dryRun = await runBaselineReplacement({
      databaseUrl,
      mode: "dry_run",
      clientsBytes: scenario.clientsBytes,
      employeeRosterBytes: wholesaleRosterWithManagers(),
      quarantineManifestBytes: scenario.manifestBytes,
      holdingLinkValidationPolicy: "tolerant",
    });
    assert.equal(dryRun.ok, true);
    if (!dryRun.ok || !dryRun.plan) return;

    const apply = await runBaselineReplacement({
      databaseUrl,
      mode: "apply",
      clientsBytes: scenario.clientsBytes,
      quarantineManifestBytes: scenario.manifestBytes,
      holdingLinkValidationPolicy: "tolerant",
      expectedFingerprint: dryRun.plan.fingerprint,
    });
    assert.equal(apply.ok, false);
    if (apply.ok) return;
    assert.equal(apply.code, "FINGERPRINT_MISMATCH");
  });
});
