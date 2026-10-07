import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runOnecUpdateReadOnlyProbe } from "../../src/clients/admin-onec-update/config-diagnostics";
import { buildClientsFileBytes, sampleClient } from "../helpers/onec-clients-fixtures";
import {
  buildEmployeeRosterBytes,
  buildEmployeeRosterEntry,
} from "../helpers/onec-clients-employee-roster-fixtures";

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

  it("reports invalid manifest on read-only dry-run probe", async () => {
    const clientsBytes = buildClientsFileBytes([sampleClient()]);
    const rosterBytes = buildEmployeeRosterBytes([
      buildEmployeeRosterEntry("22222222-2222-4222-8222-222222222222"),
    ]);
    const outcome = await runOnecUpdateReadOnlyProbe(env, {
      clientsBytes,
      employeeRosterBytes: rosterBytes,
      manifestBytes: Buffer.from("{ invalid json"),
    });
    assert.equal(outcome.config.ok, true);
    assert.equal(outcome.ok, false);
    assert.ok(outcome.probe);
    assert.equal(outcome.probe?.status, "REJECTED_BY_CHECKS");
    assert.equal(outcome.probe?.errorCode, "MANIFEST_INVALID_JSON");
    assert.doesNotMatch(JSON.stringify(outcome), /secret/);
  });
});
