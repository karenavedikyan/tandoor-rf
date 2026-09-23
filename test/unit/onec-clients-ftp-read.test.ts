import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { FTP_READ_DEADLINE_MS, MAX_SOURCE_BYTES } from "../../src/onec-clients/constants";
import { defaultFtpReader } from "../../src/onec-clients/ftp-read";
import { buildClientsFileBytes, sampleClient } from "../helpers/onec-clients-fixtures";
import { startMockPlainFtpServer } from "../helpers/mock-ftps-server";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

function sentCommands(commands: string[]): string[] {
  return commands.map((command) => command.toUpperCase());
}

async function assertControlEnded(server: { controlEnded: boolean }): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (server.controlEnded) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.equal(server.controlEnded, true);
}

describe("onec clients defaultFtpReader", () => {
  it("downloads via RETR without AUTH TLS on plain FTP", async () => {
    const fileBytes = buildClientsFileBytes([sampleClient()]);
    const server = await startMockPlainFtpServer({
      basePath: "/LC",
      retrContent: fileBytes,
    });

    try {
      const result = await defaultFtpReader({
        enabled: true,
        security: "plain",
        host: server.host,
        port: server.port,
        user: "lc_exchange",
        password: "test-password",
        basePath: "/LC",
        timeoutMs: 5_000,
      });

      assert.equal(result.ok, true);
      if (result.ok) {
        assert.equal(result.bytes.equals(fileBytes), true);
        assert.equal(result.remotePath, "/LC/clients/all_clients.json");
      }

      const commands = sentCommands(server.commands);
      assert.equal(commands.some((command) => command.startsWith("RETR")), true);
      assert.equal(commands.some((command) => command.startsWith("AUTH TLS")), false);
      assert.equal(commands.some((command) => command.startsWith("AUTH SSL")), false);
      await assertControlEnded(server);
    } finally {
      await server.close();
    }
  });

  it("rejects downloads above the byte limit with FILE_TOO_LARGE", async () => {
    const oversized = Buffer.alloc(MAX_SOURCE_BYTES + 1, 0x61);
    const server = await startMockPlainFtpServer({
      basePath: "/LC",
      retrContent: oversized,
    });

    try {
      const result = await defaultFtpReader({
        enabled: true,
        security: "plain",
        host: server.host,
        port: server.port,
        user: "lc_exchange",
        password: "test-password",
        basePath: "/LC",
        timeoutMs: 5_000,
      });

      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.code, "FILE_TOO_LARGE");
      }
      await assertControlEnded(server);
    } finally {
      await server.close();
    }
  });

  it("times out on the overall read deadline during an ongoing transfer", async () => {
    const server = await startMockPlainFtpServer({
      basePath: "/LC",
      retrMode: "hang",
      retrContent: buildClientsFileBytes([sampleClient()]),
    });

    try {
      const startedAt = Date.now();
      const result = await defaultFtpReader(
        {
          enabled: true,
          security: "plain",
          host: server.host,
          port: server.port,
          user: "lc_exchange",
          password: "test-password",
          basePath: "/LC",
          timeoutMs: 5_000,
        },
        { readDeadlineMs: 150 },
      );
      const elapsedMs = Date.now() - startedAt;

      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.code, "TIMEOUT");
      }
      assert.ok(elapsedMs >= 100);
      assert.ok(elapsedMs < 2_000);
      await assertControlEnded(server);
    } finally {
      await server.close();
    }
  });

  it("uses the production read deadline by default", async () => {
    assert.equal(FTP_READ_DEADLINE_MS, 60_000);
  });
});
