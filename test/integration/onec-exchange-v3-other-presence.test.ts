import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { closePool, query, resetPoolForTests } from "../../src/db/pool";
import { getV3LegalDetail } from "../../src/clients/v3/detail";
import { V3_CLIENT_OTHER_INVENTORY_KEYS } from "../../src/onec-exchange-v3/other-fields";
import { runExchangeV3RegularUpdate } from "../../src/onec-exchange-v3/run-update";
import { runLegalOtherFieldsBackfill } from "../../src/onec-exchange-v3/legal-other-fields-backfill/run-backfill";
import { buildEmployeeRosterBytes, buildEmployeeRosterEntry } from "../helpers/onec-clients-employee-roster-fixtures";
import { createTestUser, getIntegrationDatabaseUrl, prepareDatabase, setIntegrationEnv } from "../helpers/test-db";

const GUID = "b2000000-0000-4000-8000-000000000001";
const FIXTURE_DIR = path.join(process.cwd(), "test/fixtures/onec-exchange-v3");

describe("onec exchange v3 other_fields presence", { concurrency: false }, () => {
  let admin: { id: string };

  before(async () => {
    const databaseUrl = getIntegrationDatabaseUrl();
    setIntegrationEnv(databaseUrl, "http://127.0.0.1:0");
    await resetPoolForTests();
    await prepareDatabase(databaseUrl);
    admin = await createTestUser({
      databaseUrl,
      email: "admin-other-presence@example.com",
      password: "StrongPass123!",
      fullName: "Admin Presence",
      role: "admin",
    });
  });

  after(async () => {
    await closePool();
  });

  async function seedLegalRow() {
    await query("TRUNCATE onec_v3_legal_entities, onec_v3_holdings CASCADE");
    await query(
      `INSERT INTO onec_v3_legal_entities (guid_client, name_client, type_category, other_fields, last_source_sha256)
       VALUES ($1::uuid, 'SYNTH', '{}'::jsonb, '{}'::jsonb, $2)`,
      [GUID, "f".repeat(64)],
    );
  }

  it("regular update keeps trusted complete marker after backfill and re-import", async () => {
    const allValues = Object.fromEntries(V3_CLIENT_OTHER_INVENTORY_KEYS.map((k, i) => [k, `SYNTH_${i}`]));
    delete allValues.Оптовик_КонтактноеЛицо;
    const rawClients = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, "all_clients.json"), "utf8")) as Array<
      Record<string, unknown>
    >;
    rawClients[0].other = { ...allValues };
    const employeesBytes = buildEmployeeRosterBytes([
      buildEmployeeRosterEntry("22222222-2222-4222-8222-222222222222", { name_manager: "Manager One" }),
    ]);
    const inputs = {
      env: process.env,
      holdingsBytes: fs.readFileSync(path.join(FIXTURE_DIR, "all_holding.json")),
      clientsBytes: Buffer.from(JSON.stringify(rawClients)),
      retailBytes: fs.readFileSync(path.join(FIXTURE_DIR, "all_retail.json")),
      employeesBytes,
    };
    const dry = await runExchangeV3RegularUpdate({ ...inputs, argv: ["--dry-run"] });
    assert.equal(dry.status, "SUCCESS");
    const apply = await runExchangeV3RegularUpdate({
      ...inputs,
      argv: ["--apply", "--expected-fingerprint", dry.verificationFingerprint!],
    });
    assert.equal(apply.status, "SUCCESS");

    const context = {
      userId: admin.id,
      role: "admin" as const,
      status: "active" as const,
      employeeId: null,
      employeeLinkConflict: false,
      hasEmployeeLink: false,
      hasScopedClientAccess: false,
      fullClientBase: true,
      explicitlyDeniedAll: false,
      deniedClientGuids: new Set<string>(),
      deniedEmployeeGuids: new Set<string>(),
    };
    let detail = await getV3LegalDetail(context, GUID);
    assert.equal(detail.access, "visible");
    assert.equal(detail.entity.other_fields_exchange_complete, true);

    rawClients[0].name_client = "SYNTH renamed";
    const nextDry = await runExchangeV3RegularUpdate({
      ...inputs,
      clientsBytes: Buffer.from(JSON.stringify(rawClients)),
      argv: ["--dry-run"],
    });
    assert.equal(nextDry.status, "SUCCESS");
    const nextApply = await runExchangeV3RegularUpdate({
      ...inputs,
      clientsBytes: Buffer.from(JSON.stringify(rawClients)),
      argv: ["--apply", "--expected-fingerprint", nextDry.verificationFingerprint!],
    });
    assert.equal(nextApply.status, "SUCCESS");
    detail = await getV3LegalDetail(context, GUID);
    assert.equal(detail.entity.other_fields_exchange_complete, true);
    assert.equal(detail.entity.other_fields.Оптовик_КонтактноеЛицо, undefined);
    const states = detail.entity.other_field_states as Record<string, string>;
    assert.equal(states.Оптовик_КонтактноеЛицо, "empty_1c");
  });

  it("apply backfill then rollback via stored snapshot CLI", async () => {
    await seedLegalRow();
    const fixture = { guid_client: GUID, name_client: "SYNTH", other: { Код: "SYNTH_FIRST" } };
    const goodValues = Object.fromEntries(V3_CLIENT_OTHER_INVENTORY_KEYS.map((k, i) => [k, `RB_${i}`]));
    const goodBytes = Buffer.from(JSON.stringify([{ ...fixture, other: goodValues }]));
    const sha = (await import("node:crypto")).createHash("sha256").update(goodBytes).digest("hex");
    await query("UPDATE onec_v3_legal_entities SET last_source_sha256 = $2 WHERE guid_client = $1::uuid", [GUID, sha]);
    const dry = await runLegalOtherFieldsBackfill({ clientsBytes: goodBytes, argv: ["--dry-run"] });
    assert.equal(dry.status, "SUCCESS");
    const apply = await runLegalOtherFieldsBackfill({
      clientsBytes: goodBytes,
      argv: [
        "--apply",
        "--expected-source-sha256",
        sha,
        "--expected-plan-hash",
        dry.plan!.planHash,
        "--confirm-target-db",
        dry.targetDbFingerprint!,
      ],
    });
    assert.equal(apply.status, "SUCCESS");
    const beforeDry = await query<{ other_fields: Record<string, unknown> }>(
      "SELECT other_fields FROM onec_v3_legal_entities WHERE guid_client = $1::uuid",
      [GUID],
    );
    const dryRollback = await runLegalOtherFieldsBackfill({
      argv: ["--dry-run", "--rollback-plan-hash", dry.plan!.planHash],
    });
    assert.equal(dryRollback.status, "SUCCESS");
    assert.equal(dryRollback.mode, "dry_run");
    assert.equal(dryRollback.rolledBack, 1);
    const afterDry = await query<{ other_fields: Record<string, unknown> }>(
      "SELECT other_fields FROM onec_v3_legal_entities WHERE guid_client = $1::uuid",
      [GUID],
    );
    assert.deepEqual(afterDry.rows[0].other_fields, beforeDry.rows[0].other_fields);

    const wrongTarget = await runLegalOtherFieldsBackfill({
      argv: [
        "--apply",
        "--rollback-plan-hash",
        dry.plan!.planHash,
        "--expected-plan-hash",
        dry.plan!.planHash,
        "--confirm-target-db",
        "0".repeat(64),
      ],
    });
    assert.equal(wrongTarget.status, "REJECTED_BY_CHECKS");

    await query("UPDATE onec_v3_legal_entities SET last_source_sha256 = $2 WHERE guid_client = $1::uuid", [
      GUID,
      "d".repeat(64),
    ]);
    const driftDry = await runLegalOtherFieldsBackfill({
      argv: ["--dry-run", "--rollback-plan-hash", dry.plan!.planHash],
    });
    assert.equal(driftDry.rolledBack, 0);

    await query("UPDATE onec_v3_legal_entities SET last_source_sha256 = $2 WHERE guid_client = $1::uuid", [GUID, sha]);
    const rollback = await runLegalOtherFieldsBackfill({
      argv: [
        "--apply",
        "--rollback-plan-hash",
        dry.plan!.planHash,
        "--expected-plan-hash",
        dry.plan!.planHash,
        "--confirm-target-db",
        dry.targetDbFingerprint!,
      ],
    });
    assert.equal(rollback.status, "SUCCESS");
    assert.equal(rollback.mode, "apply");
    assert.equal(rollback.rolledBack, 1);
    const row = await query<{ other_fields: Record<string, unknown> }>(
      "SELECT other_fields FROM onec_v3_legal_entities WHERE guid_client = $1::uuid",
      [GUID],
    );
    assert.equal(row.rows[0].other_fields.Код, undefined);
  });
});
