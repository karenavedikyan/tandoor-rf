import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { Pool } from "pg";
import { applyClientsImport } from "../../src/onec-clients/apply";
import { MAX_DETAILED_WARNINGS } from "../../src/onec-clients/constants";
import type { ValidationWarning } from "../../src/onec-clients/types";
import { validateClientsFileBytes } from "../../src/onec-clients/validate";
import { runOneImportJob } from "../../src/onec-import/worker";
import { runScheduledExchangeCycle } from "../../src/onec-scheduled-exchange/run-cycle";
import {
  buildClientsFileBytes,
  buildClientsFileSha256,
  sampleClient,
  sampleClientTwo,
} from "../helpers/onec-clients-fixtures";
import { getIntegrationDatabaseUrl, prepareDatabase, setIntegrationEnv } from "../helpers/test-db";

function buildWarnings(count: number): ValidationWarning[] {
  return Array.from({ length: count }, (_, index) => ({
    code: "EXTRA_FIELDS",
    field: "extra",
    index,
    message: `warning-${index}-${"x".repeat(200)}`,
  }));
}

function payloadWithWarnings(warningCount: number) {
  const clients = [sampleClient()];
  const bytes = buildClientsFileBytes(clients);
  const validated = validateClientsFileBytes(bytes);
  assert.equal(validated.ok, true);
  if (!validated.ok) {
    throw new Error("validation failed");
  }
  return {
    ...validated.payload,
    warnings: buildWarnings(warningCount),
    warningCount,
  };
}

describe("onec journal warnings truncation", { concurrency: false }, () => {
  let pool: Pool;
  let databaseUrl = "";

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

  before(async () => {
    databaseUrl = getIntegrationDatabaseUrl();
    setIntegrationEnv(databaseUrl);
    await prepareDatabase(databaseUrl);
    pool = new Pool({ connectionString: databaseUrl, max: 3 });
    Object.assign(env, { DATABASE_URL: databaseUrl });
  });

  beforeEach(async () => {
    await pool.query("TRUNCATE onec_import_jobs RESTART IDENTITY CASCADE");
    await pool.query("TRUNCATE onec_client_import_runs RESTART IDENTITY CASCADE");
    await pool.query("TRUNCATE onec_clients RESTART IDENTITY CASCADE");
  });

  after(async () => {
    await pool?.end();
  });

  async function readLatestApplyJournal() {
    return (
      await pool.query<{
        warning_count: number | null;
        warnings_truncated: boolean;
        warnings: unknown;
      }>(
        `
          SELECT warning_count, warnings_truncated, warnings
          FROM onec_client_import_runs
          WHERE mode = 'apply'
          ORDER BY started_at DESC
          LIMIT 1
        `,
      )
    ).rows[0];
  }

  it("truncates manual apply warnings while preserving full warning_count", async () => {
    const payload = payloadWithWarnings(200);
    const result = await applyClientsImport({ databaseUrl, payload });
    assert.equal(result.ok, true);

    const journal = await readLatestApplyJournal();
    assert.equal(journal?.warning_count, 200);
    assert.equal(journal?.warnings_truncated, true);
    assert.equal(Array.isArray(journal?.warnings), true);
    assert.equal((journal?.warnings as unknown[]).length, MAX_DETAILED_WARNINGS);
    assert.ok(Buffer.byteLength(JSON.stringify(journal?.warnings), "utf8") <= 65_536);
  });

  it("truncates rejected apply journal warnings", async () => {
    const validatedTwo = validateClientsFileBytes(
      buildClientsFileBytes([sampleClient(), sampleClientTwo()]),
    );
    assert.equal(validatedTwo.ok, true);
    if (!validatedTwo.ok) {
      return;
    }
    await applyClientsImport({ databaseUrl, payload: validatedTwo.payload });

    const shrinkPayload = payloadWithWarnings(200);
    shrinkPayload.records = [shrinkPayload.records[0]!];

    const result = await applyClientsImport({ databaseUrl, payload: shrinkPayload });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, "RECORD_COUNT_DECREASED");
    }

    const journal = await readLatestApplyJournal();
    assert.equal(journal?.warning_count, 200);
    assert.equal(journal?.warnings_truncated, true);
    assert.equal((journal?.warnings as unknown[]).length, MAX_DETAILED_WARNINGS);
  });

  function buildManyWarningClientsBytes(count: number): Buffer {
    const clients = Array.from({ length: count }, (_, index) => ({
      ...sampleClient({
        guid_client: `11111111-1111-4111-8111-${index.toString(16).padStart(12, "0")}`,
        name_client: `Client ${index}`,
      }),
      unexpected_field: `extra-${index}`,
    }));
    return buildClientsFileBytes(clients);
  }

  it("truncates scheduled child apply warnings", async () => {
    const bytes = buildManyWarningClientsBytes(200);
    const sha = buildClientsFileSha256(JSON.parse(bytes.toString("utf8")));
    const reader = async () => ({
      ok: true as const,
      bytes,
      remotePath: "/LC/clients/all_clients.json",
    });

    const result = await runScheduledExchangeCycle({
      env: {
        ...env,
        ONEC_SCHEDULED_EXCHANGE_ACCEPTED_BASELINE_SHA256: sha,
      },
      ftpReader: reader,
    });

    assert.equal(result.status, "SUCCESS");

    const applyJournal = await readLatestApplyJournal();
    assert.equal(applyJournal?.warning_count, 200);
    assert.equal(applyJournal?.warnings_truncated, true);

    const cycleJournal = (
      await pool.query<{
        warning_count: number | null;
        warnings_truncated: boolean;
        warnings: unknown;
      }>(
        `
          SELECT warning_count, warnings_truncated, warnings
          FROM onec_client_import_runs
          WHERE mode = 'scheduled_check'
          ORDER BY started_at DESC
          LIMIT 1
        `,
      )
    ).rows[0];
    assert.equal(cycleJournal?.warning_count, 200);
    assert.equal(cycleJournal?.warnings_truncated, true);
  });

  it("truncates operator job apply warnings", async () => {
    const bytes = buildManyWarningClientsBytes(200);
    const sha = buildClientsFileSha256(JSON.parse(bytes.toString("utf8")));

    await pool.query(
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

    assert.equal(await runOneImportJob(pool, env, reader), "success");

    const journal = await readLatestApplyJournal();
    assert.equal(journal?.warning_count, 200);
    assert.equal(journal?.warnings_truncated, true);
  });
});
