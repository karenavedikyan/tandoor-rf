import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { Pool, type PoolClient, type QueryResult } from "pg";
import { closePool, requirePool, resetPoolForTests } from "../../src/db/pool";
import {
  loadValidatedBundleFromBytes,
  runExchangeV3CleanStartApply,
} from "../../src/onec-exchange-v3/clean-start";
import { computeTargetDbFingerprint } from "../../src/onec-exchange-v3/target-db-fingerprint";
import { insertSuccessfulImportRun } from "../helpers/clients-db-fixtures";
import { getIntegrationDatabaseUrl, prepareDatabase, setIntegrationEnv } from "../helpers/test-db";
import { buildEmployeeRosterBytes, buildEmployeeRosterEntry } from "../helpers/onec-clients-employee-roster-fixtures";

const MANAGER = "22222222-2222-4222-8222-222222222222";
const FIXTURE_DIR = path.join(process.cwd(), "test/fixtures/onec-exchange-v3");

function queryText(input: string | { text: string }): string {
  return (typeof input === "string" ? input : input.text).trim();
}

function instrumentPoolClient(
  client: PoolClient,
  options?: { failResetWithQueryReadTimeout?: boolean },
): {
  queryLog: string[];
  releaseCalls: boolean[];
} {
  const queryLog: string[] = [];
  const releaseCalls: boolean[] = [];
  const originalQuery = client.query.bind(client);
  client.query = ((...args: Parameters<PoolClient["query"]>) => {
    const first = args[0];
    let text = "";
    if (typeof first === "string") {
      text = queryText(first);
    } else if (first && typeof first === "object" && "text" in first) {
      text = queryText(first as { text: string });
    }
    if (text) {
      queryLog.push(text);
    }
    if (options?.failResetWithQueryReadTimeout && text.includes("RESET statement_timeout")) {
      throw new Error("Query read timeout");
    }
    return originalQuery(...args) as Promise<QueryResult>;
  }) as PoolClient["query"];
  const originalRelease = client.release.bind(client);
  client.release = (err?: boolean | Error) => {
    releaseCalls.push(err === true);
    return originalRelease(err);
  };
  return { queryLog, releaseCalls };
}

describe("exchange v3 clean start apply cleanup", { concurrency: false }, () => {
  let databaseUrl = "";

  before(async () => {
    databaseUrl = getIntegrationDatabaseUrl();
    setIntegrationEnv(databaseUrl);
    await prepareDatabase(databaseUrl);
  });

  after(async () => {
    await closePool();
  });

  async function validatedBundle() {
    return loadValidatedBundleFromBytes({
      holdingsBytes: fs.readFileSync(path.join(FIXTURE_DIR, "all_holding.json")),
      clientsBytes: fs.readFileSync(path.join(FIXTURE_DIR, "all_clients.json")),
      retailBytes: fs.readFileSync(path.join(FIXTURE_DIR, "all_retail.json")),
      employeesBytes: buildEmployeeRosterBytes([
        buildEmployeeRosterEntry(MANAGER, { name_manager: "Manager One" }),
      ]),
    });
  }

  it("runExchangeV3CleanStartApply stops before BEGIN when RESET fails after successful identity", async () => {
    await prepareDatabase(databaseUrl);
    await insertSuccessfulImportRun(databaseUrl);
    const seed = new Pool({ connectionString: databaseUrl, max: 1 });
    await seed.query(
      `
        INSERT INTO onec_clients (guid_client, name_client, guid_holding, name_holding, guid_manager, name_manager, address, telephone, last_imported_at, source_sha256)
        VALUES ($1::uuid, 'Legacy Reset', $1::uuid, 'H', $2::uuid, 'Mgr', '', '[]'::jsonb, NOW(), repeat('e', 64))
        ON CONFLICT (guid_client) DO NOTHING
      `,
      ["f1000000-0000-4000-8000-000000000001", MANAGER],
    );
    const legacyBefore = Number((await seed.query(`SELECT COUNT(*)::int AS c FROM onec_clients`)).rows[0]?.c ?? 0);
    await seed.end();

    const validated = await validatedBundle();
    assert.equal(validated.ok, true);
    if (!validated.ok) return;

    const pool = requirePool();
    const originalConnect = pool.connect.bind(pool);
    let queryLog: string[] = [];
    let releaseCalls: boolean[] = [];
    pool.connect = (async () => {
      const client = await originalConnect();
      const instrumented = instrumentPoolClient(client, { failResetWithQueryReadTimeout: true });
      queryLog = instrumented.queryLog;
      releaseCalls = instrumented.releaseCalls;
      return client;
    }) as typeof pool.connect;

    const targetFp = (await computeTargetDbFingerprint(databaseUrl))!;
    const result = await runExchangeV3CleanStartApply({
      databaseUrl,
      bundle: validated.bundle,
      confirmTargetDbFingerprint: targetFp,
      confirmBundleFingerprint: validated.bundle.bundleFingerprint,
    });

    pool.connect = originalConnect;
    await resetPoolForTests();

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.message, /RESET statement_timeout/i);
    assert.equal(queryLog.some((q) => /^BEGIN\b/i.test(q)), false);
    assert.equal(releaseCalls.length, 1);
    assert.equal(releaseCalls[0], true);
    const resetIndex = queryLog.findIndex((q) => q.includes("RESET statement_timeout"));
    assert.ok(resetIndex >= 0);
    assert.equal(queryLog.slice(resetIndex + 1).length, 0);

    const verify = new Pool({ connectionString: databaseUrl, max: 1 });
    const legacyAfter = Number((await verify.query(`SELECT COUNT(*)::int AS c FROM onec_clients`)).rows[0]?.c ?? 0);
    await verify.end();
    assert.equal(legacyAfter, legacyBefore);
  });

  it("successful COMMIT stays ok when unlock cleanup fails with generic SQL error", async () => {
    await prepareDatabase(databaseUrl);
    const validated = await validatedBundle();
    assert.equal(validated.ok, true);
    if (!validated.ok) return;

    const pool = requirePool();
    const originalConnect = pool.connect.bind(pool);
    let releaseCalls: boolean[] = [];
    pool.connect = (async () => {
      const client = await originalConnect();
      releaseCalls = instrumentPoolClient(client).releaseCalls;
      return client;
    }) as typeof pool.connect;

    const targetFp = (await computeTargetDbFingerprint(databaseUrl))!;
    const result = await runExchangeV3CleanStartApply({
      databaseUrl,
      bundle: validated.bundle,
      confirmTargetDbFingerprint: targetFp,
      confirmBundleFingerprint: validated.bundle.bundleFingerprint,
      testHooks: { simulateLockReleaseSqlError: true },
    });

    pool.connect = originalConnect;
    await resetPoolForTests();

    assert.equal(result.ok, true);
    assert.equal(releaseCalls.length, 1);
    assert.equal(releaseCalls[0], true);
  });

  it("apply error path discards client when ROLLBACK cleanup fails with generic SQL error", async () => {
    await prepareDatabase(databaseUrl);
    const validated = await validatedBundle();
    assert.equal(validated.ok, true);
    if (!validated.ok) return;

    const pool = requirePool();
    const originalConnect = pool.connect.bind(pool);
    let releaseCalls: boolean[] = [];
    pool.connect = (async () => {
      const client = await originalConnect();
      releaseCalls = instrumentPoolClient(client).releaseCalls;
      return client;
    }) as typeof pool.connect;

    const targetFp = (await computeTargetDbFingerprint(databaseUrl))!;
    const result = await runExchangeV3CleanStartApply({
      databaseUrl,
      bundle: validated.bundle,
      confirmTargetDbFingerprint: targetFp,
      confirmBundleFingerprint: validated.bundle.bundleFingerprint,
      testHooks: { failAfter: "purge_legacy", simulateRollbackSqlError: true },
    });

    pool.connect = originalConnect;
    await resetPoolForTests();

    assert.equal(result.ok, false);
    assert.equal(releaseCalls.length, 1);
    assert.equal(releaseCalls[0], true);
    assert.equal(result.message, "TEST_FAIL_AFTER_PURGE");
  });
});
