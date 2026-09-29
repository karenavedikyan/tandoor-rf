import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { Pool } from "pg";
import type { FtpReader } from "../../src/onec-clients/ftp-read";
import { runScheduledExchangeCycle } from "../../src/onec-scheduled-exchange/run-cycle";
import {
  buildClientsFileBytes,
  buildClientsFileSha256,
  sampleClient,
} from "../helpers/onec-clients-fixtures";
import { getIntegrationDatabaseUrl, prepareDatabase, setIntegrationEnv } from "../helpers/test-db";

const env = {
  ONEC_FTP_ENABLED: "true",
  ONEC_FTP_SECURITY: "plain",
  ONEC_FTP_HOST: "gw.toopatch.ru",
  ONEC_FTP_PORT: "21",
  ONEC_FTP_USER: "test",
  ONEC_FTP_PASSWORD: "secret-test-value",
  ONEC_FTP_BASE_PATH: "/LC",
  ONEC_FTP_TIMEOUT_MS: "1000",
  ONEC_SCHEDULED_EXCHANGE_APPLY: "false",
  ONEC_SCHEDULED_EXCHANGE_STABILITY_DELAY_MS: "0",
};

describe("scheduled exchange integration", { concurrency: false }, () => {
  let pool: Pool;
  let reads = 0;
  const bytes = buildClientsFileBytes([sampleClient()]);
  const reader: FtpReader = async () => {
    reads += 1;
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
    await pool.query("TRUNCATE onec_client_import_runs RESTART IDENTITY CASCADE");
    await pool.query(`
      UPDATE onec_exchange_state
      SET
        last_attempt_at = NULL,
        last_verified_at = NULL,
        last_verified_sha256 = NULL,
        last_checked_at = NULL,
        last_checked_sha256 = NULL,
        last_successful_apply_at = NULL,
        last_successful_apply_sha256 = NULL,
        accepted_baseline_sha256 = NULL,
        apply_blocked = false,
        apply_blocked_reason = NULL
    `);
    await pool.query("TRUNCATE onec_clients RESTART IDENTITY CASCADE");
  });

  after(async () => {
    await pool?.end();
  });

  it("defaults to check-only without apply", async () => {
    const result = await runScheduledExchangeCycle({ env, ftpReader: reader });
    assert.equal(result.status, "CHECK_ONLY");
    assert.equal(reads, 2);
    assert.equal((await pool.query("SELECT count(*)::int AS count FROM onec_clients")).rows[0].count, 0);
    const journal = (
      await pool.query("SELECT mode, trigger_source, stage FROM onec_client_import_runs")
    ).rows[0];
    assert.equal(journal.mode, "scheduled_check");
    assert.equal(journal.trigger_source, "scheduled");
  });

  it("requires baseline SHA for first scheduled apply", async () => {
    const sha = buildClientsFileSha256([sampleClient()]);
    const result = await runScheduledExchangeCycle({
      env: { ...env, ONEC_SCHEDULED_EXCHANGE_APPLY: "true" },
      ftpReader: reader,
    });
    assert.equal(result.status, "BASELINE_REQUIRED");
    await pool.query("UPDATE onec_exchange_state SET accepted_baseline_sha256 = $1", [sha]);
    const second = await runScheduledExchangeCycle({
      env: {
        ...env,
        ONEC_SCHEDULED_EXCHANGE_APPLY: "true",
        ONEC_SCHEDULED_EXCHANGE_ACCEPTED_BASELINE_SHA256: sha,
      },
      ftpReader: reader,
    });
    assert.equal(second.status, "SUCCESS");
    assert.equal((await pool.query("SELECT count(*)::int AS count FROM onec_clients")).rows[0].count, 1);
  });

  it("skips when FTP matches the committed database snapshot", async () => {
    const sha = buildClientsFileSha256([sampleClient()]);
    const applied = await runScheduledExchangeCycle({
      env: {
        ...env,
        ONEC_SCHEDULED_EXCHANGE_APPLY: "true",
        ONEC_SCHEDULED_EXCHANGE_ACCEPTED_BASELINE_SHA256: sha,
      },
      ftpReader: reader,
    });
    assert.equal(applied.status, "SUCCESS");
    reads = 0;
    const second = await runScheduledExchangeCycle({
      env: { ...env, ONEC_SCHEDULED_EXCHANGE_APPLY: "false" },
      ftpReader: reader,
    });
    assert.equal(second.status, "SKIPPED_UNCHANGED");
    assert.equal(reads, 2);
  });
});
