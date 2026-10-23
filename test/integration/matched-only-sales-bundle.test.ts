import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { Pool } from "pg";
import { closePool, resetPoolForTests } from "../../src/db/pool";
import type { AccessContext } from "../../src/access/types";
import { loadSalesSectionOverview } from "../../src/clients/v3/sales-section";
import { getIntegrationDatabaseUrl, prepareDatabase, setIntegrationEnv } from "../helpers/test-db";
import { LEGAL_A, LEGAL_B, buildSaleJsonBytes, buildSaleRecord } from "../helpers/legal-sales-fixtures";
import { buildReturnRecord, buildSaleItemRecord } from "../helpers/sales-bundle-fixtures";
import { parseLegalSalesJsonBytes } from "../../src/onec-sales/parse-sale-json";
import { parseLegalSaleItemsJsonBytes } from "../../src/onec-sales/parse-sale-items-json";
import { parseLegalReturnsJsonBytes } from "../../src/onec-sales/parse-returne-json";
import { parseLegalReturnItemsJsonBytes } from "../../src/onec-sales/parse-returne-items-json";
import { backupSha256 } from "../../src/onec-sales/matched-only/backup";
import { planHashFromPlan } from "../../src/onec-sales/matched-only/plan-build";
import {
  captureMatchedOnlyBackupForPlan,
  runMatchedOnlyApply,
  runMatchedOnlyBundlePlan,
  runMatchedOnlyRollback,
} from "../../src/onec-sales/matched-only/run";
import { tryAcquireImportLock, releaseImportLock } from "../../src/onec-clients/import-lock";

const UNKNOWN_LEGAL = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function adminContext(): AccessContext {
  return {
    userId: "00000000-0000-4000-8000-000000000001",
    role: "admin",
    status: "active",
    employeeId: null,
    employeeLinkConflict: false,
    hasEmployeeLink: false,
    hasScopedClientAccess: false,
    fullClientBase: true,
    explicitlyDeniedAll: false,
  };
}

function buildKnownUnknownBundle() {
  const aggregate = buildSaleJsonBytes([
    buildSaleRecord({ legalGuid: LEGAL_A, type: "Входные двери", quantity: 1, income: 100 }),
    buildSaleRecord({ legalGuid: UNKNOWN_LEGAL, type: "Входные двери", quantity: 1, income: 50 }),
  ]);
  const items = buildSaleJsonBytes([
    buildSaleItemRecord({ legalGuid: LEGAL_A, quantity: 1, income: 100 }),
    buildSaleItemRecord({ legalGuid: UNKNOWN_LEGAL, quantity: 1, income: 50 }),
  ]);
  const returnsAggregate = Buffer.from(
    JSON.stringify([
      buildReturnRecord({ legalGuid: LEGAL_B, quantity: -1, income: -10 }),
      buildReturnRecord({ legalGuid: UNKNOWN_LEGAL, quantity: -1, income: -5 }),
    ]),
  );
  const returnItems = Buffer.from(
    JSON.stringify([
      buildReturnRecord({ legalGuid: LEGAL_B, withItems: true, quantity: -1, income: -10 }),
      buildReturnRecord({ legalGuid: UNKNOWN_LEGAL, withItems: true, quantity: -1, income: -5 }),
    ]),
  );
  return { aggregate, items, returns: returnsAggregate, returnItems };
}

describe("matched-only sales bundle import", { concurrency: false }, () => {
  let pool: Pool;
  let dbUrl: string;

  before(async () => {
    dbUrl = getIntegrationDatabaseUrl();
    setIntegrationEnv(dbUrl, "http://127.0.0.1:0");
    await resetPoolForTests();
    await prepareDatabase(dbUrl);
    pool = new Pool({ connectionString: dbUrl });
    const client = await pool.connect();
    try {
      await client.query(
        `INSERT INTO onec_v3_legal_entities (guid_client, name_client, type_category, other_fields, last_source_sha256)
         VALUES ($1::uuid, 'Legal A', '{}'::jsonb, '{}'::jsonb, 'test'),
                ($2::uuid, 'Legal B', '{}'::jsonb, '{}'::jsonb, 'test')
         ON CONFLICT (guid_client) DO NOTHING`,
        [LEGAL_A, LEGAL_B],
      );
    } finally {
      client.release();
    }
  });

  after(async () => {
    await pool?.end();
    await closePool();
  });

  async function parseBundle(files: ReturnType<typeof buildKnownUnknownBundle>) {
    const saleAggregate = parseLegalSalesJsonBytes(files.aggregate);
    const saleItems = parseLegalSaleItemsJsonBytes(files.items);
    const returnsAggregate = parseLegalReturnsJsonBytes(files.returns);
    const returnItems = parseLegalReturnItemsJsonBytes(files.returnItems);
    if (!saleAggregate.ok) throw new Error(saleAggregate.message);
    if (!saleItems.ok) throw new Error(saleItems.message);
    if (!returnsAggregate.ok) throw new Error(returnsAggregate.message);
    if (!returnItems.ok) throw new Error(returnItems.message);
    return {
      saleAggregate: saleAggregate.roster,
      saleItems: saleItems.roster,
      returnsAggregate: returnsAggregate.roster,
      returnItems: returnItems.roster,
    };
  }

  it("stores only matched rows and quarantines unknown separately with honest partial coverage", async () => {
    const files = buildKnownUnknownBundle();
    const rosters = await parseBundle(files);
    const planned = await runMatchedOnlyBundlePlan(dbUrl, rosters);
    assert.equal(planned.ok, true);
    if (!planned.ok || !planned.plan) return;
    const planHash = planHashFromPlan(planned.plan);
    assert.equal(planned.plan.counts.saleItems.excluded, 1);
    assert.equal(planned.plan.counts.saleItems.matched, 1);

    const backup = await captureMatchedOnlyBackupForPlan(dbUrl, planned.plan);
    const backupSha = backupSha256(backup);
    const applied = await runMatchedOnlyApply(
      dbUrl,
      rosters,
      planned.plan,
      planHash,
      backup,
      backupSha,
    );
    assert.equal(applied.ok, true);

    const unknownInLines = await pool.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM onec_v3_legal_sale_item_lines WHERE lower(legal_guid::text) = $1`,
      [UNKNOWN_LEGAL.toLowerCase()],
    );
    assert.equal(unknownInLines.rows[0]?.n, "0");

    const quarantine = await pool.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM onec_v3_legal_sales_import_quarantine_rows WHERE plan_hash = $1`,
      [planHash],
    );
    assert.ok(Number(quarantine.rows[0]?.n ?? 0) >= 4);

    const overview = await loadSalesSectionOverview(adminContext(), "2026-09", {});
    assert.notEqual(overview, "invalid_month");
    if (overview === "invalid_month") return;
    assert.equal(overview.dataState, "partial");
    assert.ok((overview.importMeta.globalQuarantinedItemRows ?? 0) >= 1);
  });

  it("rejects apply when plan hash or backup proof is wrong (0 writes)", async () => {
    const files = buildKnownUnknownBundle();
    const rosters = await parseBundle(files);
    const planned = await runMatchedOnlyBundlePlan(dbUrl, rosters);
    assert.equal(planned.ok, true);
    if (!planned.ok || !planned.plan) return;
    const planHash = planHashFromPlan(planned.plan);
    const backup = await captureMatchedOnlyBackupForPlan(dbUrl, planned.plan);
    const beforeLines = await pool.query(`SELECT COUNT(*)::text AS n FROM onec_v3_legal_sale_item_lines`);

    const badHash = await runMatchedOnlyApply(
      dbUrl,
      rosters,
      planned.plan,
      "00".repeat(32),
      backup,
      backupSha256(backup),
    );
    assert.equal(badHash.ok, false);

    const badBackup = await runMatchedOnlyApply(
      dbUrl,
      rosters,
      planned.plan,
      planHash,
      backup,
      "11".repeat(32),
    );
    assert.equal(badBackup.ok, false);

    const afterLines = await pool.query(`SELECT COUNT(*)::text AS n FROM onec_v3_legal_sale_item_lines`);
    assert.equal(beforeLines.rows[0]?.n, afterLines.rows[0]?.n);
  });

  it("rolls back full apply and restores prior month rows", async () => {
    const month = "2026-11-01T00:00:00";
    const aggregate = buildSaleJsonBytes([
      buildSaleRecord({ legalGuid: LEGAL_A, type: "Входные двери", month, quantity: 1, income: 10 }),
    ]);
    const items = buildSaleJsonBytes([
      buildSaleItemRecord({ legalGuid: LEGAL_A, month, quantity: 1, income: 10 }),
    ]);
    const returnsAggregate = Buffer.from(
      JSON.stringify([
        buildReturnRecord({ legalGuid: LEGAL_B, month, quantity: -1, income: -1 }),
      ]),
    );
    const returnItems = Buffer.from(
      JSON.stringify([
        buildReturnRecord({ legalGuid: LEGAL_B, month, withItems: true, quantity: -1, income: -1 }),
      ]),
    );
    const files = { aggregate, items, returns: returnsAggregate, returnItems };
    const rosters = await parseBundle(files);
    const planned = await runMatchedOnlyBundlePlan(dbUrl, rosters);
    if (!planned.ok || !planned.plan) return;
    const planHash = planHashFromPlan(planned.plan);
    const backup = await captureMatchedOnlyBackupForPlan(dbUrl, planned.plan);
    const backupSha = backupSha256(backup);
    const applied = await runMatchedOnlyApply(dbUrl, rosters, planned.plan, planHash, backup, backupSha);
    assert.equal(applied.ok, true);

    const rolled = await runMatchedOnlyRollback(dbUrl, planned.plan, planHash, backup);
    assert.equal(rolled.ok, true);

    const lines = await pool.query(
      `SELECT COUNT(*)::text AS n FROM onec_v3_legal_sale_item_lines WHERE sale_month = $1::date`,
      ["2026-11-01"],
    );
    assert.equal(lines.rows[0]?.n, "0");
  });

  it("busy import lock blocks apply with 0 writes", async () => {
    const files = buildKnownUnknownBundle();
    const rosters = await parseBundle(files);
    const planned = await runMatchedOnlyBundlePlan(dbUrl, rosters);
    if (!planned.ok || !planned.plan) return;
    const planHash = planHashFromPlan(planned.plan);
    const backup = await captureMatchedOnlyBackupForPlan(dbUrl, planned.plan);
    const backupSha = backupSha256(backup);

    const client = await pool.connect();
    try {
      const locked = await tryAcquireImportLock(client);
      assert.equal(locked, true);
      const before = await pool.query(`SELECT COUNT(*)::text AS n FROM onec_v3_legal_sale_item_lines`);
      const blocked = await runMatchedOnlyApply(dbUrl, rosters, planned.plan, planHash, backup, backupSha);
      assert.equal(blocked.ok, false);
      if (blocked.ok) return;
      assert.equal(blocked.code, "IMPORT_LOCK_BUSY");
      const after = await pool.query(`SELECT COUNT(*)::text AS n FROM onec_v3_legal_sale_item_lines`);
      assert.equal(before.rows[0]?.n, after.rows[0]?.n);
    } finally {
      await releaseImportLock(client);
      client.release();
    }
  });
});
