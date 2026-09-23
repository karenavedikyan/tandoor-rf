import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MAX_PROBE_REPORT_BYTES,
  formatProbeReportForCli,
  probeReportByteLength,
  sanitizeProbeMessage,
  sanitizeProbeResult,
} from "../../src/onec-ftp/sanitize";
import type { OnecFtpProbeResult } from "../../src/onec-ftp/types";

const SECRET = "p@ss:word!#$";
const PADDED_SECRET = " synthetic-password ";

describe("onec ftp sanitize", () => {
  it("redacts secrets from message before truncation", () => {
    const leaked = `${SECRET}${"x".repeat(600)}`;
    const sanitized = sanitizeProbeMessage(leaked, [SECRET]);
    assert.doesNotMatch(sanitized, /p@ss:word/);
    assert.match(sanitized, /\[redacted\]/);
    assert.ok(sanitized.length <= 500);
  });

  it("redacts padded secrets before trim removes matching whitespace", () => {
    const sanitizedMessage = sanitizeProbeMessage(`Failure near ${PADDED_SECRET}`, [PADDED_SECRET]);
    assert.doesNotMatch(sanitizedMessage, /synthetic-password/);
    assert.match(sanitizedMessage, /\[redacted\]/);

    const result = sanitizeProbeResult(
      {
        status: "SUCCESS",
        stage: "complete",
        durationMs: 10,
        security: "plain",
        transportWarning: "Login, password, and file data are transmitted without encryption.",
        message: `Failure near ${PADDED_SECRET}`,
        workingDirectory: `/1C/Exchange/${PADDED_SECRET}`,
        files: [{ name: `${PADDED_SECRET}.txt`, type: "file", size: 1, modifiedAt: null }],
        fileCount: 1,
      },
      [PADDED_SECRET],
    );

    const serialized = formatProbeReportForCli(result);
    assert.doesNotMatch(serialized, /synthetic-password/);
    assert.match(result.message, /\[redacted\]/);
    assert.match(result.workingDirectory ?? "", /\[redacted\]$/);
    assert.match(result.files?.[0]?.name ?? "", /^\[redacted\]\.txt$/);
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

    const serialized = formatProbeReportForCli(result);
    assert.doesNotMatch(serialized, /p@ss:word/);
    assert.match(result.basePath ?? "", /\[redacted\]/);
    assert.match(result.workingDirectory ?? "", /\[redacted\]/);
    assert.match(result.files?.[0]?.name ?? "", /\[redacted\]/);
  });

  it("limits total report size using CLI UTF-8 byte length", () => {
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
    assert.ok(probeReportByteLength(sanitized) <= MAX_PROBE_REPORT_BYTES);
    assert.ok(Buffer.byteLength(formatProbeReportForCli(sanitized), "utf8") <= MAX_PROBE_REPORT_BYTES);
  });

  it("shrinks Cyrillic reports that exceed the byte limit in pretty JSON output", () => {
    const cyrillicName = "К".repeat(450);
    const files = Array.from({ length: 75 }, (_, index) => ({
      name: `${cyrillicName}-${index}.xml`,
      type: "file" as const,
      size: 1,
      modifiedAt: null,
    }));
    const oversized: OnecFtpProbeResult = {
      status: "SUCCESS",
      stage: "complete",
      durationMs: 10,
      security: "plain",
      transportWarning: "Логин, пароль и данные каталога передаются без шифрования.",
      message: "Список каталога",
      files,
      fileCount: files.length,
    };

    const compactJsonLength = JSON.stringify(oversized).length;
    assert.ok(probeReportByteLength(oversized) > MAX_PROBE_REPORT_BYTES);
    assert.ok(
      compactJsonLength <= MAX_PROBE_REPORT_BYTES,
      `character length (${compactJsonLength}) must stay below the byte limit while UTF-8 size exceeds it`,
    );

    const sanitized = sanitizeProbeResult(oversized);
    const cliOutput = formatProbeReportForCli(sanitized);

    assert.ok(probeReportByteLength(sanitized) <= MAX_PROBE_REPORT_BYTES);
    assert.ok(Buffer.byteLength(cliOutput, "utf8") <= MAX_PROBE_REPORT_BYTES);
    assert.ok((sanitized.files?.length ?? 0) < files.length);
  });
});
