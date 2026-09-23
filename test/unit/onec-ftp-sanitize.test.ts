import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MAX_PROBE_REPORT_BYTES,
  sanitizeProbeMessage,
  sanitizeProbeResult,
} from "../../src/onec-ftp/sanitize";
import type { OnecFtpProbeResult } from "../../src/onec-ftp/types";

const SECRET = "p@ss:word!#$";

describe("onec ftp sanitize", () => {
  it("redacts secrets from message before truncation", () => {
    const leaked = `${SECRET}${"x".repeat(600)}`;
    const sanitized = sanitizeProbeMessage(leaked, [SECRET]);
    assert.doesNotMatch(sanitized, /p@ss:word/);
    assert.match(sanitized, /\[redacted\]/);
    assert.ok(sanitized.length <= 500);
  });

  it("redacts secrets from all string report fields", () => {
    const result = sanitizeProbeResult(
      {
        status: "SUCCESS",
        stage: "complete",
        durationMs: 10,
        security: "plain",
        transportWarning: "Login, password, and file data are transmitted without encryption.",
        message: `Failed in ${SECRET}`,
        basePath: `/1C/${SECRET}`,
        workingDirectory: `/1C/Exchange/${SECRET}`,
        files: [{ name: `${SECRET}.txt`, type: "file", size: 1, modifiedAt: null }],
        fileCount: 1,
      },
      [SECRET],
    );

    const serialized = JSON.stringify(result);
    assert.doesNotMatch(serialized, /p@ss:word/);
    assert.match(result.basePath ?? "", /\[redacted\]/);
    assert.match(result.workingDirectory ?? "", /\[redacted\]/);
    assert.match(result.files?.[0]?.name ?? "", /\[redacted\]/);
  });

  it("limits total report size after redaction", () => {
    const files = Array.from({ length: 200 }, (_, index) => ({
      name: `file-${index}-${"a".repeat(200)}.txt`,
      type: "file" as const,
      size: 1,
      modifiedAt: null,
    }));
    const result: OnecFtpProbeResult = {
      status: "SUCCESS",
      stage: "complete",
      durationMs: 10,
      security: "plain",
      transportWarning: "Login, password, and file data are transmitted without encryption.",
      message: "ok",
      files,
      fileCount: files.length,
    };

    const sanitized = sanitizeProbeResult(result);
    assert.ok(JSON.stringify(sanitized).length <= MAX_PROBE_REPORT_BYTES);
  });
});
