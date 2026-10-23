import assert from "node:assert/strict";
import { after, before, it } from "node:test";
import { Pool } from "pg";
import { resetPoolForTests, closePool } from "../../src/db/pool";
import { getIntegrationDatabaseUrl, prepareDatabase, setIntegrationEnv } from "../helpers/test-db";
import { LEGAL_A, LEGAL_B, buildSaleJsonBytes, buildSaleRecord } from "../helpers/legal-sales-fixtures";
import { buildSaleItemRecord, buildReturnRecord } from "../helpers/sales-bundle-fixtures";
import { parseLegalSalesJsonBytes } from "../../src/onec-sales/parse-sale-json";
import { parseLegalSaleItemsJsonBytes } from "../../src/onec-sales/parse-sale-items-json";
import { parseLegalReturnsJsonBytes } from "../../src/onec-sales/parse-returne-json";
import { parseLegalReturnItemsJsonBytes } from "../../src/onec-sales/parse-returne-items-json";
import {
  runMatchedOnlyBundlePlan,
  captureMatchedOnlyBackupForPlan,
  runMatchedOnlyApply,
  runMatchedOnlyRollback,
} from "../../src/onec-sales/matched-only/run";
import { backupSha256 } from "../../src/onec-sales/matched-only/backup";
import { planHashFromPlan } from "../../src/onec-sales/matched-only/plan-build";
import { captureScopedBeforeState } from "../../src/onec-sales/matched-only/state-digest";
import { computeOperationsDigest } from "../../src/onec-sales/matched-only/scope";

const OTHER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
let url: string;
let pool: Pool;

before(async () => {
  url = getIntegrationDatabaseUrl();
  setIntegrationEnv(url);
  await resetPoolForTests();
  await prepareDatabase(url);
  pool = new Pool({ connectionString: url });
  await seed();
});

async function seed() {
  await pool.query(
    `INSERT INTO onec_v3_legal_entities (guid_client,name_client,type_category,other_fields,last_source_sha256)
     VALUES ($1::uuid,'A','{}'::jsonb,'{}'::jsonb,'test'),($2::uuid,'B','{}'::jsonb,'{}'::jsonb,'test')`,
    [LEGAL_A, LEGAL_B],
  );
}

after(async () => {
  await pool?.end();
  await closePool();
});

function parse<T>(fn: (b: Buffer) => { ok: boolean; roster?: T }, rows: unknown[]): T {
  const r = fn(buildSaleJsonBytes(rows));
  assert.equal(r.ok, true);
  return r.roster!;
}

function bundle(income = 100) {
  return {
    saleAggregate: parse(parseLegalSalesJsonBytes, [
      buildSaleRecord({ legalGuid: LEGAL_A, type: "Входные двери", income }),
      buildSaleRecord({ legalGuid: OTHER, type: "Входные двери", income: 20 }),
    ]),
    saleItems: parse(parseLegalSaleItemsJsonBytes, [
      buildSaleItemRecord({ legalGuid: LEGAL_A, income }),
      buildSaleItemRecord({ legalGuid: OTHER, income: 20 }),
    ]),
    returnsAggregate: parse(parseLegalReturnsJsonBytes, [
      buildReturnRecord({ legalGuid: LEGAL_B, income: -10 }),
      buildReturnRecord({ legalGuid: OTHER, income: -5 }),
    ]),
    returnItems: parse(parseLegalReturnItemsJsonBytes, [
      buildReturnRecord({ legalGuid: LEGAL_B, income: -10, withItems: true }),
      buildReturnRecord({ legalGuid: OTHER, income: -5, withItems: true }),
    ]),
  };
}

async function fresh() {
  await pool.end();
  await closePool();
  await resetPoolForTests();
  await prepareDatabase(url);
  pool = new Pool({ connectionString: url });
  await seed();
}

async function planned(rosters: ReturnType<typeof bundle>) {
  const p = await runMatchedOnlyBundlePlan(url, rosters);
  assert.equal(p.ok, true);
  if (!p.ok || !p.plan) throw new Error("PLAN_FAILED");
  const plan = p.plan;
  const backup = await captureMatchedOnlyBackupForPlan(url, plan);
  return { plan, backup, hash: planHashFromPlan(plan), sha: backupSha256(backup) };
}

it("independent: reapply same approved plan is no-op with unchanged rows", async () => {
  const rosters = bundle();
  const p = await runMatchedOnlyBundlePlan(url, rosters);
  assert.equal(p.ok, true);
  if (!p.ok || !p.plan) return;
  const backup = await captureMatchedOnlyBackupForPlan(url, p.plan);
  const hash = planHashFromPlan(p.plan);
  const sha = backupSha256(backup);
  const first = await runMatchedOnlyApply(url, rosters, p.plan, hash, backup, sha);
  assert.equal(first.ok, true);
  const second = await runMatchedOnlyApply(url, rosters, p.plan, hash, backup, sha);
  assert.deepEqual(second.ok ? { ok: true } : { ok: false, code: second.code }, { ok: true });
});

it("replacement A->B then rollback B restores nonempty previous state", async () => {
  await fresh();
  const a = bundle(100);
  const pa = await planned(a);
  assert.equal((await runMatchedOnlyApply(url, a, pa.plan, pa.hash, pa.backup, pa.sha)).ok, true);
  const b = bundle(150);
  const pb = await planned(b);
  const fromFile = JSON.parse(JSON.stringify(pb.backup)) as typeof pb.backup;
  assert.equal(backupSha256(fromFile), pb.sha, "nonempty backup must survive JSON roundtrip");
  assert.equal((await runMatchedOnlyApply(url, b, pb.plan, pb.hash, fromFile, pb.sha)).ok, true);
  const rollback = await runMatchedOnlyRollback(url, pb.plan, pb.hash, fromFile, pb.sha);
  assert.deepEqual(rollback.ok ? { ok: true } : { ok: false, code: rollback.code }, { ok: true });
});

it("scope: approved August scope cannot write September source rows", async () => {
  await fresh();
  const rosters = bundle();
  const p = await planned(rosters);
  p.plan.scope.saleMonthsIso = ["2026-08-01"];
  p.plan.scope.operationsDigest = computeOperationsDigest(p.plan.sourceHashes, p.plan.scope.saleMonthsIso);
  const c = await pool.connect();
  try {
    p.plan.beforeStateSha256 = (
      await captureScopedBeforeState(c, p.plan.scope.saleMonthsIso)
    ).businessDigest;
  } finally {
    c.release();
  }
  const backup = await captureMatchedOnlyBackupForPlan(url, p.plan);
  const applied = await runMatchedOnlyApply(
    url,
    rosters,
    p.plan,
    planHashFromPlan(p.plan),
    backup,
    backupSha256(backup),
  );
  const rows = await pool.query<{ sale_month: string }>("SELECT sale_month::text FROM onec_v3_legal_sale_item_lines");
  assert.deepEqual(
    { ok: applied.ok, writtenMonths: rows.rows.map((r) => r.sale_month) },
    { ok: false, writtenMonths: [] },
    "actual source month must be checked against approved operation scope",
  );
  if (!applied.ok) {
    assert.equal(applied.code, "PLAN_SCOPE_MISMATCH");
  }
});

it("COMMIT: real query transport error must be explicit uncertain or reconciled, not ordinary failure", async () => {
  await fresh();
  const rosters = bundle();
  const p = await planned(rosters);
  const proto = Pool.prototype as unknown as {
    connect: (...args: unknown[]) => Promise<unknown> | unknown;
  };
  const original = proto.connect;
  let injected = false;
  proto.connect = function (...args: unknown[]) {
    const pending = original.apply(this, args) as Promise<{
      query: (...qa: unknown[]) => Promise<unknown>;
    }>;
    if (typeof args[0] === "function") {
      return pending;
    }
    return pending.then((client) => {
      const query = client.query.bind(client);
      client.query = async (...qa: unknown[]) => {
        const out = await query(...qa);
        if (qa[0] === "COMMIT" && !injected) {
          injected = true;
          const error = new Error("Query read timeout");
          (error as { code?: string }).code = "ETIMEDOUT";
          throw error;
        }
        return out;
      };
      return client;
    });
  };
  let result: Awaited<ReturnType<typeof runMatchedOnlyApply>>;
  try {
    result = await runMatchedOnlyApply(url, rosters, p.plan, p.hash, p.backup, p.sha);
  } finally {
    proto.connect = original;
  }
  assert.equal(injected, true);
  const rows = await pool.query<{ n: string }>("SELECT COUNT(*)::text AS n FROM onec_v3_legal_sale_item_lines");
  assert.equal(rows.rows[0]?.n, "1", "server committed before simulated response loss");
  assert.ok(
    result.ok || result.code === "COMMIT_UNCERTAIN",
    `committed outcome cannot be returned as generic failure: ${JSON.stringify(result)}`,
  );
});

it("independent: rollback restores absent import-state rows", async () => {
  await fresh();
  const rosters = bundle();
  const p = await runMatchedOnlyBundlePlan(url, rosters);
  assert.equal(p.ok, true);
  if (!p.ok || !p.plan) return;
  const backup = await captureMatchedOnlyBackupForPlan(url, p.plan);
  const hash = planHashFromPlan(p.plan);
  const sha = backupSha256(backup);
  assert.equal(backup.tables.importStates.length, 0);
  const first = await runMatchedOnlyApply(url, rosters, p.plan, hash, backup, sha);
  assert.equal(first.ok, true);
  const rolled = await runMatchedOnlyRollback(url, p.plan, hash, backup, sha);
  assert.equal(rolled.ok, true);
  for (const t of [
    "onec_v3_legal_sales_import_state",
    "onec_v3_legal_sale_item_import_state",
    "onec_v3_legal_return_import_state",
    "onec_v3_legal_return_item_import_state",
  ]) {
    const count = await pool.query<{ n: string }>(`SELECT COUNT(*)::text AS n FROM ${t} WHERE id=1`);
    assert.equal(count.rows[0]?.n, "0", `rollback left ${t}.id=1`);
  }
});

it("independent: target identity drift must fail before any write", async () => {
  await fresh();
  const rosters = bundle();
  const p = await runMatchedOnlyBundlePlan(url, rosters);
  assert.equal(p.ok, true);
  if (!p.ok || !p.plan) return;
  p.plan.identity.targetDbFingerprint = "0".repeat(64);
  const forgedHash = planHashFromPlan(p.plan);
  const backup = await captureMatchedOnlyBackupForPlan(url, p.plan);
  const applied = await runMatchedOnlyApply(url, rosters, p.plan, forgedHash, backup, backupSha256(backup));
  assert.equal(applied.ok, false, "different DB identity embedded in plan must not be accepted");
  if (applied.ok) return;
  assert.equal(applied.code, "TARGET_IDENTITY_MISMATCH");
  const rows = await pool.query<{ n: string }>("SELECT COUNT(*)::text AS n FROM onec_v3_legal_sale_item_lines");
  assert.equal(rows.rows[0]?.n, "0");
});
