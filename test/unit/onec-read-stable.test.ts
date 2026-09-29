import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { OnecFtpConfig } from "../../src/onec-ftp/types";
import { readStableClientsFile } from "../../src/onec-clients/read-stable";
import { buildClientsFileBytes, sampleClient } from "../helpers/onec-clients-fixtures";

const config: OnecFtpConfig = {
  host: "127.0.0.1",
  port: 21,
  user: "test",
  password: "secret",
  basePath: "/LC",
  security: "plain",
  timeoutMs: 1000,
};

describe("readStableClientsFile", () => {
  it("accepts two identical reads", async () => {
    const bytes = buildClientsFileBytes([sampleClient()]);
    let calls = 0;
    const reader = async () => {
      calls += 1;
      return { ok: true as const, bytes, remotePath: "/LC/clients/all_clients.json" };
    };

    const result = await readStableClientsFile(config, {
      reader,
      stabilityDelayMs: 0,
    });

    assert.equal(result.ok, true);
    assert.equal(calls, 2);
    if (result.ok) {
      assert.equal(result.readCount, 2);
      assert.equal(result.payload.recordCount, 1);
    }
  });

  it("rejects unstable source between reads", async () => {
    const first = buildClientsFileBytes([sampleClient()]);
    const second = buildClientsFileBytes([
      sampleClient({ name_client: "Client Alpha changed" }),
    ]);
    let calls = 0;
    const reader = async () => {
      calls += 1;
      return {
        ok: true as const,
        bytes: calls === 1 ? first : second,
        remotePath: "/LC/clients/all_clients.json",
      };
    };

    const result = await readStableClientsFile(config, {
      reader,
      stabilityDelayMs: 0,
    });

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, "UNSTABLE_SOURCE");
      assert.equal(result.readCount, 2);
    }
  });
});
