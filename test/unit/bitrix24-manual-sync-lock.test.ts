import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { Pool } from "pg";
import {
  acquireManualSyncLock,
  loadManualSyncMinIntervalMs,
} from "../../src/bitrix24/sync/manual-sync-lock";
import { resetPoolForTests } from "../../src/db/pool";
import { getIntegrationDatabaseUrl, prepareDatabase, setIntegrationEnv } from "../helpers/test-db";

describe("bitrix24 manual sync lock", () => {
  let databaseUrl = "";

  before(async () => {
    databaseUrl = getIntegrationDatabaseUrl();
    setIntegrationEnv(databaseUrl, "http://127.0.0.1:3000");
    await prepareDatabase(databaseUrl);
  });

  after(async () => {
    await resetPoolForTests();
  });

  it("blocks concurrent locks for the same portal task", async () => {
    await resetPoolForTests();
    const first = await acquireManualSyncLock("portal.example", "9001", 0);
    assert.equal(first.ok, true);
    const second = await acquireManualSyncLock("portal.example", "9001", 0);
    assert.equal(second.ok, false);
    if (!second.ok) {
      assert.equal(second.code, "SYNC_IN_PROGRESS");
    }
    if (first.ok) {
      await first.release();
    }
  });

  it("enforces cooldown interval between runs", async () => {
    await resetPoolForTests();
    process.env.BITRIX24_MANUAL_SYNC_MIN_INTERVAL_MS = "60000";
    assert.equal(loadManualSyncMinIntervalMs(), 60000);
    const first = await acquireManualSyncLock("portal.example", "9002", 60000);
    assert.equal(first.ok, true);
    if (first.ok) {
      await first.release();
    }
    const second = await acquireManualSyncLock("portal.example", "9002", 60000);
    assert.equal(second.ok, false);
    if (!second.ok) {
      assert.equal(second.code, "COOLDOWN");
      assert.ok(second.retryAfterMs > 0);
    }
    delete process.env.BITRIX24_MANUAL_SYNC_MIN_INTERVAL_MS;
  });
});
