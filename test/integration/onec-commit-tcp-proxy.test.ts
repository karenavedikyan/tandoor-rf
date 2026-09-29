import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { Pool } from "pg";
import { applyClientsImport } from "../../src/onec-clients/apply";
import { validateClientsFileBytes } from "../../src/onec-clients/validate";
import { runOneImportJob } from "../../src/onec-import/worker";
import { runScheduledExchangeCycle } from "../../src/onec-scheduled-exchange/run-cycle";
import { getCommittedSnapshotSha } from "../../src/onec-exchange/state";
import {
  buildClientsFileBytes,
  buildClientsFileSha256,
  sampleClient,
} from "../helpers/onec-clients-fixtures";
import {
  buildProxiedDatabaseUrl,
  startPgTcpProxy,
  type PgTcpProxy,
} from "../helpers/pg-tcp-proxy";
import { getIntegrationDatabaseUrl, prepareDatabase, setIntegrationEnv } from "../helpers/test-db";

function validatedPayload(bytes: Buffer) {
  const validated = validateClientsFileBytes(bytes);
  assert.equal(validated.ok, true);
  if (!validated.ok) {
    throw new Error("validation failed");
  }
  return validated.payload;
}

describe("commit TCP proxy recovery", { concurrency: false }, () => {
  let directPool: Pool;
  let databaseUrl = "";
  let proxy: PgTcpProxy | undefined;

  const ftpEnvBase = {
    ONEC_FTP_ENABLED: "true",
    ONEC_FTP_SECURITY: "plain",
    ONEC_FTP_HOST: "gw.toopatch.ru",
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
    directPool = new Pool({ connectionString: databaseUrl, max: 4 });
  });

  beforeEach(async () => {
    if (proxy) {
      await proxy.close();
      proxy = undefined;
    }
    await directPool.query("TRUNCATE onec_import_jobs RESTART IDENTITY CASCADE");
    await directPool.query("TRUNCATE onec_client_import_runs RESTART IDENTITY CASCADE");
    await directPool.query("TRUNCATE onec_clients RESTART IDENTITY CASCADE");
    await directPool.query(`
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
    if (proxy) {
      await proxy.close();
    }
    await directPool?.end();
  });

  async function startProxy(mode: "drop_commit_response" | "drop_before_commit") {
    proxy = await startPgTcpProxy(databaseUrl, mode);
    return buildProxiedDatabaseUrl(databaseUrl, proxy.port);
  }

  it("recovers success after PostgreSQL accepts COMMIT but the client loses the response", async () => {
    const proxiedUrl = await startProxy("drop_commit_response");
    const bytes = buildClientsFileBytes([sampleClient({ name_client: "TCP Commit Success" })]);
    const payload = validatedPayload(bytes);

    const result = await applyClientsImport({
      databaseUrl: proxiedUrl,
      payload,
    });

    assert.equal(result.ok, true, JSON.stringify(result));
    if (result.ok) {
      assert.ok(result.cleanupWarning);
    }

    const journal = (
      await directPool.query<{ status: string; source_sha256: string }>(
        "SELECT status, source_sha256 FROM onec_client_import_runs WHERE mode = 'apply' ORDER BY started_at DESC LIMIT 1",
      )
    ).rows[0];
    assert.equal(journal?.status, "success");
    assert.equal(journal?.source_sha256, payload.sha256);

    const client = await directPool.connect();
    try {
      assert.equal(await getCommittedSnapshotSha(client), payload.sha256);
    } finally {
      client.release();
    }

    const blocked = (
      await directPool.query<{ apply_blocked: boolean }>(
        "SELECT apply_blocked FROM onec_exchange_state WHERE id = 1",
      )
    ).rows[0];
    assert.equal(blocked?.apply_blocked, false);
  });

  it("blocks apply when TCP drops before PostgreSQL accepts COMMIT", async () => {
    const proxiedUrl = await startProxy("drop_before_commit");
    const bytes = buildClientsFileBytes([sampleClient({ name_client: "TCP Commit Lost" })]);
    const payload = validatedPayload(bytes);

    const result = await applyClientsImport({
      databaseUrl: proxiedUrl,
      payload,
    });

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, "COMMIT_UNCERTAIN");
    }

    const clients = await directPool.query("SELECT COUNT(*)::int AS count FROM onec_clients");
    assert.equal(clients.rows[0]?.count, 0);

    const blocked = (
      await directPool.query<{ apply_blocked: boolean }>(
        "SELECT apply_blocked FROM onec_exchange_state WHERE id = 1",
      )
    ).rows[0];
    assert.equal(blocked?.apply_blocked, true);
  });

  it("propagates TCP commit-response recovery through scheduled child apply", async () => {
    const proxiedUrl = await startProxy("drop_commit_response");
    const bytes = buildClientsFileBytes([sampleClient({ name_client: "Scheduled TCP Success" })]);
    const sha = buildClientsFileSha256(JSON.parse(bytes.toString("utf8")));
    let reads = 0;
    const reader = async () => {
      reads += 1;
      return { ok: true as const, bytes, remotePath: "/LC/clients/all_clients.json" };
    };

    setIntegrationEnv(databaseUrl);
    const result = await runScheduledExchangeCycle({
      env: {
        ...ftpEnvBase,
        DATABASE_URL: proxiedUrl,
        ONEC_SCHEDULED_EXCHANGE_ACCEPTED_BASELINE_SHA256: sha,
      },
      ftpReader: reader,
    });

    assert.equal(result.status, "SUCCESS");
    assert.equal(reads, 2);
    assert.equal(
      (await directPool.query("SELECT COUNT(*)::int AS count FROM onec_clients")).rows[0]?.count,
      1,
    );
  });

  it("propagates TCP commit-response recovery through operator apply job", async () => {
    const proxiedUrl = await startProxy("drop_commit_response");
    const bytes = buildClientsFileBytes([sampleClient({ name_client: "Operator TCP Success" })]);
    const sha = buildClientsFileSha256(JSON.parse(bytes.toString("utf8")));

    setIntegrationEnv(databaseUrl);
    const jobPool = new Pool({ connectionString: proxiedUrl, max: 2 });
    try {
      await directPool.query(
        `
          INSERT INTO onec_import_jobs (mode, expected_sha256, expires_at)
          VALUES ('apply', $1, NOW() + INTERVAL '1 hour')
        `,
        [sha],
      );

      const reader = async () => ({
        ok: true as const,
        bytes,
        remotePath: "/LC/clients/all_clients.json",
      });

      assert.equal(
        await runOneImportJob(jobPool, { ...ftpEnvBase, DATABASE_URL: proxiedUrl }, reader),
        "success",
      );

      const job = (await directPool.query("SELECT status, result FROM onec_import_jobs")).rows[0];
      assert.equal(job?.status, "success", JSON.stringify(job?.result));
      assert.equal(job?.result?.status, "SUCCESS");
    } finally {
      await jobPool.end();
    }
  });
});
