import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, beforeEach, describe, it } from "node:test";
import { Pool } from "pg";
import { createTestUser, getIntegrationDatabaseUrl, prepareDatabase, setIntegrationEnv } from "../helpers/test-db";
import { finalizeStaleRegularUpdateJobs, recoverVerifiedLegacyManualJob } from "../../src/clients/admin-onec-update/job-lifecycle";
import { acquireWorkerLease, releaseWorkerLease } from "../../src/onec-import/worker-lease";
import { runOneImportJob } from "../../src/onec-import/worker";
import { manualFixture } from "../helpers/onec-manual-fixtures";
import { FILES, type FileKey } from "../../src/onec-manual/model";
import { prepareManualBundle, type ManualFiles } from "../../src/onec-manual/model";
import { runManualUpdate } from "../../src/onec-manual/run-update";
import request from "supertest";
import { closePool } from "../../src/db/pool";

describe("manual import worker ownership and recovery", { concurrency: false }, () => {
  let pool: Pool;
  let env: NodeJS.ProcessEnv;
  let adminId: string;
  before(async () => {
    const url = getIntegrationDatabaseUrl();
    setIntegrationEnv(url);
    await prepareDatabase(url);
    pool = new Pool({ connectionString: url, max: 6 });
    adminId = (await createTestUser({ databaseUrl: url, email: "recovery-admin@test.local",
      password: "StrongPass123!", fullName: "Recovery admin", role: "admin" })).id;
    env = { ...process.env, ONEC_FTP_ENABLED: "true", ONEC_FTP_HOST: "gw.toopatch.ru",
      ONEC_FTP_PORT: "21", ONEC_FTP_USER: "test", ONEC_FTP_PASSWORD: "test-not-a-password",
      ONEC_FTP_BASE_PATH: "/LC", ONEC_FTP_SECURITY: "plain", ONEC_NIGHTLY_EXCHANGE_ENABLED: "false" };
  });
  beforeEach(async () => { await pool.query("TRUNCATE onec_import_jobs"); });
  after(async () => { await pool?.end(); await closePool(); });
  async function job(marker = true, pending = false) {
    const id = randomUUID();
    await pool.query(`INSERT INTO onec_import_jobs(id,kind,mode,status,requested_at,started_at,expires_at,result,requested_by_user_id)
      VALUES($1,'regular_update_bundle','apply',$2,NOW(),NOW(),NOW()+INTERVAL '1 hour',$3::jsonb,$4::uuid)`,
    [id, pending ? "pending" : "running", marker ? JSON.stringify({ workerLeaseVersion: 1 }) : null, adminId]);
    return id;
  }
  async function recover() {
    const db = await pool.connect();
    try {
      await db.query("BEGIN");
      await db.query("SET LOCAL statement_timeout=1500");
      await finalizeStaleRegularUpdateJobs(db);
      await db.query("COMMIT");
    } catch (error) {
      await db.query("ROLLBACK"); throw error;
    } finally { db.release(); }
  }
  async function row(id: string) {
    return (await pool.query("SELECT status,error_code,result FROM onec_import_jobs WHERE id=$1", [id])).rows[0];
  }
  it("does not expire a live worker even past job expiry", async () => {
    const id = await job();
    await pool.query(`UPDATE onec_import_jobs SET requested_at=NOW()-INTERVAL '3 hours',
      expires_at=NOW()-INTERVAL '1 hour' WHERE id=$1`, [id]);
    const worker = await pool.connect();
    try {
      assert.equal(await acquireWorkerLease(worker, id), true);
      await recover();
      assert.equal((await row(id)).status, "running");
    } finally { await releaseWorkerLease(worker, id); worker.release(); }
  });
  it("recovers missing worker without applying or enqueueing any data", async () => {
    const id = await job();
    await recover();
    const result = await row(id);
    assert.equal(result.status, "failed");
    assert.equal(result.error_code, "WORKER_INTERRUPTED");
    assert.equal(result.result.status, "ERROR");
    assert.equal((await pool.query("SELECT count(*) FROM onec_manual_batches")).rows[0].count, "0");
    assert.equal((await pool.query("SELECT count(*) FROM onec_import_jobs")).rows[0].count, "1");
    await recover();
    assert.deepEqual(await row(id), result);
    const verifier = await pool.connect();
    try { assert.equal(await acquireWorkerLease(verifier, id), true); }
    finally { await releaseWorkerLease(verifier, id); verifier.release(); }
  });
  it("restores success if COMMIT journal exists, without repeating the import", async () => {
    const id = await job();
    const batch = (await pool.query(`INSERT INTO onec_manual_batches(fingerprint,operator_job_id,counts,issue_count)
      VALUES($1,$2,$3::jsonb,3) RETURNING id`, ["a".repeat(64), id, JSON.stringify({ clients: 2 })])).rows[0].id;
    await recover();
    const result = await row(id);
    assert.equal(result.status, "success"); assert.equal(result.error_code, null);
    assert.equal(result.result.exportBatchId, batch);
    assert.deepEqual(result.result.manualSummary, { batchId: batch, files: { clients: 2 }, issueCount: 3 });
    assert.equal((await pool.query("SELECT count(*) FROM onec_manual_batches")).rows[0].count, "1");
  });
  it("does not automatically finalize legacy jobs without ownership evidence", async () => {
    const id = await job(false);
    await recover();
    assert.equal((await row(id)).status, "running");
  });
  it("does not wait for or finalize a row held by the apply transaction", async () => {
    const id = await job();
    const importer = await pool.connect();
    try {
      await importer.query("BEGIN");
      await importer.query("SELECT id FROM onec_import_jobs WHERE id=$1 FOR UPDATE", [id]);
      await recover();
      assert.equal((await row(id)).status, "running");
    } finally { await importer.query("ROLLBACK"); importer.release(); }
  });
  it("holds ownership during real worker file reading and releases it after completion", async () => {
    const id = await job(false, true), files = manualFixture();
    let release!: () => void, entered!: () => void;
    const gate = new Promise<void>(r => { release = r; });
    const reading = new Promise<void>(r => { entered = r; });
    let first = true;
    const working = runOneImportJob(pool, env, undefined, { regularUpdateExecution: {
      env, manualReader: async relative => {
        if (first) { first = false; entered(); await gate; }
        const key = (Object.keys(FILES) as FileKey[]).find(k => FILES[k].paths.some(p => p === relative));
        if (!key) throw new Error("UNKNOWN_TEST_FILE");
        return files[key].bytes;
      },
    } }, { kinds: ["regular_update_bundle"] });
    try {
      await Promise.race([reading, working.then(() => { throw new Error("WORKER_DID_NOT_READ"); })]);
      assert.equal((await row(id)).result.workerLeaseVersion, 1);
      await recover();
      assert.equal((await row(id)).status, "running");
    } finally { release(); }
    assert.equal(await working, "success");
    assert.equal((await row(id)).status, "success");
    const verifier = await pool.connect();
    try { assert.equal(await acquireWorkerLease(verifier, id), true); }
    finally { await releaseWorkerLease(verifier, id); verifier.release(); }
  });
  it("requires independent stopped-worker confirmation and exact start before legacy recovery", async () => {
    const id = await job(false), db = await pool.connect();
    const startedAt = (await pool.query("SELECT started_at FROM onec_import_jobs WHERE id=$1", [id])).rows[0].started_at.toISOString();
    try {
      await db.query("BEGIN");
      await assert.rejects(recoverVerifiedLegacyManualJob(db, {
        jobId: id, expectedStartedAt: startedAt, confirmedWorkerStopped: false,
      }), /WORKER_STOP_CONFIRMATION_REQUIRED/);
      await assert.rejects(recoverVerifiedLegacyManualJob(db, {
        jobId: id, expectedStartedAt: "2000-01-01T00:00:00Z", confirmedWorkerStopped: true,
      }), /JOB_CHANGED/);
      await recoverVerifiedLegacyManualJob(db, {
        jobId: id, expectedStartedAt: startedAt, confirmedWorkerStopped: true,
      });
      await db.query("COMMIT");
      assert.equal((await row(id)).error_code, "WORKER_INTERRUPTED");
    } finally { await db.query("ROLLBACK"); db.release(); }
  });
  it("refuses explicit recovery while another importer holds the global import lock", async () => {
    const id = await job(false), active = await pool.connect(), db = await pool.connect();
    const startedAt = (await pool.query("SELECT started_at FROM onec_import_jobs WHERE id=$1", [id])).rows[0].started_at.toISOString();
    try {
      await active.query("SELECT pg_advisory_lock($1)", [902451002]);
      await db.query("BEGIN");
      await assert.rejects(recoverVerifiedLegacyManualJob(db, {
        jobId: id, expectedStartedAt: startedAt, confirmedWorkerStopped: true,
      }), /WORKER_ACTIVE/);
      await db.query("ROLLBACK");
      assert.equal((await row(id)).status, "running");
    } finally {
      await db.query("ROLLBACK"); db.release();
      await active.query("SELECT pg_advisory_unlock($1)", [902451002]); active.release();
    }
  });
  it("HTTP status recovers a lost worker and reports preserved data without a new import", async () => {
    const id = await job();
    const app = (await import("../../src/server")).createApp();
    const login = await request(app).post("/api/auth/login").set("Origin", "http://127.0.0.1:3000")
      .send({ email: "recovery-admin@test.local", password: "StrongPass123!" });
    assert.equal(login.status, 200);
    const cookie = login.headers["set-cookie"]?.[0]?.split(";")[0] ?? "";
    const status = await request(app).get("/api/admin/clients/onec-update/status")
      .set("Cookie", cookie).timeout({ deadline: 1500 });
    assert.equal(status.status, 200);
    assert.equal(status.body.job.id, id);
    assert.equal(status.body.job.phase, "error");
    assert.equal(status.body.job.errorCode, "WORKER_INTERRUPTED");
    assert.equal(status.body.job.dataPreserved, true);
    assert.equal((await pool.query("SELECT count(*) FROM onec_import_jobs")).rows[0].count, "1");
  });
  it("commits NO_CHANGES and reused-batch job results atomically, without worker finalization", async () => {
    const apply = async (files: ManualFiles) => {
      const id = await job();
      const outcome = await runManualUpdate({ env, manualFiles: files, operatorImportJobId: id,
        argv: ["--apply", "--expected-fingerprint", prepareManualBundle(files).fingerprint] });
      assert.ok(["SUCCESS", "NO_CHANGES"].includes(outcome.status), JSON.stringify(outcome));
      assert.equal((await row(id)).status, "success");
      assert.equal((await row(id)).result.status, outcome.status);
      await recover();
      assert.equal((await row(id)).result.status, outcome.status);
      return outcome;
    };
    const a = manualFixture(), b = manualFixture({ clients: [] });
    const first = await apply(a);
    assert.equal((await apply(a)).status, "NO_CHANGES");
    assert.equal((await apply(b)).status, "SUCCESS");
    const reactivated = await apply(a);
    assert.equal(reactivated.status, "SUCCESS");
    assert.equal(reactivated.exportBatchId, first.exportBatchId);
  });
});
