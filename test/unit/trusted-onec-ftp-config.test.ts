import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isTrustedFtpConfig,
  validateTrustedOnecFtpConfig,
} from "../../src/onec-import/trusted-config";

const trustedEnv = {
  ONEC_FTP_ENABLED: "true",
  ONEC_FTP_SECURITY: "plain",
  ONEC_FTP_HOST: "gw.toopatch.ru",
  ONEC_FTP_PORT: "21",
  ONEC_FTP_USER: "test",
  ONEC_FTP_PASSWORD: "secret",
  ONEC_FTP_BASE_PATH: "/LC",
};

describe("trusted onec ftp config validation", () => {
  it("passes trusted configuration checks without exposing secrets", () => {
    const result = validateTrustedOnecFtpConfig(trustedEnv);
    assert.equal(result.ok, true);
    assert.equal(result.errorCode, null);
    assert.ok(result.checks.every((check) => check.passed));
    const serialized = JSON.stringify(result);
    assert.doesNotMatch(serialized, /secret/);
    assert.equal(isTrustedFtpConfig(trustedEnv), true);
  });

  it("fails when integration disabled", () => {
    const result = validateTrustedOnecFtpConfig({ ...trustedEnv, ONEC_FTP_ENABLED: "false" });
    assert.equal(result.ok, false);
    assert.equal(result.errorCode, "CONFIG_INVALID");
    assert.equal(result.checks.find((check) => check.id === "integration_enabled")?.passed, false);
  });

  it("fails when host is outside allowlist", () => {
    const result = validateTrustedOnecFtpConfig({ ...trustedEnv, ONEC_FTP_HOST: "evil.example" });
    assert.equal(result.ok, false);
    assert.equal(result.checks.find((check) => check.id === "trusted_host")?.passed, false);
    assert.doesNotMatch(JSON.stringify(result), /evil\.example/);
  });

  it("fails when base path is outside allowlist", () => {
    const result = validateTrustedOnecFtpConfig({ ...trustedEnv, ONEC_FTP_BASE_PATH: "/other" });
    assert.equal(result.ok, false);
    assert.equal(result.checks.find((check) => check.id === "trusted_base_path")?.passed, false);
  });
});
