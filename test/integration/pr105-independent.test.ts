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
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildNotApprovedExecutionManifestTemplate } from "../../src/onec-sales/matched-only/production/manifest-template";
import {
  withBoundApprovalHash,
  withBoundCaptureHash,
  withComputedContentHash,
} from "../../src/onec-sales/matched-only/production/manifest-hash";
import { validateExecutionManifestForRun } from "../../src/onec-sales/matched-only/production/manifest-validate";
import {
  assertManifestCodeProvenance,
} from "../../src/onec-sales/matched-only/production/runtime-provenance";
import { resolveProductionDatabaseUrl } from "../../src/onec-sales/matched-only/production/database-url";
import { parseProductionCliArgs } from "../../src/onec-sales/matched-only/production/cli-args";
import {
  runProductionPreflightHarness,
  runProductionWriteApplyHarness,
  runProductionWriteRollbackHarness,
} from "../../src/onec-sales/matched-only/production/harness";
import { buildExecutionBudgetFromRosters } from "../../src/onec-sales/matched-only/production/manifest-budget";
import { SYNTHETIC_TEST_EXECUTABLE_ARTIFACT_SHA256 } from "../../src/onec-sales/matched-only/production/target-policy";
import { capturePrivateBusinessBackupForManifest } from "../../src/onec-sales/matched-only/production/private-backup-capture";
import { withReadOnlyPreflightSession } from "../../src/onec-sales/matched-only/production/read-only-session";
import {
  issueProductionExecutionCapability,
  issueTestExecutionCapability,
} from "../../src/onec-sales/matched-only/execution-capability";
import { executeMatchedOnlyApply } from "../../src/onec-sales/matched-only/apply-pipeline";
import { assertMatchedOnlySchemaReady } from "../../src/onec-sales/matched-only/production/schema-readiness";
import type { ExecutionManifestV2 } from "../../src/onec-sales/matched-only/production/manifest-types";
import { validatePrivateCaptureManifestForRun } from "../../src/onec-sales/matched-only/production/manifest-capture-validate";
import { validateExecutionBudgetAgainstSource } from "../../src/onec-sales/matched-only/production/manifest-budget";
import { createHash } from "node:crypto";

const SYNTHETIC_EXECUTABLE_FIXTURE = join(
  process.cwd(),
  "test/fixtures/matched-only-synthetic-executable-artifact.bin",
);

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
  const known = new Set([LEGAL_A, LEGAL_B].map((g) => g.toLowerCase()));
  const executionBudget = buildExecutionBudgetFromRosters(p.plan, rosters, known);
  const manifest = withBoundApprovalHash({
    ...buildNotApprovedExecutionManifestTemplate(operation),
    executionId: "synthetic-only-execution",
    approval: {
      status: "APPROVED",
      approvedExecutionHash: "",
      humanDecisionRef: "synthetic-test-not-human-consent",
      validUntil: new Date(Date.now() + 3_600_000).toISOString(),
    },
    provenance: {
      codeArtifactLabel: "synthetic-build",
      expectedExecutableArtifactSha256: SYNTHETIC_TEST_EXECUTABLE_ARTIFACT_SHA256,
      observedRuntimeFingerprint: null,
    },
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

async function productionEnv<T>(work: () => Promise<T>, captureHarnessRoot?: string): Promise<T> {
  const keys = [
    "DATABASE_URL",
    "TEST_DATABASE_URL",
    "MATCHED_ONLY_CODE_ARTIFACT_LABEL",
    "MATCHED_ONLY_EXECUTABLE_ARTIFACT_SHA256",
    "MATCHED_ONLY_PINNED_EXECUTABLE_ARTIFACT_PATH",
    "MATCHED_ONLY_PINNED_CODE_ARTIFACT_LABEL",
    "MATCHED_ONLY_CAPTURE_HARNESS_ROOT",
  ] as const;
  const old = keys.map((k) => process.env[k]);
  process.env.DATABASE_URL = url;
  delete process.env.TEST_DATABASE_URL;
  process.env.MATCHED_ONLY_CODE_ARTIFACT_LABEL = "synthetic-build";
  process.env.MATCHED_ONLY_PINNED_CODE_ARTIFACT_LABEL = "synthetic-build";
  delete process.env.MATCHED_ONLY_EXECUTABLE_ARTIFACT_SHA256;
  process.env.MATCHED_ONLY_PINNED_EXECUTABLE_ARTIFACT_PATH = SYNTHETIC_EXECUTABLE_FIXTURE;
  if (captureHarnessRoot) {
    process.env.MATCHED_ONLY_CAPTURE_HARNESS_ROOT = captureHarnessRoot;
  } else {
    delete process.env.MATCHED_ONLY_CAPTURE_HARNESS_ROOT;
  }
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

it("production: unpinned code plus arbitrary environment label is not verified provenance", async () => {
  const oldLabel = process.env.MATCHED_ONLY_CODE_ARTIFACT_LABEL;
  const oldSha = process.env.MATCHED_ONLY_EXECUTABLE_ARTIFACT_SHA256;
  process.env.MATCHED_ONLY_CODE_ARTIFACT_LABEL = "operator-typed-not-a-build-proof";
  delete process.env.MATCHED_ONLY_EXECUTABLE_ARTIFACT_SHA256;
  try {
    const result = await assertManifestCodeProvenance(null, null, true);
    assert.equal(result.ok, false, "missing manifest provenance cannot be satisfied by arbitrary environment text");
  } finally {
    if (oldLabel === undefined) delete process.env.MATCHED_ONLY_CODE_ARTIFACT_LABEL;
    else process.env.MATCHED_ONLY_CODE_ARTIFACT_LABEL = oldLabel;
    if (oldSha === undefined) delete process.env.MATCHED_ONLY_EXECUTABLE_ARTIFACT_SHA256;
    else process.env.MATCHED_ONLY_EXECUTABLE_ARTIFACT_SHA256 = oldSha;
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
  const applyInput = {
    manifest: f.manifest,
    approvedExecutionHash: hash,
    targetFingerprintPolicy: policy,
  };
  const applied = await productionEnv(() => runProductionWriteApplyHarness(applyInput));
  assert.equal(applied.ok, true, JSON.stringify(applied));
  const secondApply = await productionEnv(() => runProductionWriteApplyHarness(applyInput));
  assert.equal(secondApply.ok, true, JSON.stringify(secondApply));
  if (secondApply.ok) {
    assert.equal((secondApply.receipt as { status?: string })?.status, "no_op_already_applied");
  }
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

it("Computer d19: expiry cannot be extended using previously approved hash", async () => {
  const f = await productionFixture();
  const oldHash = f.manifest.contentHash;
  const changed = {
    ...f.manifest,
    approval: {
      ...f.manifest.approval,
      validUntil: new Date(Date.now() + 864_000_000).toISOString(),
      humanDecisionRef: "different-decision",
    },
  };
  const result = validateExecutionManifestForRun({
    manifest: changed,
    operation: "apply",
    requireApproved: true,
    approvedExecutionHash: oldHash,
  });
  assert.equal(result.ok, false, "approval metadata must be bound, not freely replaceable under old approval hash");
});

it("Computer d19: actual production facade second apply is a no-op", async () => {
  const f = await productionFixture();
  const input = {
    manifest: f.manifest,
    approvedExecutionHash: f.manifest.contentHash,
    targetFingerprintPolicy: f.p.plan.identity.targetDbFingerprint,
  };
  const first = await productionEnv(() => runProductionWriteApplyHarness(input));
  assert.equal(first.ok, true, JSON.stringify(first));
  const second = await productionEnv(() => runProductionWriteApplyHarness(input));
  assert.equal(second.ok, true, JSON.stringify(second));
  if (second.ok) assert.equal((second.receipt as { status?: string })?.status, "no_op_already_applied");
});

for (const [table, field] of [
  ["onec_v3_legal_sales_lines", "income"],
  ["onec_v3_legal_sale_item_lines", "income"],
  ["onec_v3_legal_return_lines", "income"],
  ["onec_v3_legal_return_item_lines", "quantity"],
  ["onec_v3_legal_sale_item_lines", "cost_price"],
] as const) {
  it(`Computer d19: actual ${table}.${field} is verified before commit`, async () => {
    const f = await productionFixture();
    await pool.query(
      `CREATE FUNCTION qa_change_money() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.${field} := NEW.${field} + 1; RETURN NEW; END $$`,
    );
    await pool.query(
      `CREATE TRIGGER qa_change_money BEFORE INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION qa_change_money()`,
    );
    const r = await runMatchedOnlyApply(url, f.rosters, f.p.plan, f.p.hash, f.p.backup, f.p.sha);
    assert.equal(r.ok, false, `unverified persisted ${table}.${field} committed: ${JSON.stringify(r)}`);
    const n = await pool.query<{ n: string }>(`SELECT COUNT(*)::text AS n FROM ${table}`);
    assert.equal(n.rows[0]?.n, "0", "mismatch must rollback, not commit then report failure");
  });
}

it("Computer d19: exact decimal legitimate return income -0.1 plus -0.2 succeeds", async () => {
  await fresh();
  const rosters = {
    ...bundle(),
    returnsAggregate: parse(parseLegalReturnsJsonBytes, [
      buildReturnRecord({ legalGuid: LEGAL_B, income: "-0.3", quantity: -2 }),
    ]),
    returnItems: parse(parseLegalReturnItemsJsonBytes, [
      buildReturnRecord({ legalGuid: LEGAL_B, income: "-0.1", quantity: -1, withItems: true }),
      buildReturnRecord({ legalGuid: LEGAL_B, income: "-0.2", quantity: -1, withItems: true }),
    ]),
  };
  const p = await planned(rosters);
  const r = await runMatchedOnlyApply(url, rosters, p.plan, p.hash, p.backup, p.sha);
  assert.equal(r.ok, true, `exact decimals cannot be compared through binary Number: ${JSON.stringify(r)}`);
});

it("Computer d19: code provenance cannot be forged by matching arbitrary environment label", async () => {
  await productionEnv(async () => {
    process.env.MATCHED_ONLY_CODE_ARTIFACT_LABEL = "made-up-unverified-build";
    assert.equal(
      (await assertManifestCodeProvenance("made-up-unverified-build", SYNTHETIC_TEST_EXECUTABLE_ARTIFACT_SHA256, true))
        .ok,
      false,
      "unpinned operator label must not satisfy manifest label check",
    );
  });
});

it("Computer d19: RO preflight is repeatable-read, not a mixed read-committed snapshot", async () => {
  const isolation = await withReadOnlyPreflightSession(pool, async (c) =>
    (await c.query("SHOW transaction_isolation")).rows[0].transaction_isolation,
  );
  assert.equal(isolation, "repeatable read");
});

it("Computer d19: direct core cannot use test capability with TEST_DATABASE_URL absent", async () => {
  const f = await productionFixture();
  const r = await productionEnv(async () => {
    try {
      const capability = issueTestExecutionCapability(url);
      return await executeMatchedOnlyApply(
        capability,
        url,
        f.rosters,
        f.p.plan,
        f.p.hash,
        f.p.backup,
        f.p.sha,
      );
    } catch {
      return { ok: false as const, mode: "apply" as const, code: "TEST_DATABASE_REQUIRED", message: "" };
    }
  });
  assert.equal(r.ok, false, "public capability factory must not bypass channel target/approval guard");
});

it("Computer d19: private capture without independent capture consent cannot export business rows", async () => {
  const f = await productionFixture();
  const m = withComputedContentHash({
    ...f.manifest,
    approval: {
      status: "NOT_APPROVED",
      approvedExecutionHash: null,
      humanDecisionRef: null,
      validUntil: null,
    },
    privateBackupCapture: {
      status: "APPROVED",
      destinationPath: join(f.scratchDir, "unauthorized-export.json"),
      approvedCaptureHash: "a".repeat(64),
      humanCaptureRef: "forged",
      validUntil: new Date(Date.now() + 3_600_000).toISOString(),
    },
  });
  const r = await productionEnv(() =>
    capturePrivateBusinessBackupForManifest({ manifest: m, approvedCaptureHash: "a".repeat(64) }),
  );
  assert.equal(r.ok, false, "one editable capture.status field is not independent consent or target verification");
});

it("Computer d19: private capture cannot overwrite an existing backup", async () => {
  const f = await productionFixture();
  const destination = join(f.scratchDir, "keep-original.json");
  await writeFile(destination, "SYNTHETIC ORIGINAL MUST SURVIVE", { mode: 0o600 });
  const m = withBoundCaptureHash(
    withBoundApprovalHash({
      ...f.manifest,
      privateBackupCapture: {
        status: "APPROVED",
        approvedPrivateRoot: f.scratchDir,
        destinationPath: destination,
        approvedCaptureHash: null,
        humanCaptureRef: "synthetic-capture-consent",
        validUntil: new Date(Date.now() + 3_600_000).toISOString(),
      },
    }),
  );
  const captureHash = m.privateBackupCapture!.approvedCaptureHash!;
  const r = await productionEnv(
    () =>
      capturePrivateBusinessBackupForManifest({
        manifest: m,
        approvedCaptureHash: captureHash,
      }),
    f.scratchDir,
  );
  const bytes = await readFile(destination, "utf8");
  assert.equal(bytes, "SYNTHETIC ORIGINAL MUST SURVIVE", `backup overwritten: ${JSON.stringify(r)}`);
  assert.equal(r.ok, false);
});

it("Computer d19: approved budget monetary total must equal source and persisted money", async () => {
  const f = await productionFixture();
  const m = withBoundApprovalHash({
    ...f.manifest,
    executionBudget: {
      ...f.manifest.executionBudget!,
      matchedTotals: {
        ...f.manifest.executionBudget!.matchedTotals,
        returnItems: {
          matchedIncome: "999999999999.0000",
          matchedQuantity: f.manifest.executionBudget!.matchedTotals.returnItems.matchedQuantity,
        },
      },
    },
  });
  const r = await productionEnv(() =>
    runProductionWriteApplyHarness({
      manifest: m,
      approvedExecutionHash: m.contentHash,
      targetFingerprintPolicy: f.p.plan.identity.targetDbFingerprint,
    }),
  );
  assert.equal(r.ok, false, `contradictory approved budget must not commit actual income -10: ${JSON.stringify(r)}`);
});

it("Computer d19: unchanged counts and totals cannot hide wrong client GUID", async () => {
  const f = await productionFixture();
  await pool.query(
    `CREATE FUNCTION qa_wrong_client() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN NEW.legal_guid := '${LEGAL_A}'::uuid; RETURN NEW; END$$`,
  );
  await pool.query(
    "CREATE TRIGGER qa_wrong_client BEFORE INSERT ON onec_v3_legal_return_item_lines FOR EACH ROW EXECUTE FUNCTION qa_wrong_client()",
  );
  const r = await runMatchedOnlyApply(url, f.rosters, f.p.plan, f.p.hash, f.p.backup, f.p.sha);
  assert.equal(r.ok, false, "persisted source-key/client correspondence must be checked, not merely total income");
});

function captureManifest(f: Awaited<ReturnType<typeof productionFixture>>) {
  return withBoundCaptureHash({
    ...f.manifest,
    privateBackupCapture: {
      status: "APPROVED",
      approvedPrivateRoot: f.scratchDir,
      destinationPath: join(f.scratchDir, "future-private-capture.json"),
      approvedCaptureHash: null,
      humanCaptureRef: "synthetic-capture-consent",
      validUntil: new Date(Date.now() + 3_600_000).toISOString(),
    },
  });
}

it("Computer b177: every agreed sale financial and model field is verified, not a selected subset", { timeout: 60_000 }, async () => {
  const matrix: [string, string, string][] = [];
  for (const table of ["onec_v3_legal_sales_lines", "onec_v3_legal_sale_item_lines"]) {
    for (const field of [
      "manual_discount",
      "automatic_discount",
      "total_discount",
      "additional_expenses",
      "gross_profit",
      "profitability",
    ]) {
      matrix.push([table, field, `NEW.${field} + 1`]);
    }
  }
  matrix.push(["onec_v3_legal_sales_lines", "cost_price", "NEW.cost_price + 1"]);
  matrix.push(["onec_v3_legal_sales_lines", "source_sha256", `'${"f".repeat(64)}'`]);
  for (const table of ["onec_v3_legal_sale_item_lines", "onec_v3_legal_return_item_lines"]) {
    matrix.push([table, "guid_item", `'dddddddd-dddd-4ddd-8ddd-dddddddddddd'::uuid`]);
    matrix.push([table, "name_item", "'Synthetic Wrong Model'"]);
    matrix.push([table, "product_type", "'Synthetic Wrong Category'"]);
  }
  matrix.push(["onec_v3_legal_return_lines", "product_type", "'Synthetic Wrong Category'"]);
  const committed: string[] = [];
  for (const [table, field, value] of matrix) {
    const f = await productionFixture();
    await pool.query(
      `CREATE FUNCTION qa_matrix_mutation() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN NEW.${field} := ${value}; RETURN NEW; END$$`,
    );
    await pool.query(
      `CREATE TRIGGER qa_matrix_mutation BEFORE INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION qa_matrix_mutation()`,
    );
    const r = await productionEnv(() =>
      runProductionWriteApplyHarness({
        manifest: f.manifest,
        approvedExecutionHash: f.manifest.contentHash,
        targetFingerprintPolicy: f.p.plan.identity.targetDbFingerprint,
      }),
    );
    if (r.ok) committed.push(`${table}.${field}`);
    else assert.match(r.code, /PERSISTED|DML|MATERIALIZ|BUDGET/);
  }
  assert.deepEqual(committed, []);
});

it("Computer b177: arbitrary matching executable SHA env is not actual code proof", async () => {
  const r = await productionEnv(async () => {
    delete process.env.MATCHED_ONLY_PINNED_EXECUTABLE_ARTIFACT_PATH;
    process.env.MATCHED_ONLY_EXECUTABLE_ARTIFACT_SHA256 = SYNTHETIC_TEST_EXECUTABLE_ARTIFACT_SHA256;
    return assertManifestCodeProvenance("synthetic-build", SYNTHETIC_TEST_EXECUTABLE_ARTIFACT_SHA256, true);
  });
  assert.equal(r.ok, false);
});

it("Computer b177: hashing unrelated text file cannot verify executing code", async () => {
  const f = await productionFixture();
  const path = join(f.scratchDir, "not-an-executable.txt");
  const bytes = "Synthetic unrelated data, not the running import executor";
  await writeFile(path, bytes, { mode: 0o600 });
  const digest = createHash("sha256").update(bytes).digest("hex");
  const r = await productionEnv(async () => {
    process.env.MATCHED_ONLY_PINNED_EXECUTABLE_ARTIFACT_PATH = path;
    return assertManifestCodeProvenance("synthetic-build", digest, true);
  });
  assert.equal(r.ok, false);
});

it("Computer b177: independent capture consent hash binds expiry and consent reference", async () => {
  const f = await productionFixture();
  const m = captureManifest(f);
  const hash = m.privateBackupCapture!.approvedCaptureHash!;
  assert.equal(validatePrivateCaptureManifestForRun({ manifest: m, approvedCaptureHash: hash }).ok, true);
  const changed = withBoundCaptureHash({
    ...m,
    privateBackupCapture: {
      ...m.privateBackupCapture!,
      validUntil: new Date(Date.now() + 864_000_000).toISOString(),
      humanCaptureRef: "different-capture-decision",
    },
  });
  assert.equal(
    validatePrivateCaptureManifestForRun({ manifest: changed, approvedCaptureHash: hash }).ok,
    false,
  );
});

it("Computer b177: separately approved backup does not require permission to apply financial data", async () => {
  const f = await productionFixture();
  const m = captureManifest(f);
  const captureOnly = withComputedContentHash({
    ...m,
    approval: {
      status: "NOT_APPROVED",
      approvedExecutionHash: null,
      humanDecisionRef: null,
      validUntil: null,
    },
  });
  const r = validatePrivateCaptureManifestForRun({
    manifest: captureOnly,
    approvedCaptureHash: m.privateBackupCapture!.approvedCaptureHash!,
  });
  assert.equal(r.ok, true);
});

it("Computer b177: core cannot accept self-issued production capability plus unapproved binding", async () => {
  const f = await productionFixture();
  const r = await productionEnv(() =>
    executeMatchedOnlyApply(
      issueProductionExecutionCapability(url),
      url,
      f.rosters,
      f.p.plan,
      f.p.hash,
      f.p.backup,
      f.p.sha,
      undefined,
      {
        manifestContentHash: "not-an-approved-manifest",
        codeArtifactLabel: "self-declared",
        expectedExecutableArtifactSha256: "not-an-artifact",
        approvalValidUntil: new Date(Date.now() + 3_600_000).toISOString(),
        executionBudget: f.manifest.executionBudget!,
        expectedBackupSha256: f.p.sha,
      },
    ),
  );
  assert.equal(r.ok, false);
});

it("Computer b177: canonical budget object key order does not reject unchanged financial values", async () => {
  const f = await productionFixture();
  const b = f.manifest.executionBudget!;
  const reversed = Object.fromEntries(Object.entries(b.matchedTotals).reverse()) as typeof b.matchedTotals;
  const r = validateExecutionBudgetAgainstSource(
    f.p.plan,
    { ...b, matchedTotals: reversed },
    f.rosters,
    new Set([LEGAL_A, LEGAL_B].map((s) => s.toLowerCase())),
  );
  assert.equal(r.ok, true);
});

it("Computer b177: actual import activation/state/quarantine/statistics match approved materialization", { timeout: 60_000 }, async () => {
  const cases: [string, string][] = [
    ["onec_v3_legal_sales_month_activation", `NEW.source_sha256 := '${"f".repeat(64)}';`],
    ["onec_v3_legal_sale_item_import_state", "NEW.row_count := NEW.row_count + 1;"],
    ["onec_v3_legal_sales_import_month_stats", "NEW.full_row_count := NEW.full_row_count + 1; NEW.excluded_row_count := NEW.excluded_row_count + 1;"],
    ["onec_v3_legal_sales_import_quarantine_rows", `NEW.legal_guid := '${LEGAL_A}'::uuid;`],
  ];
  const accepted: string[] = [];
  for (const [table, mutate] of cases) {
    const f = await productionFixture();
    await pool.query(
      `CREATE FUNCTION qa_bad_metadata() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN ${mutate} RETURN NEW; END$$`,
    );
    await pool.query(
      `CREATE TRIGGER qa_bad_metadata BEFORE INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION qa_bad_metadata()`,
    );
    const r = await productionEnv(() =>
      runProductionWriteApplyHarness({
        manifest: f.manifest,
        approvedExecutionHash: f.manifest.contentHash,
        targetFingerprintPolicy: f.p.plan.identity.targetDbFingerprint,
      }),
    );
    if (r.ok) accepted.push(table);
    else assert.match(r.code, /PERSISTED|DML|MATERIALIZ|BUDGET|STATE|QUARANTINE/);
  }
  assert.deepEqual(accepted, []);
});

it("Computer b177: unexpected zero-valued extra row cannot hide behind correct sums", async () => {
  const f = await productionFixture();
  await pool.query(`CREATE FUNCTION qa_extra_row() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN
    IF NEW.source_row_index < 1000 THEN
      NEW.source_row_index := NEW.source_row_index + 1000;
      NEW.quantity := 0; NEW.income := 0;
      INSERT INTO onec_v3_legal_return_item_lines SELECT NEW.*;
    END IF;
    RETURN NULL;
  END$$`);
  await pool.query(
    "CREATE TRIGGER qa_extra_row AFTER INSERT ON onec_v3_legal_return_item_lines FOR EACH ROW EXECUTE FUNCTION qa_extra_row()",
  );
  const r = await productionEnv(() =>
    runProductionWriteApplyHarness({
      manifest: f.manifest,
      approvedExecutionHash: f.manifest.contentHash,
      targetFingerprintPolicy: f.p.plan.identity.targetDbFingerprint,
    }),
  );
  assert.equal(r.ok, false);
});

it("Computer b177: capture-only consent exports backup then separate apply manifest commits", async () => {
  const f = await productionFixture();
  const captureDest = join(f.scratchDir, "capture-only-backup.json");
  const captureM = withBoundCaptureHash({
    ...f.manifest,
    approval: {
      status: "NOT_APPROVED",
      approvedExecutionHash: null,
      humanDecisionRef: null,
      validUntil: null,
    },
    privateBackupCapture: {
      status: "APPROVED",
      approvedPrivateRoot: f.scratchDir,
      destinationPath: captureDest,
      approvedCaptureHash: null,
      humanCaptureRef: "synthetic-capture-consent",
      validUntil: new Date(Date.now() + 3_600_000).toISOString(),
    },
  });
  const captureHash = captureM.privateBackupCapture!.approvedCaptureHash!;
  const captured = await productionEnv(
    () => capturePrivateBusinessBackupForManifest({ manifest: captureM, approvedCaptureHash: captureHash }),
    f.scratchDir,
  );
  assert.equal(captured.ok, true, JSON.stringify(captured));
  const applied = await productionEnv(() =>
    runProductionWriteApplyHarness({
      manifest: f.manifest,
      approvedExecutionHash: f.manifest.contentHash,
      targetFingerprintPolicy: f.p.plan.identity.targetDbFingerprint,
    }),
  );
  assert.equal(applied.ok, true, JSON.stringify(applied));
});
