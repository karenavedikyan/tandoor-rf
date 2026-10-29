import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runTanbotMaxProbe, getTanbotMaxProbeExitCode } from "../../src/tanbot-max/probe";
import type { MaxTransportCall, MaxTransportResult } from "../../src/tanbot-max/types";

describe("tanbot max probe", () => {
  it("returns DISABLED when integration off", async () => {
    const report = await runTanbotMaxProbe({
      env: { TANBOT_MAX_ENABLED: "false" },
    });
    assert.equal(report.status, "DISABLED");
    assert.equal(getTanbotMaxProbeExitCode(report.status), 0);
  });

  it("tls probe treats 401 as TLS_PROBE_OK", async () => {
    const transport: MaxTransportCall = async () =>
      ({ ok: false, code: "UNAUTHORIZED", message: "MAX rejected the bot token." }) as MaxTransportResult;
    const report = await runTanbotMaxProbe({
      env: {
        TANBOT_MAX_ENABLED: "true",
        TANBOT_MAX_BOT_TOKEN: "synthetic-test-token-0123456789",
        TANBOT_MAX_EXPECTED_USERNAME: "id231100522180_bot",
      },
      tlsProbe: true,
      transport,
    });
    assert.equal(report.status, "TLS_PROBE_OK");
  });
});
