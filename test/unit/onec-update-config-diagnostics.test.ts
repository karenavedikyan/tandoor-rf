import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runOnecUpdateReadOnlyProbe } from "../../src/clients/admin-onec-update/config-diagnostics";
import fs from "node:fs";
import path from "node:path";
import {
  buildEmployeeRosterBytes,
  buildEmployeeRosterEntry,
} from "../helpers/onec-clients-employee-roster-fixtures";

const FIXTURE_DIR = path.join(process.cwd(), "test/fixtures/onec-exchange-v3");

const env = {
  ONEC_FTP_ENABLED: "true",
  ONEC_FTP_SECURITY: "plain",
  ONEC_FTP_HOST: "gw.toopatch.ru",
  ONEC_FTP_PORT: "21",
  ONEC_FTP_USER: "test",
  ONEC_FTP_PASSWORD: "secret",
  ONEC_FTP_BASE_PATH: "/LC",
};

describe("onec update config diagnostics", () => {
  it("refuses probe when config is invalid", async () => {
    const outcome = await runOnecUpdateReadOnlyProbe({ ...env, ONEC_FTP_BASE_PATH: "/other" });
    assert.equal(outcome.ok, false);
    assert.equal(outcome.probe, null);
    assert.equal(outcome.config.ok, false);
  });

  it("reports ready bundle when manifest is absent", async () => {
    const rosterBytes = buildEmployeeRosterBytes([
      buildEmployeeRosterEntry("22222222-2222-4222-8222-222222222222"),
    ]);
    const outcome = await runOnecUpdateReadOnlyProbe(env, {
      holdingsBytes: fs.readFileSync(path.join(FIXTURE_DIR, "all_holding.json")),
      clientsBytes: fs.readFileSync(path.join(FIXTURE_DIR, "all_clients.json")),
      retailBytes: fs.readFileSync(path.join(FIXTURE_DIR, "all_retail.json")),
      employeeRosterBytes: rosterBytes,
    });
    assert.equal(outcome.readOk, true);
    assert.equal(outcome.ok, true);
    assert.equal(outcome.probe?.applyPermitted, true);
    assert.equal(outcome.probe?.releaseConsistencyConfirmed, false);
  });

  it("ignores invalid manifest on read-only dry-run probe", async () => {
    const rosterBytes = buildEmployeeRosterBytes([
      buildEmployeeRosterEntry("22222222-2222-4222-8222-222222222222"),
    ]);
    const outcome = await runOnecUpdateReadOnlyProbe(env, {
      holdingsBytes: fs.readFileSync(path.join(FIXTURE_DIR, "all_holding.json")),
      clientsBytes: fs.readFileSync(path.join(FIXTURE_DIR, "all_clients.json")),
      retailBytes: fs.readFileSync(path.join(FIXTURE_DIR, "all_retail.json")),
      employeeRosterBytes: rosterBytes,
      manifestBytes: Buffer.from("{ invalid json"),
    });
    assert.equal(outcome.config.ok, true);
    assert.equal(outcome.ok, true);
    assert.ok(outcome.probe);
    assert.equal(outcome.probe?.status, "SUCCESS");
    assert.equal(outcome.probe?.applyPermitted, true);
    assert.equal(outcome.probe?.releaseConsistencyConfirmed, false);
    assert.equal(outcome.readOk, true);
    assert.doesNotMatch(JSON.stringify(outcome), /secret/);
  });
});
