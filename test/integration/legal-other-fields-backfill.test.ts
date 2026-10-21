import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { closePool, getPool, query, resetPoolForTests } from "../../src/db/pool";
import { V3_CLIENT_OTHER_INVENTORY_KEYS } from "../../src/onec-exchange-v3/other-fields";
import { parseLegalOtherFieldsBackfillCliArgs } from "../../src/onec-exchange-v3/legal-other-fields-backfill/cli-args";
import { rollbackLegalOtherFieldsFromSnapshot } from "../../src/onec-exchange-v3/legal-other-fields-backfill/rollback";
import { runLegalOtherFieldsBackfill } from "../../src/onec-exchange-v3/legal-other-fields-backfill/run-backfill";
import { getIntegrationDatabaseUrl, prepareDatabase, setIntegrationEnv } from "../helpers/test-db";

const GUID = "b2000000-0000-4000-8000-000000000001";

describe("legal other_fields backfill integration", { concurrency: false }, () => {
  before(async () => {
    const databaseUrl = getIntegrationDatabaseUrl();
    setIntegrationEnv(databaseUrl, "http://127.0.0.1:0");
    await resetPoolForTests();
    await prepareDatabase(databaseUrl);
  });

  after(async () => {
    await closePool();
  });

  it("rejects bad source, null history, and supports guarded rollback", async () => {
    await query("TRUNCATE onec_v3_legal_entities, onec_v3_holdings CASCADE");
    await query(
      `INSERT INTO onec_v3_legal_entities (guid_client, name_client, type_category, other_fields, last_source_sha256)
       VALUES ($1::uuid, 'SYNTH', '{}'::jsonb, '{"Код":"OLD"}'::jsonb, $2)`,
      [GUID, "a".repeat(64)],
    );

    const fixture = { guid_client: GUID, name_client: "SYNTH", other: { Код: "SYNTH_FIRST" } };
    const badBytes = Buffer.from(
      JSON.stringify([
        fixture,
        { ...fixture, other: { Код: "SYNTH_CONFLICTING_DUPLICATE" } },
        { guid_client: "not-a-guid", name_client: "SYNTH_INVALID" },
      ]),
    );
    const badDry = await runLegalOtherFieldsBackfill({ clientsBytes: badBytes, argv: ["--dry-run"] });
    assert.notEqual(badDry.status, "SUCCESS");

    const goodValues = Object.fromEntries(V3_CLIENT_OTHER_INVENTORY_KEYS.map((k, i) => [k, `SYNTH_${i}`]));
    const goodBytes = Buffer.from(JSON.stringify([{ ...fixture, other: goodValues }]));
    const sha = (await import("node:crypto")).createHash("sha256").update(goodBytes).digest("hex");

    const dryHistoryMismatch = await runLegalOtherFieldsBackfill({ clientsBytes: goodBytes, argv: ["--dry-run"] });
    assert.equal(dryHistoryMismatch.status, "REJECTED_BY_CHECKS");

    await query("UPDATE onec_v3_legal_entities SET last_source_sha256 = NULL WHERE guid_client = $1::uuid", [GUID]);
    const dryNullHistory = await runLegalOtherFieldsBackfill({ clientsBytes: goodBytes, argv: ["--dry-run"] });
    assert.equal(dryNullHistory.status, "REJECTED_BY_CHECKS");

    const parsedCli = parseLegalOtherFieldsBackfillCliArgs([
      "--apply",
      "--clients-file",
      "/tmp/x.json",
      `--expected-source-sha256=${"a".repeat(64)}`,
      `--expected-plan-hash=${"b".repeat(64)}`,
      `--confirm-target-db=${"c".repeat(64)}`,
    ]);
    assert.equal(parsedCli.ok, true);

    await query("UPDATE onec_v3_legal_entities SET last_source_sha256 = $2 WHERE guid_client = $1::uuid", [GUID, sha]);
    const dryGood = await runLegalOtherFieldsBackfill({ clientsBytes: goodBytes, argv: ["--dry-run"] });
    assert.equal(dryGood.status, "SUCCESS");
    assert.equal(dryGood.plan?.updateCount, 1);

    const applyGood = await runLegalOtherFieldsBackfill({
      clientsBytes: goodBytes,
      argv: [
        "--apply",
        "--expected-source-sha256",
        sha,
        "--expected-plan-hash",
        dryGood.plan!.planHash,
        "--confirm-target-db",
        dryGood.targetDbFingerprint!,
      ],
    });
    assert.equal(applyGood.status, "SUCCESS");
    assert.equal(applyGood.applied, 1);

    const row = await query<{ other_fields: Record<string, unknown> }>(
      "SELECT other_fields FROM onec_v3_legal_entities WHERE guid_client = $1::uuid",
      [GUID],
    );
    assert.equal(Object.keys(row.rows[0].other_fields).length, V3_CLIENT_OTHER_INVENTORY_KEYS.length + 1);

    const expectedPost = row.rows[0].other_fields;
    await query(`UPDATE onec_v3_legal_entities SET other_fields = '{"Код":"SYNTH_LATER_CHANGE"}'::jsonb WHERE guid_client = $1::uuid`, [
      GUID,
    ]);
    const client = await getPool()!.connect();
    try {
      const rollback = await rollbackLegalOtherFieldsFromSnapshot(client, [
        {
          guidClient: GUID.toLowerCase(),
          previousHash: "x",
          postHash: "y",
          previousOtherFields: { Код: "OLD" },
          lastSourceSha256: sha,
          expectedPostOtherFields: expectedPost,
        },
      ]);
      assert.equal(rollback.rolledBack, 0);
      const current = await query("SELECT other_fields FROM onec_v3_legal_entities WHERE guid_client = $1::uuid", [GUID]);
      assert.equal(current.rows[0].other_fields.Код, "SYNTH_LATER_CHANGE");
    } finally {
      client.release();
    }
  });
});
