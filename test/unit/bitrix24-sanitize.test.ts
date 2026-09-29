import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { redactBitrixSecrets, sanitizeProbeResult } from "../../src/bitrix24/sanitize";
import { sampleWebhookConfig } from "../helpers/bitrix24-mock-fetch";

describe("bitrix24 sanitize", () => {
  it("redacts webhook secrets from messages", () => {
    const config = sampleWebhookConfig();
    const sanitized = redactBitrixSecrets(
      `Failed at https://example.bitrix24.ru/rest/1/${config.webhookToken}/tasks.task.list`,
      [config.webhookToken],
    );
    assert.doesNotMatch(sanitized, /abc123secret/);
    assert.match(sanitized, /\[redacted\]/);
  });

  it("sanitizes probe output", () => {
    const config = sampleWebhookConfig();
    const result = sanitizeProbeResult(
      {
        status: "CONFIG_ERROR",
        durationMs: 1,
        message: `Bad token ${config.webhookToken}`,
        checks: [`token ${config.webhookToken}`],
      },
      config,
    );
    assert.doesNotMatch(JSON.stringify(result), /abc123secret/);
  });
});
