/**
 * Write operations require a non-empty external authorization reference supplied by the operator
 * out of band. This task does not constitute authorization to run against production.
 */
export function assertExternalWriteAuthorization(): { ok: true; ref: string } | { ok: false; code: string; message: string } {
  const ref = process.env.SEPTEMBER_2026_EXTERNAL_AUTHORIZATION_REF?.trim();
  if (!ref) {
    return {
      ok: false,
      code: "EXTERNAL_AUTHORIZATION_REQUIRED",
      message:
        "Set SEPTEMBER_2026_EXTERNAL_AUTHORIZATION_REF after separate human approval before backup/apply/rollback.",
    };
  }
  if (process.env.TEST_DATABASE_URL?.trim() && process.env.DATABASE_URL?.trim() === process.env.TEST_DATABASE_URL?.trim()) {
    return {
      ok: false,
      code: "PRODUCTION_URL_TEST_MIXED",
      message: "DATABASE_URL must not equal TEST_DATABASE_URL for operator write paths.",
    };
  }
  return { ok: true, ref };
}

import type { ReadOnlyPreflightTestContext } from "./read-only-preflight-types";

export function assertProductionReadOnlyPreflightDatabaseUrl(
  databaseUrl: string,
  testContext?: ReadOnlyPreflightTestContext,
): { ok: true } | { ok: false; code: string; message: string } {
  if (process.env.SEPTEMBER_2026_SYNTHETIC_HARNESS?.trim()) {
    return {
      ok: false,
      code: "OPERATOR_BYPASS_FORBIDDEN",
      message: "Production read-only entry does not accept SEPTEMBER_2026_SYNTHETIC_HARNESS.",
    };
  }
  const test = process.env.TEST_DATABASE_URL?.trim();
  if (test && databaseUrl === test) {
    if (testContext?.allowNonProductionDatabaseUrl) {
      return { ok: true };
    }
    return {
      ok: false,
      code: "TEST_DATABASE_URL_NOT_ALLOWED",
      message: "Operator read-only preflight must not use TEST_DATABASE_URL.",
    };
  }
  if (test && process.env.DATABASE_URL?.trim() === test) {
    return {
      ok: false,
      code: "PRODUCTION_URL_TEST_MIXED",
      message: "DATABASE_URL must not equal TEST_DATABASE_URL.",
    };
  }
  return { ok: true };
}

export function assertPreflightDatabaseUrl(databaseUrl: string): { ok: true } | { ok: false; code: string; message: string } {
  const test = process.env.TEST_DATABASE_URL?.trim();
  if (test && databaseUrl === test) {
    return { ok: true };
  }
  if (!process.env.SEPTEMBER_2026_PREFLIGHT_ALLOW_RUNTIME_DATABASE?.trim()) {
    return {
      ok: false,
      code: "PREFLIGHT_RUNTIME_DATABASE_BLOCKED",
      message: "Production preflight requires explicit SEPTEMBER_2026_PREFLIGHT_ALLOW_RUNTIME_DATABASE=1 after approval.",
    };
  }
  return { ok: true };
}
