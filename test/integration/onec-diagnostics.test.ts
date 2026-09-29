import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { Pool } from "pg";
import { runOneDiagnosticJob } from "../../src/onec-diagnostics/worker";
import type { FtpReader } from "../../src/onec-clients/ftp-read";
import { getIntegrationDatabaseUrl, prepareDatabase, setIntegrationEnv } from "../helpers/test-db";

const env = {
  ONEC_FTP_ENABLED: "true", ONEC_FTP_SECURITY: "plain", ONEC_FTP_HOST: "gw.toopatch.ru",
  ONEC_FTP_PORT: "21", ONEC_FTP_USER: "test", ONEC_FTP_PASSWORD: "secret-test-value",
  ONEC_FTP_BASE_PATH: "/LC", ONEC_FTP_TIMEOUT_MS: "1000",
};
const bytes = Buffer.from(JSON.stringify([{
  guid_client: "0d714501-be78-11ee-812e-00155d0a0a4e",
  guid_manager: "f6901d52-fbfe-11eb-8103-00155d0a0a4e",
  name_manager: "Тест", telephone: ["secret-test-value"],
}]));

describe("operator-only diagnostics", { concurrency: false }, () => {
  let pool: Pool;
  let reads = 0;
  const reader: FtpReader = async config => {
    reads++;
    assert.equal(config.basePath, "/LC");
    return { ok: true, bytes, remotePath: "/LC/clients/all_clients.json" };
  };
  before(async () => {
    const url = getIntegrationDatabaseUrl();
    setIntegrationEnv(url);
    await prepareDatabase(url);
    pool = new Pool({ connectionString: url, max: 3 });
  });
  beforeEach(async () => {
    reads = 0;
    await pool.query("TRUNCATE onec_diagnostic_jobs");
  });
  after(async () => { await pool?.end(); });

  it("no request means no FTP connection", async () => {
    assert.equal(await runOneDiagnosticJob(pool, env, reader), "idle");
    assert.equal(reads, 0);
  });
  it("expired request is ignored", async () => {
    await pool.query(`INSERT INTO onec_diagnostic_jobs(requested_at,expires_at)
      VALUES(NOW()-INTERVAL '2 hours',NOW()-INTERVAL '1 hour')`);
    assert.equal(await runOneDiagnosticJob(pool, env, reader), "idle");
    assert.equal(reads, 0);
  });
  it("executes once, saves only projection, leaves all business/access tables unchanged", async () => {
    const counts = async () => (await pool.query(`SELECT
      (SELECT count(*)::int FROM users) users,
      (SELECT count(*)::int FROM onec_clients) clients,
      (SELECT count(*)::int FROM user_onec_employee_links) links,
      (SELECT count(*)::int FROM access_grants) grants,
      (SELECT count(*)::int FROM onec_client_import_runs) imports`)).rows[0];
    const before = await counts();
    await pool.query("INSERT INTO onec_diagnostic_jobs(expires_at) VALUES(NOW()+INTERVAL '1 hour')");
    assert.equal(await runOneDiagnosticJob(pool, env, reader), "success");
    assert.equal(await runOneDiagnosticJob(pool, env, reader), "idle");
    assert.equal(reads, 1);
    const job = (await pool.query("SELECT * FROM onec_diagnostic_jobs")).rows[0];
    assert.equal(job.status, "success");
    assert.equal(job.report.records, 1);
    assert.equal(JSON.stringify(job.report).includes(env.ONEC_FTP_PASSWORD), false);
    assert.deepEqual(await counts(), before);
  });
  it("concurrent workers read once", async () => {
    await pool.query("INSERT INTO onec_diagnostic_jobs(expires_at) VALUES(NOW()+INTERVAL '1 hour')");
    const results = await Promise.all([runOneDiagnosticJob(pool, env, reader), runOneDiagnosticJob(pool, env, reader)]);
    assert.deepEqual(results.sort(), ["idle", "success"]);
    assert.equal(reads, 1);
  });
  it("invalid config fails without reading and does not expose configuration", async () => {
    await pool.query("INSERT INTO onec_diagnostic_jobs(expires_at) VALUES(NOW()+INTERVAL '1 hour')");
    assert.equal(await runOneDiagnosticJob(pool, { ...env, ONEC_FTP_BASE_PATH: "/other" }, reader), "failed");
    assert.equal(reads, 0);
    const job = (await pool.query("SELECT error_code,report FROM onec_diagnostic_jobs")).rows[0];
    assert.deepEqual(job, { error_code: "DIAGNOSTIC_FAILED", report: null });
  });
  it("FTP errors cannot leak secrets; failed jobs are not retried", async () => {
    await pool.query("INSERT INTO onec_diagnostic_jobs(expires_at) VALUES(NOW()+INTERVAL '1 hour')");
    const bad: FtpReader = async () => { throw new Error(env.ONEC_FTP_PASSWORD); };
    assert.equal(await runOneDiagnosticJob(pool, env, bad), "failed");
    assert.equal(await runOneDiagnosticJob(pool, env, reader), "idle");
    assert.equal(reads, 0);
    const job = (await pool.query("SELECT * FROM onec_diagnostic_jobs")).rows[0];
    assert.equal(JSON.stringify(job).includes(env.ONEC_FTP_PASSWORD), false);
  });
  it("untrusted invalid JSON is rejected with a fixed error", async () => {
    await pool.query("INSERT INTO onec_diagnostic_jobs(expires_at) VALUES(NOW()+INTERVAL '1 hour')");
    const bad: FtpReader = async () => ({ ok: true, bytes: Buffer.from("{"), remotePath: "/LC/clients/all_clients.json" });
    assert.equal(await runOneDiagnosticJob(pool, env, bad), "failed");
    assert.equal((await pool.query("SELECT error_code FROM onec_diagnostic_jobs")).rows[0].error_code, "DIAGNOSTIC_FAILED");
  });
});
