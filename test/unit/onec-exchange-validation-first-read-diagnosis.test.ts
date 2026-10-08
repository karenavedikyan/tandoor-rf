import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CLIENT_CODE_JSON_KEY } from "../../src/onec-clients/client-code-exchange-fields";
import { readStableClientsFile } from "../../src/onec-clients/read-stable";
import { validateClientsFileBytes } from "../../src/onec-clients/validate";
import type { OnecFtpConfig } from "../../src/onec-ftp/types";
import {
  buildExtendedClientsFileBytes,
  sampleExtendedChild,
} from "../helpers/onec-clients-extended-fixtures";

const ftpConfig: OnecFtpConfig = {
  enabled: true,
  security: "plain",
  host: "127.0.0.1",
  port: 21,
  user: "test",
  password: "test",
  basePath: "/LC",
  timeoutMs: 5000,
};

function invalidCodeBytes() {
  return buildExtendedClientsFileBytes([
    sampleExtendedChild({
      [CLIENT_CODE_JSON_KEY]: 0,
    }),
  ]);
}

describe("1C exchange validation failure on first read (diagnosis)", () => {
  it("numeric Код fails extended validation with INVALID_CLIENT_CODE_EXCHANGE_FIELD", () => {
    const bytes = invalidCodeBytes();
    const validated = validateClientsFileBytes(bytes);
    assert.equal(validated.ok, false);
    if (validated.ok) return;
    assert.ok(
      (validated.issueCodes ?? validated.issues.map((i) => i.code)).includes(
        "INVALID_CLIENT_CODE_EXCHANGE_FIELD",
      ),
    );
    const match = validated.issues.find((i) => i.code === "INVALID_CLIENT_CODE_EXCHANGE_FIELD");
    assert.ok(match);
    assert.equal("index" in match ? match.index : undefined, 0);
  });

  it("readStableClientsFile surfaces generic first-read message without issue details", async () => {
    const bytes = invalidCodeBytes();
    const result = await readStableClientsFile(ftpConfig, {
      stabilityDelayMs: 0,
      reader: async () => ({
        ok: true,
        bytes,
        remotePath: "/LC/clients/all_clients.json",
      }),
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "VALIDATION_FAILED");
    assert.equal(result.message, "Client file validation failed on first read.");
    assert.equal(result.readCount, 1);
  });
});
