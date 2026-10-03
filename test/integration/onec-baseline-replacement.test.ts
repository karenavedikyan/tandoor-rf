import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { Pool } from "pg";
import { runBaselineReplacement } from "../../src/onec-clients/baseline-replacement";
import { getClientByGuid } from "../../src/clients/repository";
import type { AccessContext } from "../../src/access/types";
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
import { getIntegrationDatabaseUrl, prepareDatabase, setIntegrationEnv } from "../helpers/test-db";

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

describe("onec baseline replacement integration", { concurrency: false }, () => {
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

  async function seedLegacyClients(): Promise<void> {
    const legacyBytes = buildClientsFileBytes([sampleClient(), sampleClientTwo()]);
    const legacyValidated = validateClientsForApplyTest(legacyBytes);
    assert.equal(legacyValidated.ok, true);
    if (!legacyValidated.ok) return;
    await applyClientsImportVerified({ databaseUrl, payload: legacyValidated.payload });
  }

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
    return { holdingGuid, childGuid, orphanGuid: sampleClientTwo().guid_client as string, clientsBytes, manifestBytes };
  }

  it("dry-run then apply archives old clients and hides them from scope", async () => {
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
    assert.equal(dryRun.plan.quarantinedRecordCount, 1);
    assert.ok(dryRun.plan.operations.archive.count >= 1);
    assert.equal(dryRun.plan.migrationReadiness.ready, true);
    assert.equal(dryRun.plan.excludedArchiveDependencies.availability, "loaded");
    assert.equal(dryRun.plan.acceptedProjection.recordCount, 1);
    assert.equal(dryRun.plan.applyAllowed, true);

    const apply = await runBaselineReplacement({
      databaseUrl,
      mode: "apply",
      clientsBytes: scenario.clientsBytes,
      quarantineManifestBytes: scenario.manifestBytes,
      holdingLinkValidationPolicy: "tolerant",
      expectedFingerprint: dryRun.plan.fingerprint,
    });
    assert.equal(apply.ok, true, apply.ok ? "" : `${apply.code}: ${apply.message}`);

    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    const statuses = await pool.query<{ guid_client: string; baseline_status: string }>(
      `SELECT guid_client::text, baseline_status FROM onec_clients`,
    );
    const quarantineRows = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM onec_client_quarantine_records WHERE superseded_at IS NULL`,
    );
    await pool.end();

    const statusMap = new Map(statuses.rows.map((row) => [row.guid_client.toLowerCase(), row.baseline_status]));
    assert.equal(statusMap.get(scenario.holdingGuid.toLowerCase()), "active");
    assert.equal(statusMap.get(scenario.orphanGuid.toLowerCase()), "archived_baseline");
    assert.equal(Number(quarantineRows.rows[0]?.count), 1);
    assert.equal(statusMap.has(scenario.childGuid.toLowerCase()), false);

    const admin = adminContext("00000000-0000-4000-8000-000000000099");
    assert.ok(await getClientByGuid(admin, scenario.holdingGuid));
    assert.equal(await getClientByGuid(admin, scenario.orphanGuid), null);
    assert.equal(await getClientByGuid(admin, scenario.childGuid), null);
  });

  it("rejects apply when fingerprint mismatches", async () => {
    const scenario = buildQuarantineScenario();
    const result = await runBaselineReplacement({
      databaseUrl,
      mode: "apply",
      clientsBytes: scenario.clientsBytes,
      quarantineManifestBytes: scenario.manifestBytes,
      expectedFingerprint: "f".repeat(64),
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "FINGERPRINT_MISMATCH");
  });

  it("rollback restores baseline_status snapshot after apply", async () => {
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

    const apply = await runBaselineReplacement({
      databaseUrl,
      mode: "apply",
      clientsBytes: scenario.clientsBytes,
      quarantineManifestBytes: scenario.manifestBytes,
      holdingLinkValidationPolicy: "tolerant",
      expectedFingerprint: dryRun.plan.fingerprint,
    });
    assert.equal(apply.ok, true);

    const rollback = await runBaselineReplacement({
      databaseUrl,
      mode: "rollback",
      clientsBytes: Buffer.alloc(0),
      quarantineManifestBytes: Buffer.alloc(0),
    });
    assert.equal(rollback.ok, true);
    if (!rollback.ok) return;
    assert.ok((rollback.apply?.restoredCount ?? 0) > 0);

    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    const orphan = await pool.query<{ baseline_status: string }>(
      `SELECT baseline_status FROM onec_clients WHERE guid_client = $1::uuid`,
      [scenario.orphanGuid],
    );
    await pool.end();
    assert.equal(orphan.rows[0]?.baseline_status, "active");
  });
});
