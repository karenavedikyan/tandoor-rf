import assert from "node:assert/strict";
import net from "node:net";
import { afterEach, describe, it } from "node:test";
import {
  assertSafeFtpPath,
  isOnecFtpEnabled,
  loadOnecFtpConfig,
} from "../../src/onec-ftp/config";
import { runOnecFtpProbe } from "../../src/onec-ftp/probe";

const ORIGINAL_ENV = { ...process.env };

function enabledEnv(): void {
  process.env.ONEC_FTP_ENABLED = "true";
  process.env.ONEC_FTP_HOST = "ftp.example.com";
  process.env.ONEC_FTP_USER = "exchange-user";
  process.env.ONEC_FTP_PASSWORD = "secret";
  process.env.ONEC_FTP_BASE_PATH = "/1C/Exchange";
  process.env.ONEC_FTP_SECURITY = "plain";
}

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

  it("requires explicit ONEC_FTP_SECURITY=plain when enabled", () => {
    enabledEnv();
    delete process.env.ONEC_FTP_SECURITY;
    const loaded = loadOnecFtpConfig(process.env);
    assert.equal(loaded.ok, false);
    assert.match(loaded.message, /ONEC_FTP_SECURITY must be 'plain'/);
  });

  it("rejects empty ONEC_FTP_SECURITY when enabled", () => {
    enabledEnv();
    process.env.ONEC_FTP_SECURITY = "   ";
    const loaded = loadOnecFtpConfig(process.env);
    assert.equal(loaded.ok, false);
    assert.match(loaded.message, /ONEC_FTP_SECURITY must be 'plain'/);
  });

  it("rejects non-plain security modes", () => {
    enabledEnv();
    process.env.ONEC_FTP_SECURITY = "tls";
    const loaded = loadOnecFtpConfig(process.env);
    assert.equal(loaded.ok, false);
    assert.match(loaded.message, /ONEC_FTP_SECURITY must be 'plain'/);
  });

  it("returns CONFIG_ERROR for missing security without network access", async () => {
    const trap = net.createServer(() => {
      throw new Error("Network access should not occur when security is missing.");
    });
    await new Promise<void>((resolve) => trap.listen(0, "127.0.0.1", () => resolve()));
    const address = trap.address();
    if (!address || typeof address === "string") {
      throw new Error("Failed to bind trap server.");
    }

    enabledEnv();
    delete process.env.ONEC_FTP_SECURITY;
    process.env.ONEC_FTP_HOST = "127.0.0.1";
    process.env.ONEC_FTP_PORT = String(address.port);

    const result = await runOnecFtpProbe(process.env);
    assert.equal(result.status, "CONFIG_ERROR");
    assert.match(result.message, /ONEC_FTP_SECURITY must be 'plain'/);
    await new Promise<void>((resolve, reject) => trap.close((error) => (error ? reject(error) : resolve())));
  });

  it("preserves password special characters without trimming", () => {
    enabledEnv();
    process.env.ONEC_FTP_PASSWORD = " p@ss:word!#$ ";
    const loaded = loadOnecFtpConfig(process.env);
    assert.equal(loaded.ok, true);
    if (loaded.ok) {
      assert.equal(loaded.config.password, " p@ss:word!#$ ");
    }
  });

  it("rejects CR/LF injection in host and base path", () => {
    enabledEnv();
    process.env.ONEC_FTP_HOST = "ftp.example.com\r\nUSER evil";
    process.env.ONEC_FTP_USER = "user";
    const loaded = loadOnecFtpConfig(process.env);
    assert.equal(loaded.ok, false);
    assert.match(loaded.message, /CR, LF, or NUL/);
  });

  it("rejects path traversal in base path", () => {
    assert.throws(() => assertSafeFtpPath("/exchange/../secret"), /must not contain '\.\.'/);
  });

  it("rejects invalid port and timeout", () => {
    enabledEnv();
    process.env.ONEC_FTP_PORT = "70000";
    assert.equal(loadOnecFtpConfig(process.env).ok, false);

    process.env.ONEC_FTP_PORT = "21";
    process.env.ONEC_FTP_TIMEOUT_MS = "999";
    assert.equal(loadOnecFtpConfig(process.env).ok, false);
  });
});
