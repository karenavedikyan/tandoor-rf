import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CLI_ARGUMENT_ERROR_MESSAGES,
  parseClientsImportCliArgs,
} from "../../src/onec-clients/cli-args";
import { runClientsImport } from "../../src/onec-clients/run-import";
import { buildClientsFileSha256, sampleClient } from "../helpers/onec-clients-fixtures";

describe("onec clients cli args", () => {
  it("defaults to dry-run mode", () => {
    const parsed = parseClientsImportCliArgs([]);
    assert.equal(parsed.ok, true);
    if (parsed.ok) {
      assert.equal(parsed.options.mode, "dry_run");
    }
  });

  it("requires expected sha256 for apply", () => {
    assert.equal(parseClientsImportCliArgs(["--apply"]).ok, false);
    assert.equal(parseClientsImportCliArgs(["--expected-sha256", "abc"]).ok, false);
  });

  it("rejects unknown and contradictory arguments with static codes", () => {
    const unknown = parseClientsImportCliArgs(["--force"]);
    assert.equal(unknown.ok, false);
    if (!unknown.ok) {
      assert.equal(unknown.code, "UNKNOWN_ARGUMENT");
      assert.equal(CLI_ARGUMENT_ERROR_MESSAGES[unknown.code], "Unknown CLI argument.");
    }

    assert.equal(parseClientsImportCliArgs(["--apply", "--dry-run"]).ok, false);
    assert.equal(parseClientsImportCliArgs(["--expected-sha256", "abc", "--dry-run"]).ok, false);
  });

  it("rejects duplicate expected sha256", () => {
    const hash = buildClientsFileSha256([sampleClient()]);
    const parsed = parseClientsImportCliArgs([
      "--apply",
      "--expected-sha256",
      hash,
      "--expected-sha256",
      hash,
    ]);
    assert.equal(parsed.ok, false);
    if (!parsed.ok) {
      assert.equal(parsed.code, "DUPLICATE_EXPECTED_SHA256");
    }
  });

  it("accepts apply with valid sha256", () => {
    const hash = buildClientsFileSha256([sampleClient()]);
    const parsed = parseClientsImportCliArgs(["--apply", "--expected-sha256", hash]);
    assert.equal(parsed.ok, true);
    if (parsed.ok) {
      assert.equal(parsed.options.mode, "apply");
      assert.equal(parsed.options.expectedSha256, hash);
    }
  });

  it("does not reflect argv secrets or PII in import reports", async () => {
    const syntheticSecret = "synthetic-password-9f3c";
    const piiToken = "client-pii-token-42";
    const env = {
      ONEC_FTP_ENABLED: "true",
      ONEC_FTP_SECURITY: "plain",
      ONEC_FTP_HOST: "127.0.0.1",
      ONEC_FTP_PORT: "21",
      ONEC_FTP_USER: "lc_exchange",
      ONEC_FTP_PASSWORD: syntheticSecret,
      ONEC_FTP_BASE_PATH: "/LC",
    };

    const unknownArg = await runClientsImport({
      env,
      argv: [`--${piiToken}`],
    });
    assert.equal(unknownArg.status, "ARGUMENT_ERROR");
    const unknownReport = JSON.stringify(unknownArg);
    assert.equal(unknownReport.includes(piiToken), false);
    assert.equal(unknownReport.includes(syntheticSecret), false);

    const positional = await runClientsImport({
      env,
      argv: [piiToken],
    });
    assert.equal(positional.status, "ARGUMENT_ERROR");
    const positionalReport = JSON.stringify(positional);
    assert.equal(positionalReport.includes(piiToken), false);
    assert.equal(positionalReport.includes(syntheticSecret), false);
  });
});
