import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { Pool } from "pg";
import { applyClientsImport } from "../../src/onec-clients/apply";
import { validateClientsFileBytes } from "../../src/onec-clients/validate";
import { runScheduledExchangeCycle } from "../../src/onec-scheduled-exchange/run-cycle";
import { getCommittedSnapshotSha } from "../../src/onec-exchange/state";
import {
  buildClientsFileBytes,
  buildClientsFileSha256,
  sampleClient, applyClientsImportVerified} from "../helpers/onec-clients-fixtures";
import { getIntegrationDatabaseUrl, prepareDatabase, setIntegrationEnv } from "../helpers/test-db";

function validatedPayload(bytes: Buffer) {
  const validated = validateClientsFileBytes(bytes);
  assert.equal(validated.ok, true);
  if (!validated.ok) {
    throw new Error("validation failed");
  }
  return validated.payload;
}

describe("onec exchange state bootstrap on existing database", { concurrency: false }, () => {
  let pool: Pool;
  let databaseUrl = "";

  const env = {
    ONEC_FTP_ENABLED: "true",
    ONEC_FTP_SECURITY: "plain",
    ONEC_FTP_HOST: "127.0.0.1",
    ONEC_FTP_PORT: "21",
    ONEC_FTP_USER: "lc_exchange",
    ONEC_FTP_PASSWORD: "test-password",
    ONEC_FTP_BASE_PATH: "/LC",
    ONEC_FTP_TIMEOUT_MS: "15000",
    ONEC_SCHEDULED_EXCHANGE_APPLY: "true",
    ONEC_SCHEDULED_EXCHANGE_STABILITY_DELAY_MS: "0",
  };

  before(async () => {
    databaseUrl = getIntegrationDatabaseUrl();
    setIntegrationEnv(databaseUrl);
    await prepareDatabase(databaseUrl);
    pool = new Pool({ connectionString: databaseUrl, max: 3 });
    Object.assign(env, { DATABASE_URL: databaseUrl });
  });

  beforeEach(async () => {
    await pool.query("TRUNCATE onec_client_import_runs RESTART IDENTITY CASCADE");
    await pool.query("TRUNCATE onec_clients RESTART IDENTITY CASCADE");
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
  });

  after(async () => {
    await pool?.end();
  });

  it("bootstraps committed snapshot from journal when exchange state is empty after migration", async () => {
    const bytesA = buildClientsFileBytes([sampleClient({ name_client: "Legacy Snapshot A" })]);
    const bytesB = buildClientsFileBytes([sampleClient({ name_client: "Legacy Snapshot B" })]);
    const shaA = buildClientsFileSha256(JSON.parse(bytesA.toString("utf8")));
    const shaB = buildClientsFileSha256(JSON.parse(bytesB.toString("utf8")));

    await applyClientsImportVerified({ databaseUrl, payload: validatedPayload(bytesA) });

    await pool.query(`
      UPDATE onec_exchange_state
      SET
        last_successful_apply_at = NULL,
        last_successful_apply_sha256 = NULL,
        last_verified_at = NULL,
        last_verified_sha256 = NULL,
        last_checked_at = NULL,
        last_checked_sha256 = NULL,
        accepted_baseline_sha256 = NULL
    `);

    const client = await pool.connect();
    try {
      assert.equal(await getCommittedSnapshotSha(client), shaA);
    } finally {
      client.release();
    }

    const reader = async () => ({
      ok: true as const,
      bytes: bytesB,
      remotePath: "/LC/clients/all_clients.json",
    });

    const result = await runScheduledExchangeCycle({
      env: {
        ...env,
        ONEC_SCHEDULED_EXCHANGE_ACCEPTED_BASELINE_SHA256: shaB,
      },
      ftpReader: reader,
    });

    assert.notEqual(result.status, "SUPERSEDED_BY_NEWER_IMPORT");
    assert.equal(result.status, "SUCCESS");
    assert.equal(result.sha256, shaB);

    const row = await pool.query<{ name_client: string; source_sha256: string }>(
      "SELECT name_client, source_sha256 FROM onec_clients LIMIT 1",
    );
    assert.equal(row.rows[0]?.name_client, "Legacy Snapshot B");
    assert.equal(row.rows[0]?.source_sha256, shaB);

    const exchange = await pool.query<{ last_successful_apply_sha256: string | null }>(
      "SELECT last_successful_apply_sha256 FROM onec_exchange_state WHERE id = 1",
    );
    assert.equal(exchange.rows[0]?.last_successful_apply_sha256, shaB);
  });
});
