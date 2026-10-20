import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { readSaleBytesFromFtp } from "../../src/onec-sales/run-import";
import { buildSaleJsonBytes, buildSaleRecord, LEGAL_A } from "../helpers/legal-sales-fixtures";
import { startMockPlainFtpServer } from "../helpers/mock-ftps-server";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("legal sales FTP read", () => {
  it("fetches /LC/sale/sale.json via project FTP config", async () => {
    const saleBytes = buildSaleJsonBytes([buildSaleRecord({ legalGuid: LEGAL_A, type: "A", income: 1 })]);
    const server = await startMockPlainFtpServer({
      basePath: "/LC",
      retrContent: saleBytes,
    });
    process.env.ONEC_FTP_ENABLED = "true";
    process.env.ONEC_FTP_HOST = server.host;
    process.env.ONEC_FTP_PORT = String(server.port);
    process.env.ONEC_FTP_USER = "lc_exchange";
    process.env.ONEC_FTP_PASSWORD = "test-password";
    process.env.ONEC_FTP_BASE_PATH = "/LC";
    process.env.ONEC_FTP_SECURITY = "plain";
    process.env.ONEC_FTP_TIMEOUT_MS = "5000";

    try {
      const result = await readSaleBytesFromFtp(process.env);
      assert.equal(result.ok, true);
      if (result.ok) {
        assert.equal(result.bytes.equals(saleBytes), true);
      }
      assert.ok(server.commands.some((cmd) => cmd.toUpperCase().includes("RETR")));
    } finally {
      await server.close();
    }
  });
});
