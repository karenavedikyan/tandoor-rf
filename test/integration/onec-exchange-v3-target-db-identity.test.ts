import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { closePool } from "../../src/db/pool";
import { resolveTargetDbIdentityFromUrl } from "../../src/onec-exchange-v3/target-db-identity";
import { getIntegrationDatabaseUrl, prepareDatabase, setIntegrationEnv } from "../helpers/test-db";

describe("exchange v3 target db identity", { concurrency: false }, () => {
  let databaseUrl = "";

  before(async () => {
    databaseUrl = getIntegrationDatabaseUrl();
    setIntegrationEnv(databaseUrl);
    await prepareDatabase(databaseUrl);
  });

  after(async () => {
    await closePool();
  });

  it("returns the same fingerprint for localhost and 127.0.0.1 URLs to the same database", async () => {
    const parsed = new URL(databaseUrl.replace(/^postgresql:/i, "postgres:"));
    const dbName = parsed.pathname.replace(/^\//, "").split("/")[0];
    assert.ok(dbName);

    const localhostUrl = `postgresql://${parsed.username}:${parsed.password}@localhost:${parsed.port || "5432"}/${dbName}`;
    const loopbackUrl = `postgresql://${parsed.username}:${parsed.password}@127.0.0.1:${parsed.port || "5432"}/${dbName}`;

    const fromLocalhost = await resolveTargetDbIdentityFromUrl(localhostUrl);
    const fromLoopback = await resolveTargetDbIdentityFromUrl(loopbackUrl);

    assert.equal(fromLocalhost.fingerprint, fromLoopback.fingerprint);
    assert.equal(fromLocalhost.database, dbName);
    assert.equal(fromLoopback.database, dbName);
    assert.ok(fromLocalhost.systemIdentifier.length > 0);
  });
});
