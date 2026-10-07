import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildImportJobFailure,
  ImportJobError,
  IMPORT_JOB_UNKNOWN_CODE,
} from "../../src/onec-import/job-failure";

const env = {
  ONEC_FTP_ENABLED: "true",
  ONEC_FTP_SECURITY: "plain",
  ONEC_FTP_HOST: "gw.toopatch.ru",
  ONEC_FTP_PORT: "21",
  ONEC_FTP_USER: "test",
  ONEC_FTP_PASSWORD: "super-secret-password",
  ONEC_FTP_BASE_PATH: "/LC",
  DATABASE_URL: "postgres://user:db-secret@localhost:5432/app",
};

describe("onec import job failure diagnostics", () => {
  it("preserves CONFIG_INVALID with config stage", () => {
    const failure = buildImportJobFailure(
      new ImportJobError("CONFIG_INVALID", "config", "Конфигурация FTP не прошла проверку."),
      "apply",
      env,
    );
    assert.equal(failure.errorCode, "CONFIG_INVALID");
    assert.equal(failure.stage, "config");
    assert.equal(failure.result.stage, "config");
    assert.match(failure.message, /конфигура/i);
  });

  it("maps manifest errors to manifest_validation stage", () => {
    const failure = buildImportJobFailure(new Error("MANIFEST_HASH_MISMATCH"), "apply", env);
    assert.equal(failure.errorCode, "MANIFEST_HASH_MISMATCH");
    assert.equal(failure.stage, "manifest_validation");
  });

  it("returns neutral unknown failure with diagnostic id", () => {
    const failure = buildImportJobFailure(new Error("boom unexpected stack detail"), "dry_run", env);
    assert.equal(failure.errorCode, IMPORT_JOB_UNKNOWN_CODE);
    assert.equal(failure.stage, "unknown");
    assert.ok(failure.diagnosticId);
    assert.match(failure.message, /Идентификатор диагностики/);
    assert.doesNotMatch(JSON.stringify(failure.result), /super-secret-password|db-secret|boom unexpected/i);
  });

  it("redacts secrets from serialized failure result", () => {
    const failure = buildImportJobFailure(
      new ImportJobError("CONFIG_INVALID", "config", env.ONEC_FTP_PASSWORD!),
      "apply",
      env,
    );
    const serialized = JSON.stringify(failure.result);
    assert.doesNotMatch(serialized, /super-secret-password/);
    assert.doesNotMatch(serialized, /db-secret/);
  });
});
