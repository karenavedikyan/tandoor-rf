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
    setIntegrationEnv(databaseUrl);
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
    assert.equal(proxy!.stats.commitsObserved >= 1, true);
    assert.equal(proxy!.stats.commitsForwarded >= 1, true);
    assert.equal(proxy!.stats.commitResponsesDropped >= 1, true);

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
    assert.equal(proxy!.stats.commitsBlocked >= 1, true);

    const clients = await directPool.query("SELECT COUNT(*)::int AS count FROM onec_clients");
    assert.equal(clients.rows[0]?.count, 0);

    const blocked = (
      await directPool.query<{ apply_blocked: boolean }>(
        "SELECT apply_blocked FROM onec_exchange_state WHERE id = 1",
      )
    ).rows[0];
    assert.equal(blocked?.apply_blocked, true);
  });

  it("finishes parent and child journals after scheduled apply COMMIT proxy drop", async () => {
    const proxiedUrl = await startProxy("drop_commit_response");
    const bytesA = buildClientsFileBytes([sampleClient({ name_client: "Scheduled TCP A" })]);
    const bytesB = buildClientsFileBytes([sampleClient({ name_client: "Scheduled TCP B" })]);
    const shaA = buildClientsFileSha256(JSON.parse(bytesA.toString("utf8")));
    const shaB = buildClientsFileSha256(JSON.parse(bytesB.toString("utf8")));
    let reads = 0;
    const readerA = async () => {
      reads += 1;
      return { ok: true as const, bytes: bytesA, remotePath: "/LC/clients/all_clients.json" };
    };

    const first = await runScheduledExchangeCycle({
      env: {
        ...ftpEnvBase,
        DATABASE_URL: proxiedUrl,
        ONEC_SCHEDULED_EXCHANGE_ACCEPTED_BASELINE_SHA256: shaA,
      },
      ftpReader: readerA,
    });

    assert.equal(first.status, "SUCCESS", JSON.stringify(first));
    assert.equal(reads, 2);
    assert.equal(proxy!.stats.commitsObserved >= 1, true);
    assert.equal(proxy!.stats.commitsForwarded >= 1, true);
    assert.equal(proxy!.stats.commitResponsesDropped >= 1, true);

    const applyRuns = await directPool.query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM onec_client_import_runs WHERE mode = 'apply' AND status = 'success'",
    );
    assert.equal(Number(applyRuns.rows[0]?.count ?? "0"), 1);

    const parent = (
      await directPool.query<{ status: string; stage: string }>(
        `
          SELECT status, stage
          FROM onec_client_import_runs
          WHERE mode = 'scheduled_check'
          ORDER BY started_at DESC
          LIMIT 1
        `,
      )
    ).rows[0];
    assert.equal(parent?.status, "success");
    assert.equal(parent?.stage, "apply");

    const child = (
      await directPool.query<{ status: string; source_sha256: string; parent_run_id: string | null }>(
        `
          SELECT status, source_sha256, parent_run_id::text
          FROM onec_client_import_runs
          WHERE mode = 'apply'
          ORDER BY started_at DESC
          LIMIT 1
        `,
      )
    ).rows[0];
    assert.equal(child?.status, "success");
    assert.equal(child?.source_sha256, shaA);
    assert.equal(child?.parent_run_id, first.checkRunId);

    const row = await directPool.query<{ name_client: string; source_sha256: string }>(
      "SELECT name_client, source_sha256 FROM onec_clients LIMIT 1",
    );
    assert.equal(row.rows[0]?.name_client, "Scheduled TCP A");
    assert.equal(row.rows[0]?.source_sha256, shaA);

    await proxy.close();
    proxy = undefined;

    reads = 0;
    const readerB = async () => {
      reads += 1;
      return { ok: true as const, bytes: bytesB, remotePath: "/LC/clients/all_clients.json" };
    };

    const second = await runScheduledExchangeCycle({
      env: {
        ...ftpEnvBase,
        DATABASE_URL: databaseUrl,
        ONEC_SCHEDULED_EXCHANGE_APPLY: "false",
      },
      ftpReader: readerB,
    });

    assert.notEqual(second.status, "STALE_RUNNING_IMPORT");
    assert.equal(second.status, "PENDING_APPLY");
    assert.equal(reads, 2);

    const running = await directPool.query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM onec_client_import_runs WHERE status = 'running'",
    );
    assert.equal(Number(running.rows[0]?.count ?? "0"), 0);
  });

  it("propagates TCP commit-response recovery through operator apply job via proxied env", async () => {
    const proxiedUrl = await startProxy("drop_commit_response");
    const bytes = buildClientsFileBytes([sampleClient({ name_client: "Operator TCP Success" })]);
    const sha = buildClientsFileSha256(JSON.parse(bytes.toString("utf8")));

    const jobPool = new Pool({ connectionString: proxiedUrl, max: 1 });
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

      assert.equal(proxy!.stats.commitsObserved >= 1, true);
      assert.equal(proxy!.stats.commitsForwarded >= 1, true);
      assert.equal(proxy!.stats.commitResponsesDropped >= 1, true);

      const job = (await directPool.query("SELECT status, result FROM onec_import_jobs")).rows[0];
      assert.equal(job?.status, "success", JSON.stringify(job?.result));
      assert.equal(job?.result?.status, "SUCCESS");

      const applyRun = (
        await directPool.query<{ status: string; source_sha256: string }>(
          "SELECT status, source_sha256 FROM onec_client_import_runs WHERE mode = 'apply' ORDER BY started_at DESC LIMIT 1",
        )
      ).rows[0];
      assert.equal(applyRun?.status, "success");
      assert.equal(applyRun?.source_sha256, sha);
    } finally {
      await jobPool.end();
    }
  });
});
