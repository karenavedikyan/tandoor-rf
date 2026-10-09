import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { setHoldingV2PipelineEnabledForTests } from "../../src/onec-clients/holding-v2-pipeline-config";
import { readStableClientsFile } from "../../src/onec-clients/read-stable";
import {
  buildHoldingV2FileBytes,
  headRow,
  minimalOutlet,
} from "../helpers/holding-v2-fixtures";
import { getIntegrationDatabaseUrl, prepareDatabase, setIntegrationEnv } from "../helpers/test-db";

describe("holding v2 stable read validation", () => {
  before(() => {
    setIntegrationEnv(getIntegrationDatabaseUrl());
  });

  beforeEach(() => {
    setHoldingV2PipelineEnabledForTests(undefined);
  });

  after(() => {
    setHoldingV2PipelineEnabledForTests(undefined);
  });

  it("legacy stable read rejects v2 self-ref head when pipeline flag is off", async () => {
    const bytes = buildHoldingV2FileBytes([headRow("a1000000-0000-4000-8000-000000000001", {
      retail_outlets: [minimalOutlet("b1000000-0000-4000-8000-000000000001")],
    })]);
    const reader = async () => ({ ok: true as const, bytes, remotePath: "/test/all_clients.json" });
    const result = await readStableClientsFile(
      { host: "test", user: "u", password: "p", basePath: "/" },
      { reader, stabilityDelayMs: 0 },
    );
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "VALIDATION_FAILED");
  });

  it("stable read accepts v2 contract when pipeline flag is on", async () => {
    setHoldingV2PipelineEnabledForTests(true);
    const bytes = buildHoldingV2FileBytes([headRow("a1000000-0000-4000-8000-000000000001", {
      retail_outlets: [minimalOutlet("b1000000-0000-4000-8000-000000000001")],
    })]);
    const reader = async () => ({ ok: true as const, bytes, remotePath: "/test/all_clients.json" });
    const result = await readStableClientsFile(
      { host: "test", user: "u", password: "p", basePath: "/" },
      { reader, stabilityDelayMs: 0 },
    );
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.payload.holdingExchangeSchema, "v2");
  });
});
