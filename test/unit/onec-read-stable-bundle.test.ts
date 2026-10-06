import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { OnecFtpConfig } from "../../src/onec-ftp/types";
import { readStableImportBundle } from "../../src/onec-clients/read-stable-bundle";
import { buildClientsFileBytes, sampleClient } from "../helpers/onec-clients-fixtures";
import { buildEmployeeRosterBytes, buildEmployeeRosterEntry } from "../helpers/onec-clients-employee-roster-fixtures";

const config: OnecFtpConfig = {
  host: "127.0.0.1",
  port: 21,
  user: "test",
  password: "secret",
  basePath: "/LC",
  security: "plain",
  timeoutMs: 1000,
};

describe("readStableImportBundle", () => {
  it("accepts stable clients and roster pair", async () => {
    const clientsBytes = buildClientsFileBytes([sampleClient()]);
    const rosterBytes = buildEmployeeRosterBytes([
      buildEmployeeRosterEntry("22222222-2222-4222-8222-222222222222"),
    ]);

    const result = await readStableImportBundle(config, {
      clientsReader: async () => ({ ok: true as const, bytes: clientsBytes, remotePath: "/LC/clients/all_clients.json" }),
      rosterReader: async () => ({ ok: true as const, bytes: rosterBytes }),
      stabilityDelayMs: 0,
    });

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.clientsPayload.recordCount, 1);
      assert.equal(result.roster.wholesaleCount, 1);
      assert.ok(result.verificationFingerprint);
    }
  });
});
