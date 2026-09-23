import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MAX_DETAILED_ERRORS, MAX_DETAILED_WARNINGS } from "../../src/onec-clients/constants";
import { runClientsImport } from "../../src/onec-clients/run-import";
import { buildClientsFileBytes, sampleClient } from "../helpers/onec-clients-fixtures";

function ftpEnv(): NodeJS.ProcessEnv {
  return {
    ONEC_FTP_ENABLED: "true",
    ONEC_FTP_SECURITY: "plain",
    ONEC_FTP_HOST: "127.0.0.1",
    ONEC_FTP_PORT: "21",
    ONEC_FTP_USER: "lc_exchange",
    ONEC_FTP_PASSWORD: "test-password",
    ONEC_FTP_BASE_PATH: "/LC",
  };
}

describe("onec clients run-import validation reporting", () => {
  it("reports full validation totals with truncation flags", async () => {
    const warningRecords = Array.from({ length: 50 }, (_, index) =>
      sampleClient({
        guid_client: `11111111-1111-4111-8111-${String(index).padStart(12, "0")}`,
        address: "",
        telephone: [],
        [`extra_${index}`]: "ignored",
      }),
    );
    const result = await runClientsImport({
      env: ftpEnv(),
      argv: ["--dry-run"],
      fileBytes: buildClientsFileBytes(warningRecords),
    });

    assert.equal(result.status, "SUCCESS");
    assert.equal(result.warningCount, 150);
    assert.equal(result.warnings?.length, MAX_DETAILED_WARNINGS);
    assert.equal(result.warningsTruncated, true);

    const errorRecords = Array.from({ length: 100 }, (_, index) =>
      sampleClient({
        guid_client: `22222222-2222-4222-8222-${String(index).padStart(12, "0")}`,
        name_client: "   ",
      }),
    );
    const failed = await runClientsImport({
      env: ftpEnv(),
      argv: ["--dry-run"],
      fileBytes: buildClientsFileBytes(errorRecords),
    });

    assert.equal(failed.status, "VALIDATION_FAILED");
    assert.equal(failed.errorCount, 100);
    assert.equal(failed.errors?.length, MAX_DETAILED_ERRORS);
    assert.equal(failed.errorsTruncated, true);
  });
});
