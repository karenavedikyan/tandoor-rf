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
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildNotApprovedExecutionManifestTemplate } from "../../src/onec-sales/matched-only/production/manifest-template";
import {
  withBoundApprovalHash,
  withComputedContentHash,
} from "../../src/onec-sales/matched-only/production/manifest-hash";
import { validateExecutionManifestForRun } from "../../src/onec-sales/matched-only/production/manifest-validate";
import {
  assertManifestCodeProvenance,
  resolveRuntimeCodeArtifactLabel,
} from "../../src/onec-sales/matched-only/production/runtime-provenance";
import { resolveProductionDatabaseUrl } from "../../src/onec-sales/matched-only/production/database-url";
import { parseProductionCliArgs } from "../../src/onec-sales/matched-only/production/cli-args";
import {
  runProductionPreflightHarness,
  runProductionWriteApplyHarness,
  runProductionWriteRollbackHarness,
} from "../../src/onec-sales/matched-only/production/harness";
import { buildExecutionBudgetFromPlan } from "../../src/onec-sales/matched-only/production/manifest-budget";
import { assertMatchedOnlySchemaReady } from "../../src/onec-sales/matched-only/production/schema-readiness";
import type { ExecutionManifestV2 } from "../../src/onec-sales/matched-only/production/manifest-types";

const OTHER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const scratch: string[] = [];
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
  for (const d of scratch) {
    await rm(d, { recursive: true, force: true });
  }
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
      end: () => Promise<void>;
    }>;
    if (typeof args[0] === "function") {
      return pending;
    }
    return pending.then((c) => {
      const query = c.query.bind(c);
      c.query = async (...qa: unknown[]) => {
        const out = await query(...qa);
        if (qa[0] === "COMMIT" && !injected) {
          injected = true;
          const error = new Error("Query read timeout");
          (error as { code?: string }).code = "ETIMEDOUT";
          throw error;
        }
        return out;
      };
      return c;
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
  const rows = await pool.query<{ n: string }>("SELECT COUNT(*)::text AS n FROM onec_v3_legal_sale_item_lines");
  assert.equal(rows.rows[0]?.n, "0");
});

it("physical disconnect after committed COMMIT must not mask reconciled success", { timeout: 15000 }, async () => {
  await fresh();
  const rosters = bundle();
  const p = await planned(rosters);
  const proto = Pool.prototype as unknown as {
    connect: (...args: unknown[]) => Promise<unknown> | unknown;
  };
  const original = proto.connect;
  let injected = false;
  let deadClient: { release: (error?: Error) => void; end: () => Promise<void> } | undefined;
  let deadPool: { end: () => Promise<void>; ending?: boolean } | undefined;
  proto.connect = function (...args: unknown[]) {
    const owner = this;
    const pending = original.apply(this, args) as Promise<{
      query: (...qa: unknown[]) => Promise<unknown>;
      end: () => Promise<void>;
      release: (error?: Error) => void;
    }>;
    if (typeof args[0] === "function") {
      return pending;
    }
    return pending.then((c) => {
      const query = c.query.bind(c);
      c.query = async (...qa: unknown[]) => {
        const out = await query(...qa);
        if (qa[0] === "COMMIT" && !injected) {
          injected = true;
          deadClient = c;
          deadPool = owner as { end: () => Promise<void>; ending?: boolean };
          await c.end();
          const error = new Error("Connection terminated unexpectedly after COMMIT");
          (error as { code?: string }).code = "ECONNRESET";
          throw error;
        }
        return out;
      };
      return c;
    });
  };
  let result: Awaited<ReturnType<typeof runMatchedOnlyApply>> | { rejected: boolean; message: string };
  try {
    try {
      result = await runMatchedOnlyApply(url, rosters, p.plan, p.hash, p.backup, p.sha);
    } catch (e) {
      result = { rejected: true, message: e instanceof Error ? e.message : String(e) };
    }
  } finally {
    proto.connect = original;
    try {
      deadClient?.release(new Error("QA cleanup after closed socket"));
    } catch {
      /* ignore */
    }
    if (deadPool && !deadPool.ending) {
      await deadPool.end();
    }
  }
  assert.equal(injected, true);
  const rows = await pool.query<{ n: string }>("SELECT COUNT(*)::text AS n FROM onec_v3_legal_sale_item_lines");
  assert.equal(rows.rows[0]?.n, "1");
  assert.ok(
    ("ok" in result && result.ok) || ("code" in result && result.code === "COMMIT_UNCERTAIN"),
    `closed original socket must not mask successful reconcile: ${JSON.stringify(result)}`,
  );
});

it("independent: failure before COMMIT rolls back and releases lock for retry", async () => {
  await fresh();
  const rosters = bundle();
  const p = await planned(rosters);
  const failed = await runMatchedOnlyApply(url, rosters, p.plan, p.hash, p.backup, p.sha, {
    failBeforeCommit: true,
  });
  assert.equal(failed.ok, false);
  assert.notEqual(failed.ok ? "" : failed.code, "COMMIT_UNCERTAIN");
  const rows = await pool.query<{ n: string }>("SELECT COUNT(*)::text AS n FROM onec_v3_legal_sale_item_lines");
  assert.equal(rows.rows[0]?.n, "0");
  const retry = await runMatchedOnlyApply(url, rosters, p.plan, p.hash, p.backup, p.sha);
  assert.equal(retry.ok, true);
});

it("recovery unavailable after lost COMMIT response must remain COMMIT_UNCERTAIN", { timeout: 15000 }, async () => {
  await fresh();
  const rosters = bundle();
  const p = await planned(rosters);
  const proto = Pool.prototype as unknown as {
    connect: (...args: unknown[]) => Promise<unknown> | unknown;
  };
  const original = proto.connect;
  let injected = false;
  proto.connect = function (...args: unknown[]) {
    if (injected) {
      const error = new Error("Recovery database unavailable");
      (error as { code?: string }).code = "ECONNREFUSED";
      return Promise.reject(error);
    }
    const pending = original.apply(this, args) as Promise<{
      query: (...qa: unknown[]) => Promise<unknown>;
    }>;
    if (typeof args[0] === "function") {
      return pending;
    }
    return pending.then((c) => {
      const query = c.query.bind(c);
      c.query = async (...qa: unknown[]) => {
        const out = await query(...qa);
        if (qa[0] === "COMMIT" && !injected) {
          injected = true;
          const error = new Error("Query read timeout");
          (error as { code?: string }).code = "ETIMEDOUT";
          throw error;
        }
        return out;
      };
      return c;
    });
  };
  let result: Awaited<ReturnType<typeof runMatchedOnlyApply>> | { rejected: boolean; message: string };
  try {
    try {
      result = await runMatchedOnlyApply(url, rosters, p.plan, p.hash, p.backup, p.sha);
    } catch (e) {
      result = { rejected: true, message: e instanceof Error ? e.message : String(e) };
    }
  } finally {
    proto.connect = original;
  }
  assert.equal(injected, true);
  const rows = await pool.query<{ n: string }>("SELECT COUNT(*)::text AS n FROM onec_v3_legal_sale_item_lines");
  assert.equal(rows.rows[0]?.n, "1");
  assert.equal(
    "code" in result ? result.code : "rejected",
    "COMMIT_UNCERTAIN",
    `recovery connection failure must not downgrade an unknown committed outcome: ${JSON.stringify(result)}`,
  );
});

it("uncertain COMMIT before server dispatch must retire original transaction before marker", { timeout: 15000 }, async () => {
  await fresh();
  const rosters = bundle();
  const p = await planned(rosters);
  const proto = Pool.prototype as unknown as {
    connect: (...args: unknown[]) => Promise<unknown> | unknown;
  };
  const original = proto.connect;
  let injected = false;
  let originalPid = 0;
  let markerBlockedByOriginal = false;
  proto.connect = function (...args: unknown[]) {
    const pending = original.apply(this, args) as Promise<{
      processID: number;
      query: (...qa: unknown[]) => Promise<unknown>;
    }>;
    if (typeof args[0] === "function") {
      return pending;
    }
    return pending.then((c) => {
      const query = c.query.bind(c);
      c.query = async (...qa: unknown[]) => {
        if (qa[0] === "COMMIT" && !injected) {
          injected = true;
          originalPid = c.processID;
          const error = new Error("Query read timeout before COMMIT reached server");
          (error as { code?: string }).code = "ETIMEDOUT";
          throw error;
        }
        const sql = typeof qa[0] === "string" ? qa[0] : "";
        if (
          injected &&
          sql.includes("INSERT INTO onec_v3_legal_sales_bundle_apply_runs") &&
          sql.includes("'commit_uncertain'")
        ) {
          await query("SET LOCAL lock_timeout = '600ms'");
          const work = query(...qa);
          work.catch(() => undefined);
          await new Promise((resolve) => setTimeout(resolve, 80));
          const watch = await pool.query<{ blockers: number[] }>(
            "SELECT pg_blocking_pids($1::integer) AS blockers",
            [c.processID],
          );
          markerBlockedByOriginal = watch.rows[0]?.blockers.includes(originalPid) ?? false;
          return await work;
        }
        return query(...qa);
      };
      return c;
    });
  };
  let result: Awaited<ReturnType<typeof runMatchedOnlyApply>>;
  try {
    result = await runMatchedOnlyApply(url, rosters, p.plan, p.hash, p.backup, p.sha);
  } finally {
    proto.connect = original;
  }
  assert.equal(injected, true);
  assert.equal(result.ok ? "" : result.code, "COMMIT_UNCERTAIN");
  const rows = await pool.query<{ n: string }>("SELECT COUNT(*)::text AS n FROM onec_v3_legal_sale_item_lines");
  assert.equal(rows.rows[0]?.n, "0");
  assert.equal(
    markerBlockedByOriginal,
    false,
    "recovery marker is blocked by the still-open original transaction; no production lock_timeout is pinned",
  );
});

async function productionFixture(operation: "apply" | "rollback" = "apply") {
  await fresh();
  const rosters = bundle();
  const p = await planned(rosters);
  const d = await mkdtemp(join(tmpdir(), "tandoor-pr105-synthetic-"));
  scratch.push(d);
  const sourcePaths = {
    saleAggregate: join(d, "sale.json"),
    saleItems: join(d, "sale(items).json"),
    returnsAggregate: join(d, "returne.json"),
    returnItems: join(d, "returne(items).json"),
  };
  const records = [
    [
      buildSaleRecord({ legalGuid: LEGAL_A, type: "Входные двери", income: 100 }),
      buildSaleRecord({ legalGuid: OTHER, type: "Входные двери", income: 20 }),
    ],
    [
      buildSaleItemRecord({ legalGuid: LEGAL_A, income: 100 }),
      buildSaleItemRecord({ legalGuid: OTHER, income: 20 }),
    ],
    [
      buildReturnRecord({ legalGuid: LEGAL_B, income: -10 }),
      buildReturnRecord({ legalGuid: OTHER, income: -5 }),
    ],
    [
      buildReturnRecord({ legalGuid: LEGAL_B, income: -10, withItems: true }),
      buildReturnRecord({ legalGuid: OTHER, income: -5, withItems: true }),
    ],
  ];
  await Promise.all(
    Object.values(sourcePaths).map((path, i) =>
      writeFile(path, buildSaleJsonBytes(records[i]), { mode: 0o600 }),
    ),
  );
  const backupPath = join(d, "synthetic-backup.json");
  await writeFile(backupPath, JSON.stringify(p.backup), { mode: 0o600 });
  const executionBudget = buildExecutionBudgetFromPlan(p.plan, "-10.000000");
  const manifest = withBoundApprovalHash({
    ...buildNotApprovedExecutionManifestTemplate(operation),
    executionId: "synthetic-only-execution",
    approval: {
      status: "APPROVED",
      approvedExecutionHash: "",
      humanDecisionRef: "synthetic-test-not-human-consent",
      validUntil: new Date(Date.now() + 3_600_000).toISOString(),
    },
    provenance: { codeArtifactLabel: "synthetic-build", observedRuntimeFingerprint: null },
    executionBudget,
    plan: p.plan,
    planHash: p.hash,
    sourcePaths,
    backup: { filePath: backupPath, expectedSha256: p.sha },
  });
  return { rosters, p, manifest, scratchDir: d };
}

function validateApproved(manifest: ExecutionManifestV2) {
  return validateExecutionManifestForRun({
    manifest,
    operation: manifest.operation,
    requireApproved: true,
    approvedExecutionHash: manifest.approval.approvedExecutionHash!,
  });
}

async function productionEnv<T>(work: () => Promise<T>): Promise<T> {
  const keys = ["DATABASE_URL", "TEST_DATABASE_URL", "MATCHED_ONLY_CODE_ARTIFACT_LABEL"] as const;
  const old = keys.map((k) => process.env[k]);
  process.env.DATABASE_URL = url;
  delete process.env.TEST_DATABASE_URL;
  process.env.MATCHED_ONLY_CODE_ARTIFACT_LABEL = "synthetic-build";
  try {
    return await work();
  } finally {
    keys.forEach((k, i) => {
      if (old[i] === undefined) delete process.env[k];
      else process.env[k] = old[i];
    });
  }
}

async function preflightFixture(f: Awaited<ReturnType<typeof productionFixture>>) {
  return productionEnv(() =>
    runProductionPreflightHarness({
      manifest: f.manifest,
      operation: f.manifest.operation,
      writeMode: true,
      approvedExecutionHash: f.manifest.approval.approvedExecutionHash!,
      targetFingerprintPolicy: f.p.plan.identity.targetDbFingerprint,
    }),
  );
}

it("production: approved execution hash binds exact manifest body", async () => {
  const f = await productionFixture();
  assert.equal(validateApproved(f.manifest).ok, true);
  const changed = withComputedContentHash({
    ...f.manifest,
    executionId: "different-operation",
    sourcePaths: { ...f.manifest.sourcePaths, saleAggregate: "/different/private/source.json" },
  });
  const result = validateApproved(changed);
  assert.equal(result.ok, false, "old approval hash must not authorize a recomputed, changed body");
});

it("production: missing expiry, invalid expiry, and missing human reference fail closed", async () => {
  const f = await productionFixture();
  const outcomes = [
    { validUntil: null },
    { validUntil: "not-a-date" },
    { humanDecisionRef: null },
  ].map(
    (patch) =>
      validateApproved(
        withBoundApprovalHash({
          ...f.manifest,
          approval: { ...f.manifest.approval, ...patch },
        }),
      ).ok,
  );
  assert.deepEqual(outcomes, [false, false, false]);
});

it("production: unpinned code plus arbitrary environment label is not verified provenance", () => {
  const old = process.env.MATCHED_ONLY_CODE_ARTIFACT_LABEL;
  process.env.MATCHED_ONLY_CODE_ARTIFACT_LABEL = "operator-typed-not-a-build-proof";
  try {
    const result = assertManifestCodeProvenance(null, resolveRuntimeCodeArtifactLabel(), true);
    assert.equal(result.ok, false, "missing manifest provenance cannot be satisfied by arbitrary environment text");
  } finally {
    if (old === undefined) delete process.env.MATCHED_ONLY_CODE_ARTIFACT_LABEL;
    else process.env.MATCHED_ONLY_CODE_ARTIFACT_LABEL = old;
  }
});

it("production: mixed DATABASE_URL and a different TEST_DATABASE_URL is rejected", () => {
  const oldDb = process.env.DATABASE_URL;
  const oldTest = process.env.TEST_DATABASE_URL;
  process.env.DATABASE_URL = url;
  process.env.TEST_DATABASE_URL = `${url}_different`;
  try {
    assert.equal(resolveProductionDatabaseUrl().ok, false);
  } finally {
    if (oldDb === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = oldDb;
    if (oldTest === undefined) delete process.env.TEST_DATABASE_URL;
    else process.env.TEST_DATABASE_URL = oldTest;
  }
});

it("production: conflicting write apply and write rollback CLI flags are rejected", () => {
  const result = parseProductionCliArgs([
    "--write-apply",
    "--write-rollback",
    "--manifest-file",
    "/fake/manifest.json",
    "--approved-execution-hash",
    "a".repeat(64),
  ]);
  assert.equal(result.ok, false);
});

it("production: repeated approved apply reaches no-op rather than before-state drift", async () => {
  const f = await productionFixture();
  const before = await preflightFixture(f);
  assert.equal(before.ok, true, JSON.stringify(before));
  const applied = await runMatchedOnlyApply(url, f.rosters, f.p.plan, f.p.hash, f.p.backup, f.p.sha);
  assert.equal(applied.ok, true);
  const after = await preflightFixture(f);
  assert.equal(after.ok, true, `preflight should recognize same-plan applied state: ${JSON.stringify(after)}`);
  if (after.ok) {
    assert.equal(after.phase, "already_applied");
  }
});

it("production: approved rollback checks applied after-state, not original before-state", async () => {
  const f = await productionFixture("rollback");
  const applied = await runMatchedOnlyApply(url, f.rosters, f.p.plan, f.p.hash, f.p.backup, f.p.sha);
  assert.equal(applied.ok, true);
  if (!applied.ok) return;
  f.manifest = withBoundApprovalHash({
    ...f.manifest,
    rollback: {
      originalApplyPlanHash: f.p.hash,
      expectedLiveAfterStateSha256: applied.receipt!.afterStateSha256,
      rollbackScopeHash: f.p.plan.scope.operationsDigest,
    },
  });
  const proof = await preflightFixture(f);
  assert.equal(proof.ok, true, `rollback must be able to reach after-state validation: ${JSON.stringify(proof)}`);
  if (proof.ok) {
    assert.equal(proof.phase, "rollback_ready");
  }
});

it("production: receipt matched total cannot be zero after four matched rows were stored", async () => {
  const f = await productionFixture();
  const result = await runMatchedOnlyApply(url, f.rosters, f.p.plan, f.p.hash, f.p.backup, f.p.sha);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const inserted = result.receipt!.inserted;
  const actual =
    inserted.saleAggregate + inserted.saleItems + inserted.returnsAggregate + inserted.returnItems;
  assert.equal(actual, 4);
  assert.equal(inserted.matched, actual, "receipt reports zero matched despite four successful insertions");
});

it("production: silently missing expected DML row rolls back rather than committing a new hash", async () => {
  const f = await productionFixture();
  await pool.query(
    "CREATE FUNCTION qa_skip_return_item() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NULL; END $$",
  );
  await pool.query(
    "CREATE TRIGGER qa_skip_return_item BEFORE INSERT ON onec_v3_legal_return_item_lines FOR EACH ROW EXECUTE FUNCTION qa_skip_return_item()",
  );
  const result = await runMatchedOnlyApply(url, f.rosters, f.p.plan, f.p.hash, f.p.backup, f.p.sha);
  const count = await pool.query<{ n: string }>(
    "SELECT COUNT(*)::text AS n FROM onec_v3_legal_return_item_lines",
  );
  assert.equal(count.rows[0]?.n, "0");
  assert.equal(
    result.ok,
    false,
    "missing planned persisted row must reject and rollback, not accept arbitrary after-state",
  );
});

it("production: changed persisted money with unchanged row count must roll back", async () => {
  const f = await productionFixture();
  await pool.query(
    "CREATE FUNCTION qa_change_return_income() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.income := NEW.income + 1; RETURN NEW; END $$",
  );
  await pool.query(
    "CREATE TRIGGER qa_change_return_income BEFORE INSERT ON onec_v3_legal_return_item_lines FOR EACH ROW EXECUTE FUNCTION qa_change_return_income()",
  );
  const result = await runMatchedOnlyApply(url, f.rosters, f.p.plan, f.p.hash, f.p.backup, f.p.sha);
  assert.equal(result.ok, false, "expected source-derived monetary totals must be checked before COMMIT");
  const count = await pool.query<{ n: string }>(
    "SELECT COUNT(*)::text AS n FROM onec_v3_legal_return_item_lines",
  );
  assert.equal(count.rows[0]?.n, "0", "monetary mismatch must rollback every write");
});

it("production: schema readiness verifies columns, not only table names", async () => {
  await fresh();
  await pool.query("DROP TABLE onec_v3_legal_sales_import_quarantine_rows");
  await pool.query("CREATE TABLE onec_v3_legal_sales_import_quarantine_rows (wrong_column integer)");
  const c = await pool.connect();
  try {
    assert.equal((await assertMatchedOnlySchemaReady(c)).ok, false);
  } finally {
    c.release();
  }
});

it("production harness: fresh apply → no-op → rollback on local PG", async () => {
  const f = await productionFixture("apply");
  const policy = f.p.plan.identity.targetDbFingerprint;
  const hash = f.manifest.approval.approvedExecutionHash!;
  const freshPreflight = await preflightFixture(f);
  assert.equal(freshPreflight.ok, true, JSON.stringify(freshPreflight));
  if (freshPreflight.ok) {
    assert.equal(freshPreflight.phase, "fresh_apply");
  }
  const applied = await productionEnv(() =>
    runProductionWriteApplyHarness({ manifest: f.manifest, approvedExecutionHash: hash, targetFingerprintPolicy: policy }),
  );
  assert.equal(applied.ok, true, JSON.stringify(applied));
  const noopPreflight = await preflightFixture(f);
  assert.equal(noopPreflight.ok, true, JSON.stringify(noopPreflight));
  if (noopPreflight.ok) {
    assert.equal(noopPreflight.phase, "already_applied");
  }
  const rollbackManifest = withBoundApprovalHash({
    ...f.manifest,
    operation: "rollback",
    rollback: {
      originalApplyPlanHash: f.p.hash,
      expectedLiveAfterStateSha256: (applied as { receipt?: { afterStateSha256?: string } }).receipt
        ?.afterStateSha256 ?? null,
      rollbackScopeHash: f.p.plan.scope.operationsDigest,
    },
  });
  const rolled = await productionEnv(() =>
    runProductionWriteRollbackHarness({
      manifest: rollbackManifest,
      approvedExecutionHash: rollbackManifest.approval.approvedExecutionHash!,
      targetFingerprintPolicy: policy,
    }),
  );
  assert.equal(rolled.ok, true, JSON.stringify(rolled));
  const rows = await pool.query<{ n: string }>(
    "SELECT COUNT(*)::text AS n FROM onec_v3_legal_sale_item_lines",
  );
  assert.equal(rows.rows[0]?.n, "0");
});
