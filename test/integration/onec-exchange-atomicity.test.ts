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

describe("onec exchange apply atomicity", { concurrency: false }, () => {
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
    pool = new Pool({ connectionString: databaseUrl, max: 4 });
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

  it("does not leave a partial snapshot when exchange state update fails inside the transaction", async () => {
    const bytes = buildClientsFileBytes([sampleClient({ name_client: "Atomic Client" })]);
    const payload = validatedPayload(bytes);

    const result = await applyClientsImportVerified({
      databaseUrl,
      payload,
      testHooks: { failExchangeStateUpdate: true },
    });

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, "DATABASE_ERROR");
    }

    const clients = await pool.query("SELECT COUNT(*)::int AS count FROM onec_clients");
    assert.equal(clients.rows[0]?.count, 0);

    const journal = await pool.query<{ status: string }>(
      "SELECT status FROM onec_client_import_runs WHERE mode = 'apply' ORDER BY started_at DESC LIMIT 1",
    );
    assert.notEqual(journal.rows[0]?.status, "success");

    const exchange = await pool.query<{ last_successful_apply_sha256: string | null }>(
      "SELECT last_successful_apply_sha256 FROM onec_exchange_state WHERE id = 1",
    );
    assert.equal(exchange.rows[0]?.last_successful_apply_sha256, null);
  });

  it("blocks apply after commit response loss and does not skip the next verified update", async () => {
    const bytesA = buildClientsFileBytes([sampleClient({ name_client: "Snapshot A" })]);
    const bytesB = buildClientsFileBytes([sampleClient({ name_client: "Snapshot B" })]);
    const shaA = buildClientsFileSha256(JSON.parse(bytesA.toString("utf8")));
    const shaB = buildClientsFileSha256(JSON.parse(bytesB.toString("utf8")));
    const payloadA = validatedPayload(bytesA);

    await applyClientsImportVerified({ databaseUrl, payload: payloadA });

    const uncertain = await applyClientsImportVerified({
      databaseUrl,
      payload: validatedPayload(bytesB),
      expectedCommittedSha256: shaA,
      testHooks: { failCommit: true },
    });
    assert.equal(uncertain.ok, false);
    if (!uncertain.ok) {
      assert.equal(uncertain.code, "COMMIT_UNCERTAIN");
    }

    const blocked = await pool.query<{ apply_blocked: boolean }>(
      "SELECT apply_blocked FROM onec_exchange_state WHERE id = 1",
    );
    assert.equal(blocked.rows[0]?.apply_blocked, true);

    const blockedApply = await applyClientsImportVerified({
      databaseUrl,
      payload: validatedPayload(bytesB),
      expectedCommittedSha256: shaA,
    });
    assert.equal(blockedApply.ok, false);
    if (!blockedApply.ok) {
      assert.equal(blockedApply.code, "APPLY_BLOCKED");
    }

    const client = await pool.connect();
    try {
      await client.query(
        `
          UPDATE onec_exchange_state
          SET apply_blocked = false, apply_blocked_reason = NULL
          WHERE id = 1
        `,
      );
      await client.query(
        `
          UPDATE onec_client_import_runs
          SET status = 'failed', finished_at = NOW(), error_code = 'COMMIT_UNCERTAIN'
          WHERE status = 'running'
        `,
      );
    } finally {
      client.release();
    }

    const recovered = await applyClientsImportVerified({
      databaseUrl,
      payload: validatedPayload(bytesB),
      expectedCommittedSha256: shaA,
    });
    assert.equal(recovered.ok, true);

    let reads = 0;
    const reader = async () => {
      reads += 1;
      return { ok: true as const, bytes: bytesB, remotePath: "/LC/clients/all_clients.json" };
    };

    const cycle = await runScheduledExchangeCycle({
      env: { ...env, ONEC_SCHEDULED_EXCHANGE_APPLY: "false" },
      ftpReader: reader,
    });
    assert.equal(cycle.status, "SKIPPED_UNCHANGED");
    assert.equal(reads, 2);

    const row = await pool.query<{ name_client: string; source_sha256: string }>(
      "SELECT name_client, source_sha256 FROM onec_clients LIMIT 1",
    );
    assert.equal(row.rows[0]?.name_client, "Snapshot B");
    assert.equal(row.rows[0]?.source_sha256, shaB);
  });

  it("keeps journal, clients and exchange state aligned after a successful commit", async () => {
    const bytes = buildClientsFileBytes([sampleClient({ name_client: "Aligned Snapshot" })]);
    const payload = validatedPayload(bytes);

    const result = await applyClientsImportVerified({ databaseUrl, payload });
    assert.equal(result.ok, true);

    const client = await pool.connect();
    try {
      const committed = await getCommittedSnapshotSha(client);
      assert.equal(committed, payload.sha256);
    } finally {
      client.release();
    }

    const journal = await pool.query<{ status: string; source_sha256: string }>(
      "SELECT status, source_sha256 FROM onec_client_import_runs WHERE mode = 'apply' ORDER BY finished_at DESC LIMIT 1",
    );
    assert.equal(journal.rows[0]?.status, "success");
    assert.equal(journal.rows[0]?.source_sha256, payload.sha256);
  });
});
