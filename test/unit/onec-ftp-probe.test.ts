import assert from "node:assert/strict";
import net from "node:net";
import { afterEach, describe, it } from "node:test";
import { Client } from "basic-ftp";
import { getProbeExitCode, probeOnecFtp, runOnecFtpProbe } from "../../src/onec-ftp/probe";
import type { OnecFtpConfig } from "../../src/onec-ftp/types";
import { startMockPlainFtpServer } from "../helpers/mock-ftps-server";

const ORIGINAL_ENV = { ...process.env };

function baseConfig(overrides: Partial<OnecFtpConfig> = {}): OnecFtpConfig {
  return {
    enabled: true,
    security: "plain",
    host: "localhost",
    port: 21,
    user: "exchange-user",
    password: "p@ss:word!#$",
    basePath: "/1C/Exchange",
    timeoutMs: 5_000,
    ...overrides,
  };
}

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("onec ftp probe", () => {
  it("returns DISABLED without network access", async () => {
    const trap = net.createServer(() => {
      throw new Error("Network access should not occur when integration is disabled.");
    });
    await new Promise<void>((resolve) => trap.listen(0, "127.0.0.1", () => resolve()));
    const address = trap.address();
    if (!address || typeof address === "string") {
      throw new Error("Failed to bind trap server.");
    }

    process.env.ONEC_FTP_ENABLED = "false";
    process.env.ONEC_FTP_HOST = "127.0.0.1";
    process.env.ONEC_FTP_PORT = String(address.port);

    const result = await runOnecFtpProbe(process.env);
    assert.equal(result.status, "DISABLED");
    assert.equal(getProbeExitCode(result.status), 0);
    await new Promise<void>((resolve, reject) => trap.close((error) => (error ? reject(error) : resolve())));
  });

  it("does not send AUTH TLS in plain mode", async () => {
    const server = await startMockPlainFtpServer({
      basePath: "/1C/Exchange",
      files: [{ name: "all_clients", type: "file", size: 8192 }],
    });

    try {
      const result = await probeOnecFtp(
        baseConfig({ host: server.host, port: server.port, timeoutMs: 5_000 }),
      );

      assert.equal(result.status, "SUCCESS");
      assert.equal(result.stage, "complete");
      assert.equal(server.userReceived, true);
      assert.equal(server.passwordReceived, true);
      assert.ok(!server.commands.some((command) => command.toUpperCase().includes("AUTH TLS")));
      assert.ok(!server.commands.some((command) => command.toUpperCase().includes("AUTH SSL")));
      assert.ok(server.commands.some((command) => command.toUpperCase().startsWith("USER")));
      assert.ok(server.commands.some((command) => command.toUpperCase().startsWith("PASS")));
      assert.ok(server.commands.some((command) => command.toUpperCase().startsWith("CWD")));
      assert.ok(server.commands.some((command) => command.toUpperCase().startsWith("PWD")));
      assert.ok(server.commands.some((command) => command.toUpperCase().startsWith("LIST")));
      assert.equal(result.workingDirectory, "/1C/Exchange");
      assert.ok(result.files?.some((file) => file.name === "all_clients"));
      assert.doesNotMatch(JSON.stringify(result), /p@ss:word/);
    } finally {
      await server.close();
    }
  });

  it("maps authentication failure to AUTH_FAILED", async () => {
    const server = await startMockPlainFtpServer({ authMode: "reject530" });
    try {
      const result = await probeOnecFtp(
        baseConfig({ host: server.host, port: server.port, timeoutMs: 3_000 }),
      );
      assert.equal(result.status, "AUTH_FAILED");
      assert.equal(result.ftpCode, 530);
    } finally {
      await server.close();
    }
  });

  it("maps base path access denial to PATH_ACCESS_DENIED", async () => {
    const server = await startMockPlainFtpServer({ cwdMode: "reject550" });
    try {
      const result = await probeOnecFtp(
        baseConfig({ host: server.host, port: server.port, timeoutMs: 3_000 }),
      );
      assert.equal(result.status, "PATH_ACCESS_DENIED");
      assert.equal(result.ftpCode, 550);
    } finally {
      await server.close();
    }
  });

  it("maps directory listing rejection to LIST_FAILED", async () => {
    const server = await startMockPlainFtpServer({ listMode: "reject550" });
    try {
      const result = await probeOnecFtp(
        baseConfig({ host: server.host, port: server.port, timeoutMs: 3_000 }),
      );
      assert.equal(result.status, "LIST_FAILED");
      assert.equal(result.ftpCode, 550);
    } finally {
      await server.close();
    }
  });

  it("times out and closes the connection", async () => {
    const server = await startMockPlainFtpServer({ hangAfterAuth: true });
    try {
      const result = await probeOnecFtp(
        baseConfig({ host: server.host, port: server.port, timeoutMs: 500 }),
      );
      assert.equal(result.status, "TIMEOUT");
      assert.equal(getProbeExitCode(result.status), 1);
    } finally {
      await server.close();
    }
  });

  it("does not expose write FTP operations", async () => {
    const forbidden = [
      "uploadFrom",
      "appendFrom",
      "upload",
      "ensureDir",
      "remove",
      "rename",
      "clearWorkingDir",
    ] as const;

    for (const method of forbidden) {
      assert.equal(typeof (Client.prototype as Record<string, unknown>)[method], "function");
    }
    assert.doesNotMatch(probeOnecFtp.toString(), /\.(uploadFrom|appendFrom|ensureDir|remove|rename|clearWorkingDir)\(/);
  });
});
