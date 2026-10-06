import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { Pool } from "pg";
import type { FtpReader } from "../onec-clients/ftp-read";
import {
  buildClientsFileBytes,
  buildImportVerificationFingerprint,
  sampleClient,
} from "../helpers/onec-clients-fixtures";
import { getIntegrationDatabaseUrl, prepareDatabase, setIntegrationEnv } from "../helpers/test-db";
import { REGULAR_UPDATE_JOB_KIND } from "../../src/onec-import/constants";
import { runOneImportJob } from "../../src/onec-import/worker";

const env = {
  ONEC_FTP_ENABLED: "true",
  ONEC_FTP_SECURITY: "plain",
  ONEC_FTP_HOST: "gw.toopatch.ru",
  ONEC_FTP_PORT: "21",
  ONEC_FTP_USER: "test",
  ONEC_FTP_PASSWORD: "secret-test-value",
  ONEC_FTP_BASE_PATH: "/LC",
  ONEC_FTP_TIMEOUT_MS: "1000",
};

describe("operator-only scheduled import jobs", { concurrency: false }, () => {
  let pool: Pool;
  let reads = 0;
  const bytes = buildClientsFileBytes([sampleClient()]);
  const reader: FtpReader = async (config) => {
    reads++;
    assert.equal(config.basePath, "/LC");
    return { ok: true, bytes, remotePath: "/LC/clients/all_clients.json" };
  };

  before(async () => {
    const url = getIntegrationDatabaseUrl();
    setIntegrationEnv(url);
    await prepareDatabase(url);
    pool = new Pool({ connectionString: url, max: 3 });
    Object.assign(env, { DATABASE_URL: url });
  });

  beforeEach(async () => {
    reads = 0;
    await pool.query("TRUNCATE onec_import_jobs RESTART IDENTITY CASCADE");
    await pool.query("TRUNCATE onec_client_import_runs RESTART IDENTITY CASCADE");
    await pool.query("TRUNCATE onec_clients RESTART IDENTITY CASCADE");
  });

  after(async () => {
    await pool?.end();
  });

  it("no pending job means no FTP connection", async () => {
    assert.equal(await runOneImportJob(pool, env, reader), "idle");
    assert.equal(reads, 0);
  });

  it("expired job is ignored", async () => {
    await pool.query(`
      INSERT INTO onec_import_jobs (mode, requested_at, expires_at)
      VALUES ('dry_run', NOW() - INTERVAL '2 hours', NOW() - INTERVAL '1 hour')
    `);
    assert.equal(await runOneImportJob(pool, env, reader), "idle");
    assert.equal(reads, 0);
  });

  it("dry_run job validates file without changing clients or access tables", async () => {
    const counts = async () =>
      (
        await pool.query(`
          SELECT
            (SELECT count(*)::int FROM users) AS users,
            (SELECT count(*)::int FROM onec_clients) AS clients,
            (SELECT count(*)::int FROM user_onec_employee_links) AS links,
            (SELECT count(*)::int FROM access_grants) AS grants,
            (SELECT count(*)::int FROM onec_client_import_runs) AS import_runs
        `)
      ).rows[0];
    const before = await counts();
    await pool.query(`
      INSERT INTO onec_import_jobs (mode, expires_at)
      VALUES ('dry_run', NOW() + INTERVAL '1 hour')
    `);
    assert.equal(await runOneImportJob(pool, env, reader), "success");
    assert.equal(await runOneImportJob(pool, env, reader), "idle");
    assert.equal(reads, 1);
    const job = (await pool.query("SELECT * FROM onec_import_jobs")).rows[0];
    assert.equal(job.status, "success");
    assert.equal(job.result.status, "SUCCESS");
    assert.equal(job.result.mode, "dry_run");
    assert.equal(JSON.stringify(job.result).includes(env.ONEC_FTP_PASSWORD), false);
    assert.deepEqual(await counts(), before);
  });

  it("apply job requires expected_sha256 and writes import run", async () => {
    const sha256 = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    await pool.query(
      `
        INSERT INTO onec_import_jobs (mode, expected_sha256, expires_at)
        VALUES ('apply', $1, NOW() + INTERVAL '1 hour')
      `,
      [sha256],
    );
    assert.equal(await runOneImportJob(pool, env, reader), "failed");
    const failed = (await pool.query("SELECT status, error_code FROM onec_import_jobs")).rows[0];
    assert.equal(failed.status, "failed");
    assert.equal(failed.error_code, "HASH_MISMATCH");

    reads = 0;
    await pool.query("TRUNCATE onec_import_jobs RESTART IDENTITY CASCADE");
    const validSha = buildImportVerificationFingerprint([sampleClient()]);
    await pool.query(
      `
        INSERT INTO onec_import_jobs (mode, expected_sha256, expires_at)
        VALUES ('apply', $1, NOW() + INTERVAL '1 hour')
      `,
      [validSha],
    );
    assert.equal(await runOneImportJob(pool, env, reader), "success");
    const job = (await pool.query("SELECT * FROM onec_import_jobs")).rows[0];
    assert.equal(job.status, "success");
    assert.ok(job.import_run_id);
    const run = (
      await pool.query("SELECT status, mode FROM onec_client_import_runs WHERE id = $1::uuid", [
        job.import_run_id,
      ])
    ).rows[0];
    assert.equal(run.status, "success");
    assert.equal(run.mode, "apply");
    assert.equal((await pool.query("SELECT count(*)::int AS count FROM onec_clients")).rows[0].count, 1);
  });

  it("concurrent workers process one job", async () => {
    await pool.query(`
      INSERT INTO onec_import_jobs (mode, expires_at)
      VALUES ('dry_run', NOW() + INTERVAL '1 hour')
    `);
    const results = await Promise.all([
      runOneImportJob(pool, env, reader),
      runOneImportJob(pool, env, reader),
    ]);
    assert.deepEqual(results.sort(), ["idle", "success"]);
    assert.equal(reads, 1);
  });

  it("apply is blocked when job is no longer running after FTP read", async () => {
    const validSha = buildImportVerificationFingerprint([sampleClient()]);
    await pool.query(
      `
        INSERT INTO onec_import_jobs (mode, expected_sha256, expires_at)
        VALUES ('apply', $1, NOW() + INTERVAL '1 hour')
      `,
      [validSha],
    );

    let releaseFtp!: () => void;
    const ftpBlocked = new Promise<void>((resolve) => {
      releaseFtp = resolve;
    });
    const pausingReader: FtpReader = async () => {
      await ftpBlocked;
      return { ok: true, bytes, remotePath: "/LC/clients/all_clients.json" };
    };

    const workerPromise = runOneImportJob(pool, env, pausingReader);

    for (let attempt = 0; attempt < 100; attempt += 1) {
      const status = await pool.query<{ status: string }>(`SELECT status FROM onec_import_jobs LIMIT 1`);
      if (status.rows[0]?.status === "running") {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    await pool.query(`DELETE FROM onec_import_jobs`);
    releaseFtp();
    assert.equal(await workerPromise, "failed");
    assert.equal((await pool.query("SELECT count(*)::int AS count FROM onec_clients")).rows[0].count, 0);
  });

  it("kinds filter skips legacy clients_snapshot jobs for automatic worker", async () => {
    await pool.query(`
      INSERT INTO onec_import_jobs (kind, mode, expires_at)
      VALUES ('clients_snapshot', 'dry_run', NOW() + INTERVAL '1 hour')
    `);
    assert.equal(
      await runOneImportJob(pool, env, reader, undefined, { kinds: [REGULAR_UPDATE_JOB_KIND] }),
      "idle",
    );
    assert.equal(reads, 0);
    const legacy = (await pool.query("SELECT status FROM onec_import_jobs LIMIT 1")).rows[0];
    assert.equal(legacy.status, "pending");
  });

  it("invalid FTP config fails without reading", async () => {
    await pool.query(`
      INSERT INTO onec_import_jobs (mode, expires_at)
      VALUES ('dry_run', NOW() + INTERVAL '1 hour')
    `);
    assert.equal(await runOneImportJob(pool, { ...env, ONEC_FTP_BASE_PATH: "/other" }, reader), "failed");
    assert.equal(reads, 0);
    const job = (await pool.query("SELECT error_code, result FROM onec_import_jobs")).rows[0];
    assert.deepEqual(job, { error_code: "IMPORT_JOB_FAILED", result: null });
  });
});
