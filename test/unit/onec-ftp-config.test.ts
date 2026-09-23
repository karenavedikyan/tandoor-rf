import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  assertSafeFtpPath,
  isOnecFtpEnabled,
  loadOnecFtpConfig,
} from "../../src/onec-ftp/config";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("onec ftp config", () => {
  it("is disabled by default", () => {
    delete process.env.ONEC_FTP_ENABLED;
    assert.equal(isOnecFtpEnabled(process.env), false);
  });

  it("does not require FTP settings when disabled", () => {
    process.env.ONEC_FTP_ENABLED = "false";
    delete process.env.ONEC_FTP_HOST;
    const loaded = loadOnecFtpConfig(process.env);
    assert.equal(loaded.ok, false);
    assert.match(loaded.message, /disabled/i);
  });

  it("requires host, user, password, and base path when enabled", () => {
    process.env.ONEC_FTP_ENABLED = "true";
    delete process.env.ONEC_FTP_HOST;
    const loaded = loadOnecFtpConfig(process.env);
    assert.equal(loaded.ok, false);
    assert.match(loaded.message, /ONEC_FTP_HOST/);
  });

  it("preserves password special characters without trimming", () => {
    process.env.ONEC_FTP_ENABLED = "true";
    process.env.ONEC_FTP_HOST = "ftp.example.com";
    process.env.ONEC_FTP_USER = "exchange-user";
    process.env.ONEC_FTP_PASSWORD = " p@ss:word!#$ ";
    process.env.ONEC_FTP_BASE_PATH = "/exchange";
    const loaded = loadOnecFtpConfig(process.env);
    assert.equal(loaded.ok, true);
    if (loaded.ok) {
      assert.equal(loaded.config.password, " p@ss:word!#$ ");
    }
  });

  it("rejects CR/LF injection in host and base path", () => {
    process.env.ONEC_FTP_ENABLED = "true";
    process.env.ONEC_FTP_HOST = "ftp.example.com\r\nUSER evil";
    process.env.ONEC_FTP_USER = "user";
    process.env.ONEC_FTP_PASSWORD = "secret";
    process.env.ONEC_FTP_BASE_PATH = "/exchange";
    const loaded = loadOnecFtpConfig(process.env);
    assert.equal(loaded.ok, false);
    assert.match(loaded.message, /CR, LF, or NUL/);
  });

  it("rejects path traversal in base path", () => {
    assert.throws(() => assertSafeFtpPath("/exchange/../secret"), /must not contain '\.\.'/);
  });

  it("rejects invalid port and timeout", () => {
    process.env.ONEC_FTP_ENABLED = "true";
    process.env.ONEC_FTP_HOST = "ftp.example.com";
    process.env.ONEC_FTP_USER = "user";
    process.env.ONEC_FTP_PASSWORD = "secret";
    process.env.ONEC_FTP_BASE_PATH = "/exchange";
    process.env.ONEC_FTP_PORT = "70000";
    assert.equal(loadOnecFtpConfig(process.env).ok, false);

    process.env.ONEC_FTP_PORT = "21";
    process.env.ONEC_FTP_TIMEOUT_MS = "999";
    assert.equal(loadOnecFtpConfig(process.env).ok, false);
  });
});
