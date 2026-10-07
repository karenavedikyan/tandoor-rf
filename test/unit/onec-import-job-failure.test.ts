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
    assert.match(failure.message, /безопасности/i);
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
    assert.doesNotMatch(failure.message, /super-secret-password/);
  });

  it("does not leak password from invalid config exception or internal log", () => {
    const invalidEnv = {
      ONEC_FTP_ENABLED: "true",
      ONEC_FTP_PASSWORD: "fixture-secret-password",
    };
    const logs: string[] = [];
    const originalInfo = console.info;
    console.info = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };
    try {
      const failure = buildImportJobFailure(
        new Error("fixture-secret-password must never appear"),
        "apply",
        invalidEnv,
      );
      const serialized = JSON.stringify(failure);
      assert.doesNotMatch(serialized, /fixture-secret-password/);
      assert.doesNotMatch(logs.join("\n"), /fixture-secret-password/);
      assert.doesNotMatch(logs.join("\n"), /must never appear/);
      assert.match(logs.join("\n"), /onec_import_job_internal_error/);
    } finally {
      console.info = originalInfo;
    }
  });

  for (const code of ["DATABASE_ERROR", "UNRECOGNIZED_FIXTURE_CODE", "constructor"]) {
    it(`never trusts typed exception text for ${code} with invalid config`, () => {
      const secret = "fixture-password-not-in-catalog";
      const invalidEnv = { ONEC_FTP_ENABLED: "true", ONEC_FTP_PASSWORD: secret };
      const error = new ImportJobError(code, "apply", `Credential ${secret}`);
      error.name = `UntrustedName ${secret}`;
      const logs: string[] = [];
      const originalInfo = console.info;
      console.info = (...args: unknown[]) => logs.push(args.map(String).join(" "));
      try {
        const failure = buildImportJobFailure(error, "apply", invalidEnv);
        assert.equal(failure.errorCode, code === "DATABASE_ERROR" ? code : IMPORT_JOB_UNKNOWN_CODE);
        assert.equal(failure.stage, code === "DATABASE_ERROR" ? "apply" : "unknown");
        assert.ok(failure.diagnosticId);
        assert.equal(failure.result.diagnosticId, failure.diagnosticId);
        assert.match(failure.message, /Идентификатор диагностики/);
        assert.equal(JSON.stringify(failure).includes(secret), false);
        assert.equal(logs.join("\n").includes(secret), false);
        assert.doesNotMatch(JSON.stringify(failure), /Credential|UntrustedName/);
      } finally {
        console.info = originalInfo;
      }
    });
  }
});
