import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runTanbotMaxProbe } from "../../src/tanbot-max/probe";
import { formatDiagnosticReportForCli } from "../../src/tanbot-max/sanitize";

describe("tanbot max security", () => {
  it("does not leak bot token in CLI output", async () => {
    const secret = "super-secret-max-token-0123456789ab";
    const report = await runTanbotMaxProbe({
      env: {
        TANBOT_MAX_ENABLED: "true",
        TANBOT_MAX_BOT_TOKEN: secret,
        TANBOT_MAX_EXPECTED_USERNAME: "id231100522180_bot",
      },
    });
    const cli = formatDiagnosticReportForCli(report);
    assert.equal(cli.includes(secret), false);
  });
});
