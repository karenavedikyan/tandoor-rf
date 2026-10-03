import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { Pool } from "pg";
import { applyClientsImport } from "../../src/onec-clients/apply";
import { tryAcquireImportLock, releaseImportLock } from "../../src/onec-clients/import-lock";
import { runScheduledExchangeCycle } from "../../src/onec-scheduled-exchange/run-cycle";
import { validateClientsFileBytes } from "../../src/onec-clients/validate";
import {
  buildClientsFileBytes,
  buildClientsFileSha256,
  sampleClient, applyClientsImportVerified} from "../helpers/onec-clients-fixtures";
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
  ONEC_SCHEDULED_EXCHANGE_APPLY: "true",
  ONEC_SCHEDULED_EXCHANGE_STABILITY_DELAY_MS: "0",
};

function validatedPayload(bytes: Buffer) {
  const validated = validateClientsFileBytes(bytes);
  assert.equal(validated.ok, true);
  if (!validated.ok) {
    throw new Error("validation failed");
  }
  return validated.payload;
}

describe("scheduled exchange concurrency", { concurrency: false }, () => {
  let pool: Pool;
  let databaseUrl = "";

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

  it("holds the import lock through verify and blocks manual apply during the cycle", async () => {
    const bytesA = buildClientsFileBytes([sampleClient({ name_client: "Snapshot A" })]);
    const bytesB = buildClientsFileBytes([sampleClient({ name_client: "Snapshot B" })]);
    const shaA = buildClientsFileSha256(JSON.parse(bytesA.toString("utf8")));
    const payloadB = validatedPayload(bytesB);
    let reads = 0;

    const reader = async () => {
      reads += 1;
      if (reads === 2) {
        const manual = await applyClientsImportVerified({
          databaseUrl,
          payload: payloadB,
          triggerSource: "manual",
        });
        assert.equal(manual.ok, false);
        assert.equal(manual.code, "IMPORT_LOCKED");
      }
      return { ok: true as const, bytes: bytesA, remotePath: "/LC/clients/all_clients.json" };
    };

    const result = await runScheduledExchangeCycle({
      env: {
        ...env,
        ONEC_SCHEDULED_EXCHANGE_ACCEPTED_BASELINE_SHA256: shaA,
      },
      ftpReader: reader,
    });

    assert.equal(result.status, "SUCCESS");
    assert.equal(reads, 2);
  });

  it("refuses apply when committed snapshot changed after verification", async () => {
    const bytesA = buildClientsFileBytes([sampleClient({ name_client: "Snapshot A" })]);
    const bytesB = buildClientsFileBytes([sampleClient({ name_client: "Snapshot B" })]);
    const bytesC = buildClientsFileBytes([sampleClient({ name_client: "Snapshot C" })]);
    const shaB = buildClientsFileSha256(JSON.parse(bytesB.toString("utf8")));

    await applyClientsImportVerified({
      databaseUrl,
      payload: validatedPayload(bytesB),
      triggerSource: "manual",
    });
    await applyClientsImportVerified({
      databaseUrl,
      payload: validatedPayload(bytesC),
      triggerSource: "manual",
    });

    const client = await pool.connect();
    assert.equal(await tryAcquireImportLock(client), true);
    try {
      const result = await applyClientsImportVerified({
        client,
        payload: validatedPayload(bytesA),
        lockAlreadyHeld: true,
        retainLock: true,
        expectedCommittedSha256: shaB,
        triggerSource: "scheduled",
        syncExchangeState: false,
      });
      assert.equal(result.ok, false);
      assert.equal(result.code, "SUPERSEDED_BY_NEWER_IMPORT");
    } finally {
      await releaseImportLock(client);
      client.release();
    }

    const row = (
      await pool.query<{ name_client: string }>("SELECT name_client FROM onec_clients LIMIT 1")
    ).rows[0];
    assert.equal(row?.name_client, "Snapshot C");
  });

  it("does not skip when FTP matches an older verified SHA but DB has a newer commit", async () => {
    const bytesA = buildClientsFileBytes([sampleClient({ name_client: "Snapshot A" })]);
    const bytesB = buildClientsFileBytes([sampleClient({ name_client: "Snapshot B" })]);
    const shaA = buildClientsFileSha256(JSON.parse(bytesA.toString("utf8")));
    const shaB = buildClientsFileSha256(JSON.parse(bytesB.toString("utf8")));

    await applyClientsImportVerified({
      databaseUrl,
      payload: validatedPayload(bytesA),
      triggerSource: "manual",
    });
    await applyClientsImportVerified({
      databaseUrl,
      payload: validatedPayload(bytesB),
      triggerSource: "manual",
    });

    const reader = async () => ({
      ok: true as const,
      bytes: bytesA,
      remotePath: "/LC/clients/all_clients.json",
    });

    const result = await runScheduledExchangeCycle({
      env: { ...env, ONEC_SCHEDULED_EXCHANGE_APPLY: "false" },
      ftpReader: reader,
    });

    assert.notEqual(result.status, "SKIPPED_UNCHANGED");
    assert.equal(result.status, "PENDING_APPLY");
    assert.equal(result.sha256, shaA);

    const row = (
      await pool.query<{ name_client: string; source_sha256: string }>(
        "SELECT name_client, source_sha256 FROM onec_clients LIMIT 1",
      )
    ).rows[0];
    assert.equal(row?.name_client, "Snapshot B");
    assert.equal(row?.source_sha256, shaB);
  });
});
