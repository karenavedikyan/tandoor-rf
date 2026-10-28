import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { Pool } from "pg";
import { closePool, resetPoolForTests } from "../../src/db/pool";
import {
  getIntegrationDatabaseUrl,
  prepareDatabase,
  setIntegrationEnv,
} from "../helpers/test-db";

describe("tan-tracker migration 052", { concurrency: false }, () => {
  before(async () => {
    const databaseUrl = getIntegrationDatabaseUrl();
    setIntegrationEnv(databaseUrl, "http://127.0.0.1:3000");
    await prepareDatabase(databaseUrl);
  });

  after(async () => {
    await closePool();
    resetPoolForTests();
  });

  it("creates tt_transfers and related tables", async () => {
    const pool = new Pool({ connectionString: getIntegrationDatabaseUrl() });
    const tables = await pool.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables
       WHERE schemaname = 'public' AND tablename LIKE 'tt_%'
       ORDER BY tablename`,
    );
    await pool.end();
    const names = tables.rows.map((r) => r.tablename);
    assert.ok(names.includes("tt_transfers"));
    assert.ok(names.includes("tt_parties"));
    assert.ok(names.includes("tt_transfer_attachments"));
    assert.ok(names.includes("tt_handoff_codes"));
  });
});
