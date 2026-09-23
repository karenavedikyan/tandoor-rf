import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { Pool } from "pg";
import { applyClientsImport } from "../../src/onec-clients/apply";
import { IMPORT_ADVISORY_LOCK_KEY } from "../../src/onec-clients/constants";
import { validateClientsFileBytes } from "../../src/onec-clients/validate";
import { runClientsImport } from "../../src/onec-clients/run-import";
import {
  buildClientsFileBytes,
  buildClientsFileSha256,
  sampleClient,
  sampleClientTwo,
} from "../helpers/onec-clients-fixtures";
import {
  getIntegrationDatabaseUrl,
  prepareDatabase,
  setIntegrationEnv,
} from "../helpers/test-db";

function ftpEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ONEC_FTP_ENABLED: "true",
    ONEC_FTP_SECURITY: "plain",
    ONEC_FTP_HOST: "127.0.0.1",
    ONEC_FTP_PORT: "21",
    ONEC_FTP_USER: "lc_exchange",
    ONEC_FTP_PASSWORD: "test-password",
    ONEC_FTP_BASE_PATH: "/LC",
    ONEC_FTP_TIMEOUT_MS: "15000",
  };
}

describe("onec clients import integration", { concurrency: false }, () => {
  let databaseUrl = "";

  before(async () => {
    databaseUrl = getIntegrationDatabaseUrl();
    setIntegrationEnv(databaseUrl);
    await prepareDatabase(databaseUrl);
  });

  beforeEach(async () => {
    setIntegrationEnv(databaseUrl);
    await prepareDatabase(databaseUrl);
  });

  after(async () => {
    // no shared pool in this suite
  });

  it("dry-run validates without database access", async () => {
    const bytes = buildClientsFileBytes([sampleClient()]);
    const env = ftpEnv();
    delete env.DATABASE_URL;

    const result = await runClientsImport({
      env,
      argv: ["--dry-run"],
      fileBytes: bytes,
    });

    assert.equal(result.status, "SUCCESS");
    assert.equal(result.mode, "dry_run");
    assert.equal(result.apply, undefined);
  });

  it("apply rejects hash mismatch and missing hash", async () => {
    const bytes = buildClientsFileBytes([sampleClient()]);
    const env = { ...ftpEnv(), DATABASE_URL: databaseUrl };

    const missingHash = await runClientsImport({
      env,
      argv: ["--apply"],
      fileBytes: bytes,
    });
    assert.equal(missingHash.status, "ARGUMENT_ERROR");

    const mismatch = await runClientsImport({
      env,
      argv: ["--apply", "--expected-sha256", "0".repeat(64)],
      fileBytes: bytes,
    });
    assert.equal(mismatch.status, "HASH_MISMATCH");
  });

  it("imports, upserts without duplicates, and keeps missing clients", async () => {
    const initialBytes = buildClientsFileBytes([sampleClient(), sampleClientTwo()]);
    const hash = buildClientsFileSha256([sampleClient(), sampleClientTwo()]);
    const env = { ...ftpEnv(), DATABASE_URL: databaseUrl };

    const first = await runClientsImport({
      env,
      argv: ["--apply", "--expected-sha256", hash],
      fileBytes: initialBytes,
    });
    assert.equal(first.status, "SUCCESS");
    assert.equal(first.apply?.newCount, 2);
    assert.equal(first.apply?.changedCount, 0);

    const repeat = await runClientsImport({
      env,
      argv: ["--apply", "--expected-sha256", hash],
      fileBytes: initialBytes,
    });
    assert.equal(repeat.apply?.newCount, 0);
    assert.equal(repeat.apply?.unchangedCount, 2);

    const changedBytes = buildClientsFileBytes([
      sampleClient({ name_client: "Client Alpha Updated" }),
      sampleClientTwo(),
    ]);
    const changedHash = buildClientsFileSha256([
      sampleClient({ name_client: "Client Alpha Updated" }),
      sampleClientTwo(),
    ]);
    const changed = await runClientsImport({
      env,
      argv: ["--apply", "--expected-sha256", changedHash],
      fileBytes: changedBytes,
    });
    assert.equal(changed.apply?.changedCount, 1);

    const replacedBytes = buildClientsFileBytes([
      sampleClient({ name_client: "Client Alpha Updated" }),
      sampleClient({
        guid_client: "66666666-6666-4666-8666-666666666666",
        name_client: "Client Gamma",
      }),
    ]);
    const replacedHash = buildClientsFileSha256(JSON.parse(replacedBytes.toString("utf8")));
    const replaced = await runClientsImport({
      env,
      argv: ["--apply", "--expected-sha256", replacedHash],
      fileBytes: replacedBytes,
    });
    assert.equal(replaced.status, "SUCCESS");

    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    const count = await pool.query<{ count: string }>("SELECT COUNT(*)::text AS count FROM onec_clients");
    await pool.end();
    assert.equal(Number(count.rows[0]?.count), 3);
  });

  it("blocks apply when record count decreases", async () => {
    const env = { ...ftpEnv(), DATABASE_URL: databaseUrl };
    const fullBytes = buildClientsFileBytes([sampleClient(), sampleClientTwo()]);
    const fullHash = buildClientsFileSha256([sampleClient(), sampleClientTwo()]);
    await runClientsImport({
      env,
      argv: ["--apply", "--expected-sha256", fullHash],
      fileBytes: fullBytes,
    });

    const reducedBytes = buildClientsFileBytes([sampleClient()]);
    const reducedHash = buildClientsFileSha256([sampleClient()]);
    const reduced = await runClientsImport({
      env,
      argv: ["--apply", "--expected-sha256", reducedHash],
      fileBytes: reducedBytes,
    });
    assert.equal(reduced.status, "RECORD_COUNT_DECREASED");
  });

  it("rolls back client changes on database failure", async () => {
    const env = { ...ftpEnv(), DATABASE_URL: databaseUrl };
    const bytes = buildClientsFileBytes([sampleClient()]);
    const hash = buildClientsFileSha256([sampleClient()]);
    const validated = validateClientsFileBytes(bytes);
    assert.equal(validated.ok, true);
    if (!validated.ok) {
      return;
    }

    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    await pool.query("ALTER TABLE onec_clients DROP COLUMN name_client");
    await pool.end();

    const failed = await applyClientsImport({ databaseUrl, payload: validated.payload });
    assert.equal(failed.ok, false);

    await prepareDatabase(databaseUrl);
    const poolAfter = new Pool({ connectionString: databaseUrl, max: 1 });
    const count = await poolAfter.query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM onec_clients",
    );
    await poolAfter.end();
    assert.equal(Number(count.rows[0]?.count), 0);
  });

  it("blocks parallel apply while advisory lock is held", async () => {
    const env = { ...ftpEnv(), DATABASE_URL: databaseUrl };
    const bytes = buildClientsFileBytes([sampleClient()]);
    const hash = buildClientsFileSha256([sampleClient()]);
    const validated = validateClientsFileBytes(bytes);
    assert.equal(validated.ok, true);
    if (!validated.ok) {
      return;
    }

    const pool = new Pool({ connectionString: databaseUrl, max: 2 });
    const holder = await pool.connect();
    const locked = await holder.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_lock($1) AS locked",
      [IMPORT_ADVISORY_LOCK_KEY],
    );
    assert.equal(locked.rows[0]?.locked, true);

    const blocked = await applyClientsImport({ databaseUrl, payload: validated.payload });
    assert.equal(blocked.ok, false);
    if (!blocked.ok) {
      assert.equal(blocked.code, "IMPORT_LOCKED");
    }

    await holder.query("SELECT pg_advisory_unlock($1)", [IMPORT_ADVISORY_LOCK_KEY]);
    holder.release();
    await pool.end();
  });

  it("rejects apply while a stale running import exists", async () => {
    const env = { ...ftpEnv(), DATABASE_URL: databaseUrl };
    const bytes = buildClientsFileBytes([sampleClient()]);
    const hash = buildClientsFileSha256([sampleClient()]);
    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    await pool.query(
      `
        INSERT INTO onec_client_import_runs (status, mode, source_sha256, source_record_count)
        VALUES ('running', 'apply', $1, 1)
      `,
      [hash],
    );
    await pool.end();

    const result = await runClientsImport({
      env,
      argv: ["--apply", "--expected-sha256", hash],
      fileBytes: bytes,
    });
    assert.equal(result.status, "STALE_RUNNING_IMPORT");
  });
});
