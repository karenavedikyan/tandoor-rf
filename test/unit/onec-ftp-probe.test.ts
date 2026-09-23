import assert from "node:assert/strict";
import net from "node:net";
import { afterEach, describe, it } from "node:test";
import { Client } from "basic-ftp";
import { getProbeExitCode, probeOnecFtp, runOnecFtpProbe } from "../../src/onec-ftp/probe";
import type { OnecFtpConfig } from "../../src/onec-ftp/types";
import { startMockFtpsServer, startPlainFtpServer } from "../helpers/mock-ftps-server";

const ORIGINAL_ENV = { ...process.env };

function testSecureOptions(certPem: string) {
  return { ca: [certPem] };
}

function baseConfig(overrides: Partial<OnecFtpConfig> = {}): OnecFtpConfig {
  return {
    enabled: true,
    host: "localhost",
    port: 21,
    user: "exchange-user",
    password: "p@ss:word!#$",
    basePath: "/exchange",
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

  it("maps AUTH TLS 534 to TLS_UNAVAILABLE without USER/PASS", async () => {
    const server = await startPlainFtpServer({
      onCommand: (command) => {
        if (command.toUpperCase().startsWith("AUTH TLS")) {
          return "534 Local policy on server does not allow TLS secure connections.";
        }
        if (command.toUpperCase().startsWith("USER")) {
          return "close";
        }
        return "200 OK";
      },
    });

    try {
      const result = await probeOnecFtp(
        baseConfig({ host: server.host, port: server.port, timeoutMs: 3_000 }),
      );
      assert.equal(result.status, "TLS_UNAVAILABLE");
      assert.equal(result.ftpCode, 534);
      assert.equal(server.userReceived, false);
      assert.equal(server.passwordReceived, false);
      assert.doesNotMatch(JSON.stringify(result), /p@ss:word/);
    } finally {
      await server.close();
    }
  });

  it("does not use insecure TLS fallback on certificate errors", async () => {
    const server = await startMockFtpsServer({ tlsServername: "localhost" });
    try {
      const result = await probeOnecFtp(
        baseConfig({
          host: "localhost",
          port: server.port,
          timeoutMs: 3_000,
        }),
        {
          secureOptions: {
            ca: [server.certPem],
            servername: "wrong-host.example",
          },
        },
      );
      assert.equal(result.status, "TLS_ERROR");
      assert.notEqual(result.status, "SUCCESS");
    } finally {
      await server.close();
    }
  });

  it("authenticates over TLS and lists files in the base path", async () => {
    const server = await startMockFtpsServer({
      tlsServername: "localhost",
      files: [{ name: "all_clients", type: "file", size: 8192 }],
    });

    try {
      const result = await probeOnecFtp(
        baseConfig({
          host: "localhost",
          port: server.port,
          basePath: "/exchange",
          timeoutMs: 5_000,
        }),
        { secureOptions: testSecureOptions(server.certPem) },
      );

      assert.equal(result.status, "SUCCESS");
      assert.equal(result.stage, "complete");
      assert.equal(server.userReceived, true);
      assert.equal(server.passwordReceived, true);
      assert.ok(server.commands.some((command) => command.toUpperCase().includes("AUTH TLS")));
      assert.ok(server.commands.some((command) => command.toUpperCase().startsWith("USER")));
      assert.ok(server.commands.some((command) => command.toUpperCase().startsWith("PASS")));
      assert.ok(
        server.commands.some((command) => command.toUpperCase().startsWith("LIST")),
      );
      assert.ok(result.files?.some((file) => file.name === "all_clients"));
      assert.doesNotMatch(JSON.stringify(result), /p@ss:word/);
    } finally {
      await server.close();
    }
  });

  it("maps authentication failure to AUTH_FAILED", async () => {
    const server = await startMockFtpsServer({
      tlsServername: "localhost",
      authMode: "reject530",
    });
    try {
      const result = await probeOnecFtp(
        baseConfig({ host: "localhost", port: server.port, timeoutMs: 3_000 }),
        { secureOptions: testSecureOptions(server.certPem) },
      );
      assert.equal(result.status, "AUTH_FAILED");
      assert.equal(result.ftpCode, 530);
    } finally {
      await server.close();
    }
  });

  it("maps directory listing rejection to LIST_FAILED", async () => {
    const server = await startMockFtpsServer({
      tlsServername: "localhost",
      listMode: "reject550",
    });
    try {
      const result = await probeOnecFtp(
        baseConfig({ host: "localhost", port: server.port, timeoutMs: 3_000 }),
        { secureOptions: testSecureOptions(server.certPem) },
      );
      assert.equal(result.status, "LIST_FAILED");
      assert.equal(result.ftpCode, 550);
    } finally {
      await server.close();
    }
  });

  it("times out and closes the connection", async () => {
    const server = await startMockFtpsServer({
      tlsServername: "localhost",
      hangAfterTls: true,
    });
    try {
      const result = await probeOnecFtp(
        baseConfig({ host: "localhost", port: server.port, timeoutMs: 500 }),
        { secureOptions: testSecureOptions(server.certPem) },
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
